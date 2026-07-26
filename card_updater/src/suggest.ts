/**
 * AI re-targeting suggestions for cards whose targeted senses may have changed.
 *
 * Sense and hint determination uses the shared, evaluated card-field prompt with only those two
 * outputs enabled. Confidence is derived deterministically by comparing the generated selection
 * against the structural sense alignment.
 */

import { DEFAULT_MODEL_ID, generateSenseAndHintFields, type ModelId } from "card_field_generation";
import { compatibleSenseNumbersForJMDictUsage } from "card_creator";
import { formatMiwakeKey } from "card_creator/keys";
import type { AnalyzedCard } from "./analyze.ts";
import { parseAnkiReading } from "./anki_reading.ts";
import { sha256OfJSON } from "./hash.ts";

export type SuggestionConfidence = "high" | "medium" | "low";

export interface Suggestion {
  /** 1-indexed applicable senses in the new entry; empty means all senses apply. */
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
  modelId: string;
  fromCache: boolean;
}

export interface SuggestionCacheEntry {
  inputHash: string;
  modelId: string;
  generatedAt: string;
  applicableSenses: number[];
  hint: string | null;
}

export type SuggestionCache = Record<string, SuggestionCacheEntry>;

export function suggestionInputHash(
  card: AnalyzedCard,
  modelId: string,
): Promise<string> {
  return sha256OfJSON([
    modelId,
    card.note.fields.key,
    card.note.fields.recognitionTarget,
    card.note.fields.reading,
    card.note.fields.hint,
    card.note.fields.dictionaryEntry,
    card.latestEntryHTML,
    card.note.fields.fullContext,
  ]);
}

/** Prepares the stored `Full context` field for the shared sense-and-hint prompt. */
export function contextForPrompt(fullContext: string): string {
  return fullContext
    .replace(/<\/?mark>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

export async function suggestForCard(
  card: AnalyzedCard,
  {
    modelId = DEFAULT_MODEL_ID,
    cache = {},
    force = false,
    generate = generateSenseAndHintFields,
  }: {
    modelId?: ModelId;
    cache?: SuggestionCache;
    force?: boolean;
    generate?: typeof generateSenseAndHintFields;
  } = {},
): Promise<{ suggestion: Suggestion; cacheEntry: SuggestionCacheEntry }> {
  if (card.latestWord === null || card.newParsed === null || card.parsedKey === null) {
    throw new Error(`Card ${card.note.noteId} has no latest entry to suggest against.`);
  }
  const parsedKey = card.parsedKey;

  const inputHash = await suggestionInputHash(card, modelId);
  const cached = cache[String(card.note.noteId)];
  const fromCache = !force && cached !== undefined && cached.inputHash === inputHash &&
    cached.modelId === modelId;

  let applicableSenses: number[];
  let aiHint: string | null;
  if (fromCache) {
    applicableSenses = cached.applicableSenses;
    aiHint = cached.hint;
  } else {
    const kanaReading = selectedKanaReading(card);
    const compatibleSenseNumbers = compatibleSenseNumbersForJMDictUsage(
      card.latestWord,
      parsedKey.spelling,
      card.latestWord.kanji.some(({ text }) => text === parsedKey.spelling)
        ? kanaReading
        : undefined,
    );
    const fields = await generate({
      context: contextForPrompt(card.note.fields.fullContext),
      recognitionTarget: parsedKey.spelling,
      jmdictEntry: card.latestWord,
      kanaReading,
      compatibleSenseNumbers,
    }, modelId);
    if (fields.applicableSenses === null) {
      throw new Error(
        `No sense in the latest JMDict entry ${JSON.stringify(card.latestWord.id)} applies to ` +
          `recognition target ${JSON.stringify(parsedKey.spelling)} in the stored context.`,
      );
    }
    applicableSenses = senseNumbersForKey(
      fields.applicableSenses,
      compatibleSenseNumbers,
      card.newParsed.senses.length,
    );
    aiHint = fields.hint;
  }

  const suggestion = buildSuggestion(card, applicableSenses, aiHint, modelId, fromCache);
  const cacheEntry: SuggestionCacheEntry = {
    inputHash,
    modelId,
    generatedAt: new Date().toISOString(),
    applicableSenses,
    hint: aiHint,
  };
  return { suggestion, cacheEntry };
}

function selectedKanaReading(card: AnalyzedCard): string {
  const spelling = card.parsedKey!.spelling;
  if (card.latestWord!.kana.some(({ text }) => text === spelling)) return spelling;

  const recognitionTarget = card.note.fields.recognitionTarget || spelling;
  let reading = card.note.fields.reading;
  if (recognitionTarget === `～${spelling}` && reading.startsWith("～")) {
    reading = reading.slice(1).trimStart();
  } else if (recognitionTarget === `${spelling}～` && reading.endsWith("～")) {
    reading = reading.slice(0, -1).trimEnd();
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
 * Adapts the generator's “all compatible senses” shorthand to the key's “all entry senses”
 * shorthand, retaining explicit numbers when JMDict form restrictions exclude a sense.
 */
function senseNumbersForKey(
  generatedSenseNumbers: number[],
  compatibleSenseNumbers: number[],
  totalSenseCount: number,
): number[] {
  const selected = generatedSenseNumbers.length === 0
    ? compatibleSenseNumbers
    : generatedSenseNumbers;
  return selected.length === totalSenseCount ? [] : selected;
}

function buildSuggestion(
  card: AnalyzedCard,
  senses: number[],
  aiHint: string | null,
  modelId: string,
  fromCache: boolean,
): Suggestion {
  const allApply = senses.length === 0;
  const currentHint = card.note.fields.hint;

  // Existing hints are kept by default (they may be hand-edited); see DESIGN.md.
  const defaultHint = allApply ? null : (currentHint || aiHint);

  const expected = card.mappedTargetSenses;
  const sensesMatchExpectation = expected.length > 0 &&
    JSON.stringify(senses) === JSON.stringify(expected);
  const hasContext = card.note.fields.fullContext.trim() !== "";

  let confidence: SuggestionConfidence;
  if (!hasContext) {
    confidence = "low";
  } else if (sensesMatchExpectation) {
    confidence = "high";
  } else if (allApply && card.parsedKey!.senseNumbers === null) {
    // The card targeted all senses and the AI still thinks all senses apply.
    confidence = "high";
  } else {
    confidence = "medium";
  }

  return {
    senses,
    aiHint,
    defaultHint,
    confidence,
    explanation: buildExplanation(card, senses, sensesMatchExpectation, hasContext),
    modelId,
    fromCache,
  };
}

function buildExplanation(
  card: AnalyzedCard,
  senses: number[],
  sensesMatchExpectation: boolean,
  hasContext: boolean,
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

  if (!hasContext) {
    parts.push("No mined context is stored on this card, so this is a weak guess.");
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
