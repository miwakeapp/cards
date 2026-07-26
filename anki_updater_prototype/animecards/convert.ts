import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { compatibleSenseNumbersForJMDictUsage, createCard, type MiwakeCard } from "card_creator";
import { toHiragana } from "japanese_text";
import { markContextTargets, markedContextHasRuby } from "../shared/mark_context.ts";
import {
  deriveLookupSpellings,
  findEntriesBySpelling,
  findSurfaceFormsForLookupSpelling,
  type SpellingIndex,
} from "../shared/jmdict_resolution/recognition_target_lookup.ts";
import { normalizeRecognitionTarget } from "../shared/jmdict_resolution/csv_resolution.ts";
import {
  applyDisplayTargetOverride,
  hasBoundaryNotation,
  normalizeNotationMarkers,
} from "./display_target.ts";
import {
  contextPlainText,
  extractJMDictIDs,
  kanaScriptsMatch,
  normalizeContextHTML,
  normalizePlainText,
  parseRecognitionTargetField,
  readingFieldCandidates,
} from "./html.ts";
import { needsAIMinimizedContext } from "card_field_generation";
import {
  analyzeEPUBContext,
  cardSourceFromResolution,
  type EPUBContextMatch,
  epubContextPlainText,
  epubSenseSelectionContext,
  type EPUBSourceCorpus,
  expandEPUBContextToIncludeTarget,
  findUniqueEPUBContext,
  resolveSource,
} from "./source.ts";
import {
  type AnkiNoteInfo,
  type ConversionCandidate,
  type FullContextResolution,
  type SenseResolution,
  type SkippedNote,
  snapshotNote,
  type SourceFieldMapping,
  type SourceResolution,
  type TargetInContextResolution,
} from "./types.ts";

export const MIWAKE_FIELD_NAMES = [
  "Key",
  "Recognition target",
  "Reading",
  "Hint",
  "Full context",
  "Minimized context",
  "Dictionary entry",
  "Source",
] as const;

export interface UnresolvedTargetInContext {
  context: string;
  entry: JMdictWord;
  reading?: string;
  recognitionTarget: string;
  sourceResolution: SourceResolution;
}

type ConversionResult =
  | { candidate: ConversionCandidate; skipped?: never }
  | {
    candidate?: never;
    skipped: SkippedNote;
    unresolvedTargetInContext?: UnresolvedTargetInContext;
  };

function skip(noteId: number, word: string, reason: string, detail?: string): ConversionResult {
  return { skipped: { noteId, word, reason, detail } };
}

function fieldValue(note: AnkiNoteInfo, fieldName: string | null): string {
  return fieldName === null ? "" : note.fields[fieldName]?.value ?? "";
}

function entrySpellings(entry: JMdictWord): string[] {
  return [
    ...entry.kanji.map((item) => item.text),
    ...entry.kana.map((item) => item.text),
  ];
}

interface SurfaceFormMatches {
  surfaces: string[];
  byLookupSpelling: Array<{
    lookupSpelling: string;
    surfaces: string[];
  }>;
}

function sourceOrthographyScore(spelling: string, surface: string): number {
  const spellingCharacters = [...spelling];
  const surfaceCharacters = [...surface];
  let score = 0;
  for (let i = 0; i < Math.min(spellingCharacters.length, surfaceCharacters.length); ++i) {
    if (spellingCharacters[i] === surfaceCharacters[i]) {
      score += 2;
    } else if (toHiragana(spellingCharacters[i]) === toHiragana(surfaceCharacters[i])) {
      score += 1;
    }
  }
  return score;
}

/**
 * Preserves kana script from an inflected source form in the corresponding dictionary spelling.
 *
 * For example, `グズる` matched against `ぐずった` becomes `ぐずる`. Characters changed by
 * inflection are left alone; only aligned characters that differ solely by kana script transfer.
 */
function transferSourceKanaScript(spelling: string, surface: string): string {
  const spellingCharacters = [...spelling];
  const surfaceCharacters = [...surface];
  for (let i = 0; i < Math.min(spellingCharacters.length, surfaceCharacters.length); ++i) {
    if (
      spellingCharacters[i] !== surfaceCharacters[i] &&
      toHiragana(spellingCharacters[i]) === toHiragana(surfaceCharacters[i])
    ) {
      spellingCharacters[i] = surfaceCharacters[i];
    }
  }
  return spellingCharacters.join("");
}

function recognitionTargetFromSource(
  matches: SurfaceFormMatches,
  fallback: string,
): string {
  const candidates = matches.byLookupSpelling.flatMap(({ lookupSpelling, surfaces }) =>
    surfaces.map((surface) => ({
      spelling: lookupSpelling,
      surface,
      score: sourceOrthographyScore(lookupSpelling, surface),
    }))
  );
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  return best === undefined ? fallback : transferSourceKanaScript(best.spelling, best.surface);
}

async function resolveEntry(
  word: string,
  context: string,
  glossary: string,
  entries: Map<string, JMdictWord>,
  spellingIndex: SpellingIndex,
  entryIdOverride?: string,
): Promise<
  | {
    entry: JMdictWord;
    recognitionTarget: string;
    recognitionTargetOverride: string | undefined;
  }
  | { reason: string; detail?: string }
> {
  let entry: JMdictWord;
  const extractedIds = extractJMDictIDs(glossary);
  if (entryIdOverride !== undefined) {
    const found = entries.get(entryIdOverride);
    if (!found) {
      return { reason: "missing-jmdict-entry", detail: entryIdOverride };
    }
    entry = found;
  } else if (extractedIds.length > 1) {
    return { reason: "multiple-jmdict-ids", detail: extractedIds.join(", ") };
  } else if (extractedIds.length === 1) {
    const extractedId = extractedIds[0];
    const found = entries.get(extractedId);
    if (!found) {
      return { reason: "missing-jmdict-entry", detail: extractedId };
    }
    entry = found;
  } else {
    const matches = findEntriesBySpelling(spellingIndex, word);
    if (matches.length === 0) {
      return { reason: "no-jmdict-id-or-exact-match" };
    }
    if (matches.length > 1) {
      return {
        reason: "ambiguous-jmdict-match",
        detail: matches.map((match) => match.id).join(", "),
      };
    }
    entry = matches[0];
  }

  const spellings = entrySpellings(entry);
  const hasNotationMarker = hasBoundaryNotation(word) &&
    spellings.some((spelling) => word.includes(spelling));
  const normalizedTarget = await normalizeRecognitionTarget(context, word, entry);
  const recognitionTarget = spellings.includes(word) ? word : normalizedTarget;
  const recognitionTargetOverride = hasNotationMarker ? word : undefined;
  if (!spellings.includes(recognitionTarget)) {
    return { reason: "jmdict-target-mismatch", detail: entry.id };
  }

  if (!spellings.includes(word)) {
    const derived = await deriveLookupSpellings(context, word);
    const defensible = derived.some((spelling) => spellings.includes(spelling)) ||
      spellings.some((spelling) => word.includes(spelling));
    if (!defensible) {
      return {
        reason: "jmdict-target-mismatch",
        detail: `${word} does not resolve to entry ${entry.id}`,
      };
    }
  }

  return { entry, recognitionTarget, recognitionTargetOverride };
}

function applicableReadings(entry: JMdictWord, recognitionTarget: string): string[] {
  const usesReadingField = entry.kanji.some(({ text }) => text === recognitionTarget);
  if (!usesReadingField) {
    return entry.kana.some(({ text }) => text === recognitionTarget) ? [recognitionTarget] : [];
  }

  const readings = entry.kana
    .filter((item) =>
      item.appliesToKanji.includes("*") ||
      item.appliesToKanji.includes(recognitionTarget)
    )
    .map((item) => item.text);
  return [...new Set(readings)];
}

function chooseReading(
  entry: JMdictWord,
  recognitionTarget: string,
  existingReadingHTML: string,
): { reading: string } | { reason: string; detail?: string } {
  const readings = applicableReadings(entry, recognitionTarget);
  if (readings.length === 0) {
    return { reason: "no-applicable-reading" };
  }

  const existingCandidates = readingFieldCandidates(existingReadingHTML);
  const exactTargetMatching = readings.filter((reading) => reading === recognitionTarget);
  if (exactTargetMatching.length === 1) {
    return { reading: exactTargetMatching[0] };
  }
  const targetMatching = readings.filter((reading) => kanaScriptsMatch(reading, recognitionTarget));
  if (targetMatching.length === 1) {
    return { reading: targetMatching[0] };
  }
  const exactMatching = readings.filter((reading) => existingCandidates.includes(reading));
  if (exactMatching.length === 1) {
    return { reading: exactMatching[0] };
  }
  const matching = readings.filter((reading) =>
    existingCandidates.some((candidate) => kanaScriptsMatch(candidate, reading))
  );
  if (matching.length === 1) {
    return { reading: matching[0] };
  }
  if (
    matching.length > 1 &&
    matching.every((reading) => kanaScriptsMatch(reading, matching[0]))
  ) {
    const scores = matching.map((reading) => sourceOrthographyScore(reading, recognitionTarget));
    const highestScore = Math.max(...scores);
    const closestToTarget = matching.filter((_, index) => scores[index] === highestScore);
    if (closestToTarget.length === 1) {
      return { reading: closestToTarget[0] };
    }
  }
  if (readings.length === 1) {
    return { reading: readings[0] };
  }

  return {
    reason: "ambiguous-reading",
    detail: `JMDict: ${readings.join(", ")}; Animecards: ${
      existingCandidates.join(", ") || "empty"
    }`,
  };
}

/** Builds the deterministic portion of a Miwake card conversion for one single-card Animecards note. */
export async function convertAnimecardsNote(
  note: AnkiNoteInfo,
  options: {
    sourceModel: string;
    targetModel: string;
    sourceFields: SourceFieldMapping;
    entries: Map<string, JMdictWord>;
    spellingIndex: SpellingIndex;
    jmdictIdOverride?: string;
    epubSourceCorpus?: EPUBSourceCorpus;
    /** Retains the future sense-selection pipeline without enabling it in normal preparation. */
    includeMultipleSenses?: boolean;
    contextOverride?: {
      html: string;
      resolution: FullContextResolution;
      sourceResolution: SourceResolution;
    };
    targetInContextOverride?: {
      surface: string;
      model: string;
      generatedAt: string;
    };
  },
): Promise<ConversionResult> {
  const rawWord = fieldValue(note, options.sourceFields.word);
  const parsedWord = parseRecognitionTargetField(rawWord);
  const word = normalizeNotationMarkers(parsedWord.text);

  if (note.modelName !== options.sourceModel) {
    return skip(note.noteId, word, "unexpected-source-model", note.modelName);
  }
  if (note.cards.length !== 1) {
    return skip(note.noteId, word, "not-exactly-one-card", String(note.cards.length));
  }
  if (!word) {
    return skip(note.noteId, word, "empty-word");
  }
  if (parsedWord.hasHint) {
    return skip(note.noteId, word, "recognition-target-hint", normalizePlainText(rawWord));
  }

  const originalContextHTML = normalizeContextHTML(
    fieldValue(note, options.sourceFields.sentence),
  );
  const sourceResolution = options.contextOverride?.sourceResolution ?? resolveSource(
    fieldValue(note, options.sourceFields.source),
    fieldValue(note, options.sourceFields.sourceURL),
    originalContextHTML,
    options.epubSourceCorpus,
  );
  if (sourceResolution.name === null) {
    return skip(note.noteId, word, "no-source");
  }

  let contextHTML = options.contextOverride?.html ?? originalContextHTML;
  let epubContextMatch: EPUBContextMatch | null = null;
  let senseSelectionEPUBMatch: EPUBContextMatch | null = null;
  let fullContextResolution: FullContextResolution = options.contextOverride?.resolution ?? {
    status: "source-unavailable",
  };
  if (options.epubSourceCorpus !== undefined) {
    senseSelectionEPUBMatch = findUniqueEPUBContext(
      options.epubSourceCorpus,
      originalContextHTML,
      sourceResolution.name,
    );
    const analysis = analyzeEPUBContext(
      options.epubSourceCorpus,
      originalContextHTML,
      sourceResolution.name,
    );
    if (analysis.status !== "not-found") epubContextMatch = analysis.match;
    if (options.contextOverride === undefined && analysis.status === "complete") {
      contextHTML = normalizeContextHTML(analysis.contextHTML);
      fullContextResolution = { status: "restored", method: "exact" };
    } else if (options.contextOverride === undefined && analysis.status === "cut-off") {
      fullContextResolution = { status: "pending", source: analysis.match.source };
    }
  }

  let context = contextPlainText(contextHTML);
  if (!context) {
    return skip(note.noteId, word, "empty-sentence");
  }

  const resolution = await resolveEntry(
    word,
    context,
    fieldValue(note, options.sourceFields.glossary),
    options.entries,
    options.spellingIndex,
    options.jmdictIdOverride,
  );
  if (!("entry" in resolution)) {
    return skip(note.noteId, word, resolution.reason, resolution.detail);
  }
  const { entry, recognitionTargetOverride } = resolution;
  let { recognitionTarget } = resolution;
  if (entry.sense.length !== 1 && options.includeMultipleSenses !== true) {
    return skip(note.noteId, word, "multiple-jmdict-senses", String(entry.sense.length));
  }
  let readings = applicableReadings(entry, recognitionTarget);
  let readingResult = chooseReading(
    entry,
    recognitionTarget,
    fieldValue(note, options.sourceFields.reading),
  );
  if (readings.length === 0) {
    return skip(note.noteId, word, "no-applicable-reading");
  }

  async function findSurfaceForms(
    lookupSpellings: Iterable<string>,
    sentence = context,
    allowSingleCharacterSubstring = false,
  ): Promise<SurfaceFormMatches> {
    const surfaces: string[] = [];
    const byLookupSpelling: SurfaceFormMatches["byLookupSpelling"] = [];
    const partOfSpeech = new Set(entry.sense.flatMap((sense) => sense.partOfSpeech));
    for (const lookupSpelling of new Set(lookupSpellings)) {
      const found = await findSurfaceFormsForLookupSpelling(sentence, lookupSpelling, {
        partOfSpeech,
        allowSingleCharacterSubstring,
      });
      if (found.length > 0) {
        byLookupSpelling.push({ lookupSpelling, surfaces: found });
        surfaces.push(...found);
      }
    }
    return {
      surfaces: [...new Set(surfaces)],
      byLookupSpelling,
    };
  }
  let surfaceMatches = await findSurfaceForms([recognitionTarget]);
  if (surfaceMatches.surfaces.length === 0) {
    surfaceMatches = await findSurfaceForms(readings);
  }
  if (surfaceMatches.surfaces.length === 0) {
    surfaceMatches = await findSurfaceForms(entrySpellings(entry));
  }
  if (surfaceMatches.surfaces.length === 0 && epubContextMatch !== null) {
    const sourceSurfaceMatches = await findSurfaceForms(
      [recognitionTarget, ...readings, ...entrySpellings(entry)],
      epubContextPlainText(epubContextMatch),
      true,
    );
    if (sourceSurfaceMatches.surfaces.length === 1) {
      const recoveredContextHTML = expandEPUBContextToIncludeTarget(
        epubContextMatch.paragraphs,
        originalContextHTML,
        sourceSurfaceMatches.surfaces[0],
      );
      if (recoveredContextHTML !== null) {
        contextHTML = normalizeContextHTML(recoveredContextHTML);
        context = contextPlainText(contextHTML);
        surfaceMatches = sourceSurfaceMatches;
        fullContextResolution = { status: "restored", method: "exact" };
      }
    }
  }
  recognitionTarget = recognitionTargetFromSource(surfaceMatches, recognitionTarget);
  if (!entrySpellings(entry).includes(recognitionTarget)) {
    return skip(
      note.noteId,
      word,
      "jmdict-target-mismatch",
      `recognitionTarget ${JSON.stringify(recognitionTarget)} is not among the ` +
        `jmdictEntry.kanji spellings or jmdictEntry.kana readings in jmdictEntry with id ` +
        `${JSON.stringify(entry.id)}`,
    );
  }
  readings = applicableReadings(entry, recognitionTarget);
  readingResult = chooseReading(
    entry,
    recognitionTarget,
    fieldValue(note, options.sourceFields.reading),
  );
  if (readings.length === 0) {
    return skip(note.noteId, word, "no-applicable-reading");
  }
  let surfaceForms = surfaceMatches.surfaces;
  let targetInContextResolution: TargetInContextResolution | null = null;
  if (surfaceForms.length === 0 && options.targetInContextOverride !== undefined) {
    const surface = options.targetInContextOverride.surface;
    if (
      surface.length === 0 || !context.includes(surface)
    ) {
      return skip(
        note.noteId,
        word,
        "invalid-ai-target-in-context",
        surface || "empty target",
      );
    }
    surfaceForms = [surface];
    targetInContextResolution = {
      method: "ai",
      surface,
      model: options.targetInContextOverride.model,
      generatedAt: options.targetInContextOverride.generatedAt,
    };
  }
  const uniqueSurfaceForms = surfaceForms;
  if (uniqueSurfaceForms.length === 0) {
    return {
      skipped: {
        noteId: note.noteId,
        word,
        reason: "target-not-found-in-sentence",
        detail: recognitionTarget,
      },
      unresolvedTargetInContext: {
        context,
        entry,
        ...("reading" in readingResult ? { reading: readingResult.reading } : {}),
        recognitionTarget,
        sourceResolution,
      },
    };
  }
  targetInContextResolution ??= uniqueSurfaceForms.length > 1
    ? {
      method: "deterministic",
      surface: uniqueSurfaceForms[0],
      additionalSurfaces: uniqueSurfaceForms.slice(1),
    }
    : {
      method: "deterministic",
      surface: uniqueSurfaceForms[0],
    };

  try {
    const markedContext = markContextTargets(
      contextHTML,
      uniqueSurfaceForms as [string, ...string[]],
    );
    const usesReadingField = entry.kanji.some(({ text }) => text === recognitionTarget);
    const renderCard = (reading: string | undefined) =>
      createCard({
        jmdictEntry: entry,
        recognitionTarget,
        ...(usesReadingField ? { kanaReading: reading } : {}),
        fullContext: markedContext,
        source: cardSourceFromResolution(sourceResolution),
      });

    let selectedReading: string;
    let card: MiwakeCard;
    if (!usesReadingField) {
      selectedReading = recognitionTarget;
      card = await renderCard(undefined);
    } else if (markedContextHasRuby(markedContext)) {
      const attempts = await Promise.all(readings.map(async (reading) => {
        try {
          return { reading, card: await renderCard(reading), error: undefined };
        } catch (error) {
          return { reading, card: undefined, error };
        }
      }));
      const contextCompatible = attempts.filter(({ card, error }) =>
        card !== undefined ||
        (error instanceof Error &&
          error.message.startsWith("No furigana placement data exists"))
      );
      const preferredReading = "reading" in readingResult ? readingResult.reading : undefined;
      const selected = contextCompatible.length === 1
        ? contextCompatible[0]
        : contextCompatible.find(({ reading }) => reading === preferredReading);
      if (selected === undefined) {
        if (contextCompatible.length > 1) {
          return skip(
            note.noteId,
            word,
            "ambiguous-reading",
            `Source ruby matches: ${contextCompatible.map(({ reading }) => reading).join(", ")}`,
          );
        }
        throw attempts[0]?.error ?? new Error("No reading agrees with the marked source ruby");
      }
      selectedReading = selected.reading;
      card = selected.card ?? await renderCard(selected.reading);
    } else {
      if (!("reading" in readingResult)) {
        return skip(note.noteId, word, readingResult.reason, readingResult.detail);
      }
      selectedReading = readingResult.reading;
      card = await renderCard(selectedReading);
    }

    const displayTarget = applyDisplayTargetOverride(
      card,
      recognitionTarget,
      recognitionTargetOverride,
    );
    const keyRecognitionTarget = recognitionTarget;
    const sameSpellingEntries = findEntriesBySpelling(
      options.spellingIndex,
      keyRecognitionTarget,
    );
    if (sameSpellingEntries.length > 1) {
      return skip(
        note.noteId,
        word,
        "ambiguous-jmdict-spelling",
        sameSpellingEntries.map((match) => match.id).join(", "),
      );
    }

    let senseResolution: SenseResolution = { status: "not-needed" };
    if (entry.sense.length > 1) {
      const compatibleSenses = compatibleSenseNumbersForJMDictUsage(
        entry,
        keyRecognitionTarget,
        entry.kanji.some(({ text }) => text === keyRecognitionTarget) ? selectedReading : undefined,
      );
      senseResolution = compatibleSenses.length === 1
        ? { status: "determined", applicableSenses: compatibleSenses }
        : { status: "pending", compatibleSenses };
    }

    const targetFields = {
      "Key": card.key,
      "Recognition target": displayTarget.recognitionTarget,
      "Reading": displayTarget.reading ?? "",
      "Hint": card.hint ?? "",
      "Full context": card.fullContext,
      "Minimized context": card.minimizedContext ?? "",
      "Dictionary entry": card.dictionaryEntry,
      "Source": card.source ?? "",
    };

    return {
      candidate: {
        noteId: note.noteId,
        approved: fullContextResolution.status !== "source-unavailable",
        jmdictId: entry.id,
        recognitionTarget: displayTarget.recognitionTarget,
        keyRecognitionTarget,
        ...(recognitionTargetOverride === undefined ? {} : { recognitionTargetOverride }),
        readingKana: selectedReading,
        senseSelectionContext: senseSelectionEPUBMatch === null
          ? context
          : epubSenseSelectionContext(senseSelectionEPUBMatch),
        sourceResolution,
        targetInContextResolution,
        fullContextResolution,
        minimizedContextResolution: needsAIMinimizedContext(card.fullContext)
          ? { status: "pending" }
          : { status: "not-needed" },
        senseResolution,
        original: await snapshotNote(note),
        target: { modelName: options.targetModel, fields: targetFields },
      },
    };
  } catch (error) {
    return skip(
      note.noteId,
      word,
      "card-generation-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
