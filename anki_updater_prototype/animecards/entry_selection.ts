import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import {
  CARD_FIELD_GENERATION_CACHE_VERSION,
  generateContrastiveHint,
  type GeneratedSenseAndHint,
  generateSenseAndHintFields,
  type ModelId,
  type SenseAndHintGenerationInput,
} from "card_field_generation";
import { kanaScriptsMatch } from "./html.ts";
import type { ConversionCandidate } from "./types.ts";

export interface UnresolvedJMDictEntry {
  /** Plain-text source evidence used to distinguish the competing entries. */
  context: string;
  /** Exact undecorated JMDict spelling used by every candidate entry. */
  recognitionTarget: string;
  /** Best reading evidence recoverable from the Animecard. */
  kanaReading: string;
  /** Whether the reading is explicit publisher ruby or weaker Animecard metadata. */
  kanaReadingEvidence: "source-ruby" | "animecard";
  /** Same-spelling entries whose senses must be contrasted. */
  candidateEntries: JMdictWord[];
  /** Candidate IDs represented by the Animecard glossary, and therefore selectable. */
  allowedJMDictIds: string[];
}

export interface JMDictEntrySelectionOverride {
  jmdictId: string;
  recognitionTarget: string;
  applicableSenseNumbers: number[];
  /** The selected-entry hint, or `null` when final `～` notation makes it redundant. */
  hint: string | null;
  model: string;
  generatedAt: string;
  candidateJMDictIds: string[];
  allowedJMDictIds: string[];
}

/** Reconstructs the complete entry-selection decision for deterministic pipeline replay. */
export function entrySelectionOverride(
  candidate: ConversionCandidate,
): JMDictEntrySelectionOverride | undefined {
  const resolution = candidate.jmdictEntryResolution;
  if (resolution === undefined) return undefined;
  return {
    jmdictId: candidate.jmdictId,
    recognitionTarget: candidate.keyRecognitionTarget,
    applicableSenseNumbers: resolution.applicableSenseNumbers,
    hint: resolution.hint,
    model: resolution.model,
    generatedAt: resolution.generatedAt,
    candidateJMDictIds: resolution.candidateJMDictIds,
    allowedJMDictIds: resolution.allowedJMDictIds,
  };
}

export type JMDictEntrySelection =
  | ({ status: "selected" } & JMDictEntrySelectionOverride)
  | { status: "no-match" }
  | { status: "no-reading-match" }
  | { status: "hint-unavailable"; selectedJMDictId: string }
  | { status: "ambiguous"; selectedJMDictIds: string[] }
  | { status: "disallowed"; selectedJMDictId: string }
  | {
    status: "reading-conflict";
    selectedJMDictId: string;
    compatibleReadings: string[];
  };

interface CombinedSense {
  jmdictId: string;
  senseNumber: number;
}

function uniqueForms<T>(forms: T[]): T[] {
  return [...new Map(forms.map((form) => [JSON.stringify(form), form])).values()];
}

const GLOSS_STOP_WORDS = new Set([
  "an",
  "and",
  "as",
  "at",
  "by",
  "esp",
  "for",
  "from",
  "in",
  "of",
  "on",
  "one",
  "or",
  "the",
  "to",
  "with",
]);

function glossVocabulary(entry: JMdictWord, senseNumbers?: readonly number[]): Set<string> {
  const senses = senseNumbers === undefined
    ? entry.sense
    : senseNumbers.map((number) => entry.sense[number - 1]);
  return new Set(
    senses
      .flatMap((sense) => sense.gloss)
      .filter(({ lang }) => lang === "eng")
      .flatMap(({ text }) => text.toLowerCase().match(/[a-z]+/gu) ?? [])
      .filter((word) => word.length > 1 && !GLOSS_STOP_WORDS.has(word)),
  );
}

/**
 * Conservatively declines to invent a semantic contrast when JMDict's English glosses share
 * meaningful vocabulary. This catches duplicate entries split primarily by reading or register;
 * false negatives merely leave a card for multi-reading support or manual review.
 */
function entriesHaveSharedGlossVocabulary(
  selectedEntry: JMdictWord,
  applicableSenseNumbers: readonly number[],
  contrastingEntries: readonly JMdictWord[],
): boolean {
  const selectedWords = glossVocabulary(selectedEntry, applicableSenseNumbers);
  const contrastingWords = new Set(
    contrastingEntries.flatMap((entry) => [...glossVocabulary(entry)]),
  );
  return selectedWords.intersection(contrastingWords).size > 0;
}

type GenerateSenseAndHint = (
  input: SenseAndHintGenerationInput,
  model: ModelId,
) => Promise<GeneratedSenseAndHint>;
type GenerateContrastiveHint = typeof generateContrastiveHint;

/** Revalidates cached selections against reading evidence that is not entrusted to the model. */
export function readingConflictForJMDictEntrySelection(
  request: UnresolvedJMDictEntry,
  selectedJMDictId: string,
): Extract<JMDictEntrySelection, { status: "reading-conflict" }> | null {
  const selectedEntry = request.candidateEntries.find(({ id }) => id === selectedJMDictId);
  if (selectedEntry === undefined) {
    throw new Error(`Selected JMDict entry ${selectedJMDictId} is absent from the candidates.`);
  }
  const compatibleReadings =
    selectedEntry.kanji.some(({ text }) => text === request.recognitionTarget)
      ? selectedEntry.kana
        .filter(({ appliesToKanji }) =>
          appliesToKanji.includes("*") || appliesToKanji.includes(request.recognitionTarget)
        )
        .map(({ text }) => text)
      : selectedEntry.kana
        .filter(({ text }) => text === request.recognitionTarget)
        .map(({ text }) => text);
  return compatibleReadings.some((reading) => kanaScriptsMatch(reading, request.kanaReading))
    ? null
    : {
      status: "reading-conflict",
      selectedJMDictId,
      compatibleReadings,
    };
}

function combinedEntry(
  request: UnresolvedJMDictEntry,
  candidateEntries: readonly JMdictWord[],
): {
  entry: JMdictWord;
  senses: CombinedSense[];
} {
  const candidates = candidateEntries.toSorted((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) {
    throw new Error("JMDict entry selection requires at least one candidate entry.");
  }
  const senses = candidates.flatMap((entry) =>
    entry.sense.map((_, index) => ({
      jmdictId: entry.id,
      senseNumber: index + 1,
    }))
  );
  if (senses.length === 0) {
    throw new Error("JMDict entry selection requires at least one candidate sense.");
  }

  const exactKanjiForms = candidates.flatMap((entry) =>
    entry.kanji.filter(({ text }) => text === request.recognitionTarget)
  );
  const exactKanaForms = candidates.flatMap((entry) =>
    entry.kana.filter(({ text }) => text === request.recognitionTarget)
  );
  if (exactKanjiForms.length === 0 && exactKanaForms.length === 0) {
    throw new Error(
      `No candidate entry contains recognitionTarget ${
        JSON.stringify(request.recognitionTarget)
      } as an exact spelling.`,
    );
  }

  return {
    entry: {
      id: `entry-selection:${candidates.map(({ id }) => id).join(",")}`,
      // Keep other forms and restrictions because they often clarify why JMDict split the entries.
      // The exact-target check above prevents this temporary combined view from admitting a novel
      // recognition-target spelling.
      kanji: uniqueForms(candidates.flatMap(({ kanji }) => kanji)),
      kana: uniqueForms(candidates.flatMap(({ kana }) => kana)).concat(
        exactKanaForms.length > 0 ? [] : [{
          common: false,
          text: request.kanaReading,
          tags: [],
          appliesToKanji: ["*"],
        }],
      ),
      // The combined sense number is the stable bridge back to its original entry and sense.
      sense: candidates.flatMap((entry) => entry.sense.map((sense) => structuredClone(sense))),
    },
    senses,
  };
}

/**
 * Selects one of several same-spelling entries by presenting their senses as one numbered list.
 *
 * Reusing the canonical sense-and-hint operation makes entry selection obey the same prompt,
 * output schema, hint-length limit, and semantic validation as ordinary sense selection.
 */
export async function selectJMDictEntry(
  request: UnresolvedJMDictEntry,
  model: ModelId,
  generate: GenerateSenseAndHint = generateSenseAndHintFields,
  generateHint: GenerateContrastiveHint = generateContrastiveHint,
): Promise<JMDictEntrySelection> {
  const readingCompatibleEntries = request.candidateEntries.filter((entry) =>
    readingConflictForJMDictEntrySelection(request, entry.id) === null
  );
  const initialEntries = request.kanaReadingEvidence === "source-ruby"
    ? readingCompatibleEntries
    : request.candidateEntries;
  if (initialEntries.length === 0) return { status: "no-reading-match" };

  async function evaluate(
    candidateEntries: readonly JMdictWord[],
  ): Promise<JMDictEntrySelection> {
    const { entry, senses } = combinedEntry(request, candidateEntries);
    const generated = await generate({
      context: request.context,
      recognitionTarget: request.recognitionTarget,
      jmdictEntry: entry,
      kanaReading: request.kanaReading,
      compatibleSenseNumbers: senses.map((_, index) => index + 1),
    }, model);
    if (generated.applicableSenses === null) return { status: "no-match" };

    const combinedSenseNumbers = generated.applicableSenses.length === 0
      ? senses.map((_, index) => index + 1)
      : generated.applicableSenses;
    const selectedSenses = combinedSenseNumbers.map((number) => senses[number - 1]);
    const selectedJMDictIds = [
      ...new Set(selectedSenses.map(({ jmdictId }) => jmdictId)),
    ].toSorted();
    if (selectedJMDictIds.length !== 1) {
      return { status: "ambiguous", selectedJMDictIds };
    }

    const jmdictId = selectedJMDictIds[0];
    if (!request.allowedJMDictIds.includes(jmdictId)) {
      return { status: "disallowed", selectedJMDictId: jmdictId };
    }
    const readingConflict = readingConflictForJMDictEntrySelection(request, jmdictId);
    if (readingConflict !== null) return readingConflict;
    const applicableSenseNumbers = selectedSenses.map(({ senseNumber }) => senseNumber);
    const selectedEntry = candidateEntries.find(({ id }) => id === jmdictId)!;
    const contrastingEntries = request.candidateEntries.filter(({ id }) => id !== jmdictId);
    const hint = generated.hint ?? (
      entriesHaveSharedGlossVocabulary(
          selectedEntry,
          applicableSenseNumbers,
          contrastingEntries,
        )
        ? null
        : await generateHint({
          context: request.context,
          recognitionTarget: request.recognitionTarget,
          selectedEntry,
          applicableSenseNumbers,
          contrastingEntries,
        }, model)
    );
    if (hint === null) {
      return { status: "hint-unavailable", selectedJMDictId: jmdictId };
    }
    return {
      status: "selected",
      jmdictId,
      recognitionTarget: request.recognitionTarget,
      applicableSenseNumbers,
      hint,
      model,
      generatedAt: new Date().toISOString(),
      candidateJMDictIds: request.candidateEntries.map(({ id }) => id).toSorted(),
      allowedJMDictIds: [...request.allowedJMDictIds].toSorted(),
    };
  }

  const initial = await evaluate(initialEntries);
  if (request.kanaReadingEvidence === "source-ruby") return initial;

  const eligibleAllowedEntries = readingCompatibleEntries.filter(({ id }) =>
    request.allowedJMDictIds.includes(id)
  );
  if (eligibleAllowedEntries.length !== 1) return initial;
  const selectedIds = initial.status === "disallowed"
    ? [initial.selectedJMDictId]
    : initial.status === "reading-conflict"
    ? [initial.selectedJMDictId]
    : initial.status === "ambiguous"
    ? initial.selectedJMDictIds
    : [];
  if (
    selectedIds.length === 0 ||
    selectedIds.some((id) =>
      id !== eligibleAllowedEntries[0].id &&
      readingCompatibleEntries.some((entry) => entry.id === id)
    )
  ) {
    return initial;
  }

  // The broad comparison preferred an entry that contradicts the Animecard reading. Recheck the
  // one linked, reading-compatible entry on its own: it is accepted only if its own senses fit the
  // context and yield the contrastive hint required for a shared spelling.
  return await evaluate(eligibleAllowedEntries);
}

/** Fingerprints every semantic input, including the current JMDict data, for durable AI caching. */
export async function entrySelectionInputFingerprint(
  request: UnresolvedJMDictEntry,
  model: ModelId,
): Promise<string> {
  const value = JSON.stringify({
    version: 4,
    cardFieldGenerationVersion: CARD_FIELD_GENERATION_CACHE_VERSION,
    model,
    context: request.context,
    recognitionTarget: request.recognitionTarget,
    kanaReading: request.kanaReading,
    kanaReadingEvidence: request.kanaReadingEvidence,
    candidateEntries: request.candidateEntries.toSorted((left, right) =>
      left.id.localeCompare(right.id)
    ),
    allowedJMDictIds: [...request.allowedJMDictIds].toSorted(),
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
