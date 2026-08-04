/**
 * AI re-targeting suggestions for cards whose targeted senses may have changed.
 *
 * Sense selection and source-grounded hint generation use the shared focused operations.
 * Confidence is derived deterministically by comparing the generated selection against the
 * structural sense alignment.
 */

import { DOMParser, Node, type Text } from "@b-fuze/deno-dom";
import {
  generateSourceGroundedHint,
  type GenerationCache,
  type GenerationResult,
  type ModelId,
  selectSensesForCard,
} from "card_field_generation";
import {
  compatibleSenseNumbersForJMDictUsage,
  jmdictAlternativesForCardFront,
  jmdictUsagesForSpelling,
} from "card_creator";
import { formatMiwakeKey } from "card_creator/keys";
import { ankiFuriganaToSurface, verifyMarkedContextTarget } from "card_resolution";
import type { JMDictWord } from "data";
import type { AnalyzedCard } from "./analyze.ts";
import { splitAffixNotation } from "./affix_notation.ts";
import { parseAnkiReading } from "./anki_reading.ts";

export type SuggestionConfidence = "high" | "medium";

export interface Suggestion {
  /** 1-indexed senses selected for the card in the new entry; empty means all senses belong. */
  senses: number[];
  /** The canonical AI-generated hint (may differ from the card's current hint). */
  aiHint: string | null;
  /**
   * The hint the review UI should default to. Existing hints are never overwritten by
   * default; the AI hint is offered as an alternative.
   */
  defaultHint: string | null;
  confidence: SuggestionConfidence;
  /** Deterministic explanation of how the suggestion relates to the entry changes. */
  explanation: string;
  /** Actual model-and-effort identities used by the focused operation(s). */
  modelConfigurationIds: string[];
  fromCache: boolean;
}

/** Preserves stored HTML and target marks while removing front-side Anki furigana. */
export function contextForPrompt(fullContext: string): string {
  const document = new DOMParser().parseFromString(fullContext.trim(), "text/html");
  const visit = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        (child as Text).data = ankiFuriganaToSurface(child.textContent);
      } else {
        visit(child);
      }
    }
  };
  visit(document.body);
  return document.body.innerHTML;
}

export async function suggestForCard(
  card: AnalyzedCard,
  {
    sameSpellingEntries,
    modelId,
    generationCache,
    force = false,
    selectSenses = selectSensesForCard,
    generateHint = generateSourceGroundedHint,
    verifyContext = verifyMarkedContextTarget,
  }: {
    /** Every JMDict entry containing the card's exact undecorated front-side spelling. */
    sameSpellingEntries: readonly JMDictWord[];
    modelId?: ModelId;
    generationCache?: GenerationCache;
    force?: boolean;
    selectSenses?: typeof selectSensesForCard;
    generateHint?: typeof generateSourceGroundedHint;
    /** Verifies that the stored marks still resolve to the card's current JMDict spelling. */
    verifyContext?: typeof verifyMarkedContextTarget;
  },
): Promise<Suggestion> {
  if (card.latestWord === null || card.newParsed === null || card.parsedKey === null) {
    throw new Error(`Card ${card.note.noteId} has no latest entry to suggest against.`);
  }
  const parsedKey = card.parsedKey;
  if (card.note.fields.fullContext.trim() === "") {
    throw new Error(
      `Card ${card.note.noteId} has no Full context, so a source-grounded suggestion cannot be generated.`,
    );
  }

  let aiHint: string | null;
  const focusedResults: GenerationResult<unknown>[] = [];
  const kanaReading = selectedKanaReading(card);
  const compatibleSenseNumbers = compatibleSenseNumbersForJMDictUsage(
    card.latestWord,
    parsedKey.spelling,
    card.latestWord.kanji.some(({ text }) => text === parsedKey.spelling) ? kanaReading : undefined,
  );
  const spellingUsages = jmdictUsagesForSpelling(sameSpellingEntries, parsedKey.spelling);
  const selectedEntryUsage = spellingUsages.find(({ entry }) => entry.id === card.latestWord!.id);
  if (selectedEntryUsage === undefined) {
    throw new Error(
      `sameSpellingEntries must include latest JMDict entry ${
        JSON.stringify(card.latestWord.id)
      } ` +
        `with exact spelling ${JSON.stringify(parsedKey.spelling)} for card ${card.note.noteId}.`,
    );
  }
  const context = contextForPrompt(card.note.fields.fullContext);
  const partOfSpeech = [
    ...new Set(
      compatibleSenseNumbers.flatMap((senseNumber) =>
        card.latestWord!.sense[senseNumber - 1]?.partOfSpeech ?? []
      ),
    ),
  ];
  try {
    await verifyContext(context, parsedKey.spelling, { partOfSpeech });
  } catch (error) {
    throw new Error(
      `Card ${card.note.noteId} Full context does not mark a supported occurrence of key spelling ${
        JSON.stringify(parsedKey.spelling)
      } in latest JMDict entry ${JSON.stringify(card.latestWord.id)}.`,
      { cause: error },
    );
  }
  const generationOptions = {
    ...(modelId === undefined ? {} : { modelId }),
    cache: generationCache,
    cacheMode: force ? "refresh" as const : "use" as const,
    maxAttempts: 3,
  };
  const senseResult = await selectSenses({
    context,
    recognitionTarget: parsedKey.spelling,
    jmdictEntry: card.latestWord,
    compatibleSenseNumbers,
  }, generationOptions);
  focusedResults.push(senseResult);
  const senseOutcome = senseResult.value;
  if (senseOutcome.outcome === "no-match") {
    throw new Error(
      `Focused sense selection found no sense in latest JMDict entry ${
        JSON.stringify(card.latestWord.id)
      } that matches recognition target ${
        JSON.stringify(parsedKey.spelling)
      } in the stored context.`,
    );
  }
  if (senseOutcome.outcome === "ambiguous") {
    throw new Error(
      `Focused sense selection could not distinguish between possible senses ${
        JSON.stringify(senseOutcome.possibleSenseNumbers)
      } in latest JMDict entry ${JSON.stringify(card.latestWord.id)} for recognition target ${
        JSON.stringify(parsedKey.spelling)
      } in the stored context.`,
    );
  }
  const selectedSenseNumbers = [...senseOutcome.senseNumbers];
  const applicableSenses = senseNumbersForKey(
    senseOutcome.senseNumbers,
    card.newParsed.senses.length,
  );
  aiHint = null;
  const contrastingUsages = jmdictAlternativesForCardFront(
    { entry: card.latestWord, senseNumbers: selectedSenseNumbers },
    spellingUsages,
    {
      // Recognition target is user-editable and the updater never rewrites it. Hint generation
      // must therefore use the notation actually displayed, not what a newly created card would
      // derive from the latest JMDict tags.
      displayedAffixNotation: displayedAffixNotation(card.note.fields.recognitionTarget),
    },
  );
  if (contrastingUsages.length > 0) {
    const hintResult = await generateHint({
      context,
      recognitionTarget: parsedKey.spelling,
      selectedUsage: {
        entry: card.latestWord,
        senseNumbers: selectedSenseNumbers,
      },
      contrastingUsages,
    }, generationOptions);
    focusedResults.push(hintResult);
    if (hintResult.value.outcome === "generated") {
      aiHint = hintResult.value.hint;
    }
  }

  const generationWasCached = focusedResults.length > 0 &&
    focusedResults.every(({ metadata }) => metadata.cacheStatus !== "miss");
  return buildSuggestion(
    card,
    applicableSenses,
    aiHint,
    [
      ...new Set(focusedResults.map(({ metadata }) => metadata.modelConfigurationId)),
    ],
    generationWasCached,
  );
}

function displayedAffixNotation(
  recognitionTarget: string,
): "leading" | "none" | "trailing" {
  return splitAffixNotation(recognitionTarget).notation;
}

function selectedKanaReading(card: AnalyzedCard): string {
  const spelling = card.parsedKey!.spelling;
  if (card.latestWord!.kana.some(({ text }) => text === spelling)) return spelling;

  const recognitionTarget = card.note.fields.recognitionTarget || spelling;
  let reading = card.note.fields.reading;
  const targetAffix = splitAffixNotation(recognitionTarget);
  const readingAffix = splitAffixNotation(reading);
  if (
    targetAffix.content === spelling &&
    targetAffix.notation !== "none" &&
    targetAffix.notation === readingAffix.notation
  ) {
    reading = readingAffix.content;
  }
  const readings = parseAnkiReading(reading, spelling);
  if (readings === null || readings.length !== 1) {
    throw new Error(
      `Card ${card.note.noteId} must have exactly one parseable kana reading for recognition ` +
        `target ${JSON.stringify(spelling)} before sense selection; found ${
          JSON.stringify(card.note.fields.reading)
        }`,
    );
  }
  return readings[0];
}

/**
 * Adapts the generator's explicit selection to the key's “all entry senses” shorthand, retaining
 * explicit numbers when JMDict form restrictions exclude a sense.
 */
function senseNumbersForKey(
  generatedSenseNumbers: readonly number[],
  totalSenseCount: number,
): number[] {
  return generatedSenseNumbers.length === totalSenseCount ? [] : [...generatedSenseNumbers];
}

function buildSuggestion(
  card: AnalyzedCard,
  senses: number[],
  aiHint: string | null,
  modelConfigurationIds: string[],
  fromCache: boolean,
): Suggestion {
  const allApply = senses.length === 0;
  const currentHint = card.note.fields.hint;

  // Existing hints may be hand-edited and can distinguish this entry from another JMDict entry
  // with the same spelling, even when every sense in the selected entry applies. Preserve them by
  // default for every selection; reviewers can still clear a hint that became redundant.
  const defaultHint = currentHint || aiHint;

  const expected = card.mappedTargetSenses;
  const sensesMatchExpectation = expected.length > 0 &&
    JSON.stringify(senses) === JSON.stringify(expected);
  let confidence: SuggestionConfidence;
  if (sensesMatchExpectation) {
    confidence = "high";
  } else if (allApply && card.parsedKey!.senseNumbers === null) {
    // The card targeted all senses and the AI still puts them on one recognition card.
    confidence = "high";
  } else {
    confidence = "medium";
  }

  return {
    senses,
    aiHint,
    defaultHint,
    confidence,
    explanation: buildExplanation(card, senses, sensesMatchExpectation),
    modelConfigurationIds,
    fromCache,
  };
}

function buildExplanation(
  card: AnalyzedCard,
  senses: number[],
  sensesMatchExpectation: boolean,
): string {
  const parts: string[] = [];
  const oldCount = card.oldParsed!.senses.length;
  const newCount = card.newParsed!.senses.length;

  if (oldCount !== newCount) {
    parts.push(`The entry went from ${oldCount} to ${newCount} senses.`);
  } else {
    parts.push("The sense list changed.");
  }

  if (senses.length === 0) {
    parts.push("The AI judges all senses still apply to the mined context.");
  } else {
    parts.push(
      `The AI picks sense${senses.length > 1 ? "s" : ""} ${
        senses.join(", ")
      } for the mined context.`,
    );
  }

  if (sensesMatchExpectation) {
    parts.push("This matches where the previously targeted sense text moved.");
  } else if (card.mappedTargetSenses.length > 0) {
    parts.push(
      `Structural alignment alone would have suggested ${card.mappedTargetSenses.join(", ")}.`,
    );
  } else if (card.removedTargetedSenses.length > 0) {
    parts.push("The previously targeted sense has no counterpart in the new entry.");
  }

  return parts.join(" ");
}

export function suggestedKey(card: AnalyzedCard, senses: number[]): string {
  return formatMiwakeKey(
    card.parsedKey!.spelling,
    card.parsedKey!.jmdictId,
    senses,
    card.newParsed!.senses.length,
  );
}
