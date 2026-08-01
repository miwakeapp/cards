import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { compatibleSenseNumbersForJMDictUsage, createCard, type MiwakeCard } from "card_creator";
import { toHiragana } from "japanese_text";
import {
  deriveLookupSpellings,
  findAllEntriesBySpelling,
  markContextTargetOccurrences,
  markContextTargets,
  markedContextHasRuby,
  type RenderedTextOccurrence,
  resolveContextTarget,
  type SpellingIndex,
} from "card_resolution";
import { normalizeRecognitionTarget } from "../shared/jmdict_resolution/csv_resolution.ts";
import {
  applyDisplayTargetOverride,
  disambiguationHintForJMDictUsage,
  hasBoundaryNotation,
  normalizeNotationMarkers,
  removeBoundaryNotation,
} from "./display_target.ts";
import {
  type JMDictEntrySelectionOverride,
  type UnresolvedJMDictEntry,
} from "./entry_selection.ts";
import {
  contextPlainText,
  extractJMDictIDs,
  kanaScriptsMatch,
  normalizeContextHTML,
  normalizePlainText,
  parseRecognitionTargetField,
  readingFieldCandidates,
} from "./html.ts";
import { needsAIMinimizedContext } from "../shared/context_minimization_policy.ts";
import {
  analyzeEPUBContext,
  cardSourceFromResolution,
  type EPUBContextMatch,
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
  | {
    candidate: ConversionCandidate;
    skipped?: never;
    unresolvedJMDictEntry?: never;
    unresolvedTargetInContext?: never;
  }
  | {
    candidate?: never;
    skipped: SkippedNote;
    unresolvedJMDictEntry?: UnresolvedJMDictEntry;
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
  occurrences: RenderedTextOccurrence[];
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
  entrySelectionOverride?: JMDictEntrySelectionOverride,
): Promise<
  | {
    entry: JMdictWord;
    recognitionTarget: string;
    recognitionTargetOverride: string | undefined;
  }
  | { reason: string; detail?: string; candidateIds?: string[]; allowedIds?: string[] }
> {
  let entry: JMdictWord;
  const extractedIds = extractJMDictIDs(glossary);
  const selectedId = entrySelectionOverride?.jmdictId ?? entryIdOverride;
  if (
    entrySelectionOverride !== undefined &&
    (
      !entrySelectionOverride.candidateJMDictIds.includes(entrySelectionOverride.jmdictId) ||
      !entrySelectionOverride.allowedJMDictIds.includes(entrySelectionOverride.jmdictId) ||
      (
        entryIdOverride === undefined &&
        extractedIds.length > 0 &&
        !extractedIds.includes(entrySelectionOverride.jmdictId)
      )
    )
  ) {
    return {
      reason: "invalid-jmdict-entry-selection",
      detail: entrySelectionOverride.jmdictId,
    };
  }
  if (
    entrySelectionOverride !== undefined && entryIdOverride !== undefined &&
    entrySelectionOverride.jmdictId !== entryIdOverride
  ) {
    return {
      reason: "conflicting-jmdict-overrides",
      detail: `${entrySelectionOverride.jmdictId}, ${entryIdOverride}`,
    };
  }
  if (selectedId !== undefined) {
    const found = entries.get(selectedId);
    if (!found) {
      return { reason: "missing-jmdict-entry", detail: selectedId };
    }
    entry = found;
  } else if (extractedIds.length > 1) {
    const lookupSpelling = removeBoundaryNotation(word);
    const sameSpellingIds = findAllEntriesBySpelling(spellingIndex, lookupSpelling)
      .map(({ id }) => id);
    return {
      reason: "multiple-jmdict-ids",
      detail: extractedIds.join(", "),
      candidateIds: [...new Set([...extractedIds, ...sameSpellingIds])],
      allowedIds: extractedIds,
    };
  } else if (extractedIds.length === 1) {
    const extractedId = extractedIds[0];
    const found = entries.get(extractedId);
    if (!found) {
      return { reason: "missing-jmdict-entry", detail: extractedId };
    }
    entry = found;
  } else {
    const matches = findAllEntriesBySpelling(spellingIndex, word);
    if (matches.length === 0) {
      return { reason: "no-jmdict-id-or-exact-match" };
    }
    if (matches.length > 1) {
      return {
        reason: "ambiguous-jmdict-match",
        detail: matches.map((match) => match.id).join(", "),
        candidateIds: matches.map(({ id }) => id),
        allowedIds: matches.map(({ id }) => id),
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

function isSearchOnlyReading(entry: JMdictWord, reading: string): boolean {
  return entry.kana.find(({ text }) => text === reading)?.tags.includes("sk") === true;
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

  const existingCandidates = readingFieldCandidates(existingReadingHTML).map(
    removeBoundaryNotation,
  );
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
    const exact = exactMatching[0];
    const canonicalEquivalent = readings.filter((reading) =>
      !isSearchOnlyReading(entry, reading) && kanaScriptsMatch(reading, exact)
    );
    if (!isSearchOnlyReading(entry, exact) || canonicalEquivalent.length === 0) {
      return { reading: exact };
    }
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
    const canonical = matching.filter((reading) => !isSearchOnlyReading(entry, reading));
    const preferred = canonical.length > 0 ? canonical : matching;
    if (preferred.length === 1) {
      return { reading: preferred[0] };
    }
    const scores = preferred.map((reading) => sourceOrthographyScore(reading, recognitionTarget));
    const highestScore = Math.max(...scores);
    const closestToTarget = preferred.filter((_, index) => scores[index] === highestScore);
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

function buildUnresolvedJMDictEntry(
  context: string,
  fullContext: string,
  recognitionTarget: string,
  existingReadingHTML: string,
  candidateIds: string[],
  allowedIds: string[],
  entries: Map<string, JMdictWord>,
  kanaReadingEvidence: UnresolvedJMDictEntry["kanaReadingEvidence"],
  selectedReading?: string,
): UnresolvedJMDictEntry | { reason: string; detail: string } {
  const missingIds = candidateIds.filter((id) => !entries.has(id));
  if (missingIds.length > 0) {
    return {
      reason: "missing-jmdict-entry",
      detail: missingIds.join(", "),
    };
  }
  const candidateEntries = candidateIds
    .map((id) => entries.get(id)!)
    .filter((entry) => entrySpellings(entry).includes(recognitionTarget));
  const candidateEntryIds = new Set(candidateEntries.map(({ id }) => id));
  const unavailableAllowedIds = allowedIds.filter((id) => !candidateEntryIds.has(id));
  if (unavailableAllowedIds.length > 0) {
    return {
      reason: "jmdict-entry-selection-target-mismatch",
      detail: `${JSON.stringify(recognitionTarget)} is not a spelling of ${
        unavailableAllowedIds.join(", ")
      }`,
    };
  }
  if (candidateEntries.length < 2) {
    return {
      reason: "jmdict-entry-selection-needs-multiple-candidates",
      detail: candidateEntries.map(({ id }) => id).join(", ") || "none",
    };
  }

  let kanaReading = selectedReading;
  if (kanaReading === undefined) {
    const mergedEntry: JMdictWord = {
      id: `entry-selection:${candidateEntries.map(({ id }) => id).join(",")}`,
      kanji: candidateEntries.flatMap(({ kanji }) => kanji),
      kana: candidateEntries.flatMap(({ kana }) => kana),
      sense: candidateEntries.flatMap(({ sense }) => sense),
    };
    const result = chooseReading(mergedEntry, recognitionTarget, existingReadingHTML);
    if (!("reading" in result)) {
      return {
        reason: "jmdict-entry-selection-reading-unresolved",
        detail: result.detail ?? result.reason,
      };
    }
    kanaReading = result.reading;
  }

  return {
    context,
    fullContext,
    recognitionTarget,
    kanaReading,
    kanaReadingEvidence,
    candidateEntries,
    allowedJMDictIds: [...new Set(allowedIds)],
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
    jmdictEntrySelectionOverride?: JMDictEntrySelectionOverride;
    epubSourceCorpus?: EPUBSourceCorpus;
    /** Retains the future sense-selection pipeline without enabling it in normal preparation. */
    includeMultipleSenses?: boolean;
    /** Accepts the original Animecard context as final when no source can be resolved. */
    includeSourceless?: boolean;
    /** Lets a shared spelling reach entry selection without admitting unrelated multi-sense cards. */
    resolveAmbiguousEntries?: boolean;
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
  if (sourceResolution.name === null && options.includeSourceless !== true) {
    return skip(note.noteId, word, "no-source");
  }

  let contextHTML = options.contextOverride?.html ?? originalContextHTML;
  let epubContextMatch: EPUBContextMatch | null = null;
  let senseSelectionEPUBMatch: EPUBContextMatch | null = null;
  let fullContextResolution: FullContextResolution = options.contextOverride?.resolution ??
    (sourceResolution.name === null
      ? { status: "restored", method: "original" }
      : { status: "source-unavailable" });
  if (options.epubSourceCorpus !== undefined && sourceResolution.name !== null) {
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
    if (analysis.status === "complete" || analysis.status === "cut-off") {
      epubContextMatch = analysis.match;
    }
    if (options.contextOverride === undefined && analysis.status === "complete") {
      contextHTML = normalizeContextHTML(analysis.contextHTML);
      fullContextResolution = analysis.dialogueElided === true
        ? { status: "restored", method: "deterministic" }
        : {
          status: "pending",
          source: analysis.match.source,
          requiredContextHTML: contextHTML,
        };
    } else if (options.contextOverride === undefined && analysis.status === "cut-off") {
      fullContextResolution = {
        status: "pending",
        source: analysis.match.source,
        requiredContextHTML: originalContextHTML,
      };
    }
  }

  let context = contextPlainText(contextHTML);
  if (!context) {
    return skip(note.noteId, word, "empty-sentence");
  }
  const senseSelectionContext = () =>
    senseSelectionEPUBMatch === null ? context : epubSenseSelectionContext(senseSelectionEPUBMatch);

  const resolution = await resolveEntry(
    word,
    context,
    fieldValue(note, options.sourceFields.glossary),
    options.entries,
    options.spellingIndex,
    options.jmdictIdOverride,
    options.jmdictEntrySelectionOverride,
  );
  if (!("entry" in resolution)) {
    if (resolution.candidateIds !== undefined && resolution.allowedIds !== undefined) {
      const unresolved = buildUnresolvedJMDictEntry(
        senseSelectionContext(),
        context,
        removeBoundaryNotation(word),
        fieldValue(note, options.sourceFields.reading),
        resolution.candidateIds,
        resolution.allowedIds,
        options.entries,
        "animecard",
      );
      if ("candidateEntries" in unresolved) {
        return {
          skipped: {
            noteId: note.noteId,
            word,
            reason: resolution.reason,
            detail: resolution.detail,
          },
          unresolvedJMDictEntry: unresolved,
        };
      }
      return skip(note.noteId, word, unresolved.reason, unresolved.detail);
    }
    return skip(note.noteId, word, resolution.reason, resolution.detail);
  }
  const { entry, recognitionTargetOverride } = resolution;
  let { recognitionTarget } = resolution;
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
    candidateContextHTML = contextHTML,
    allowSingleCharacterSubstring = false,
  ): Promise<SurfaceFormMatches> {
    const surfaces: string[] = [];
    const occurrences = new Map<string, RenderedTextOccurrence>();
    const byLookupSpelling: SurfaceFormMatches["byLookupSpelling"] = [];
    const partOfSpeech = new Set(entry.sense.flatMap((sense) => sense.partOfSpeech));
    for (const lookupSpelling of new Set(lookupSpellings)) {
      const resolved = await resolveContextTarget(candidateContextHTML, lookupSpelling, {
        partOfSpeech,
        allowSingleCharacterSubstring,
      });
      if (resolved !== null) {
        byLookupSpelling.push({
          lookupSpelling,
          surfaces: [...resolved.surfaces],
        });
        surfaces.push(...resolved.surfaces);
        for (const occurrence of resolved.occurrences) {
          occurrences.set(`${occurrence.start}:${occurrence.end}`, occurrence);
        }
      }
    }
    return {
      surfaces: [...new Set(surfaces)],
      occurrences: [...occurrences.values()].sort((left, right) => left.start - right.start),
      byLookupSpelling,
    };
  }
  let surfaceMatches: SurfaceFormMatches;
  try {
    surfaceMatches = await findSurfaceForms([recognitionTarget]);
    if (surfaceMatches.surfaces.length === 0) {
      surfaceMatches = await findSurfaceForms(readings);
    }
    if (surfaceMatches.surfaces.length === 0) {
      surfaceMatches = await findSurfaceForms(entrySpellings(entry));
    }
    if (surfaceMatches.surfaces.length === 0 && epubContextMatch !== null) {
      const sourceSurfaceMatches = await findSurfaceForms(
        [recognitionTarget, ...readings, ...entrySpellings(entry)],
        epubContextMatch.paragraphs.map(({ html }) => `<p>${html}</p>`).join(""),
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
          surfaceMatches = await findSurfaceForms(
            [recognitionTarget, ...readings, ...entrySpellings(entry)],
            contextHTML,
            true,
          );
          fullContextResolution = {
            status: "pending",
            source: epubContextMatch.source,
            requiredContextHTML: contextHTML,
          };
        }
      }
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("selects only part of a ruby annotation component")
    ) {
      return skip(note.noteId, word, "ruby-boundary-mismatch", error.message);
    }
    throw error;
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
  const recognitionTargetIsAmbiguous = findAllEntriesBySpelling(
    options.spellingIndex,
    recognitionTarget,
  ).length > 1;
  if (
    entry.sense.length !== 1 &&
    options.includeMultipleSenses !== true &&
    options.jmdictEntrySelectionOverride === undefined &&
    !(options.resolveAmbiguousEntries === true && recognitionTargetIsAmbiguous)
  ) {
    return skip(note.noteId, word, "multiple-jmdict-senses", String(entry.sense.length));
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
    const markedContext = targetInContextResolution.method === "ai"
      // An audited override explicitly identifies a complete phrase intended at every occurrence.
      // It has no dictionary spelling from which deterministic lexical ranges could be recovered.
      ? markContextTargets(contextHTML, uniqueSurfaceForms as [string, ...string[]])
      : markContextTargetOccurrences(contextHTML, surfaceMatches.occurrences);
    const usesReadingField = entry.kanji.some(({ text }) => text === recognitionTarget);
    const entrySelectionOverride = options.jmdictEntrySelectionOverride;
    if (
      entrySelectionOverride !== undefined &&
      (
        entrySelectionOverride.jmdictId !== entry.id ||
        entrySelectionOverride.recognitionTarget !== recognitionTarget
      )
    ) {
      return skip(
        note.noteId,
        word,
        "stale-jmdict-entry-selection",
        `${entrySelectionOverride.jmdictId} / ${
          JSON.stringify(entrySelectionOverride.recognitionTarget)
        } became ${entry.id} / ${JSON.stringify(recognitionTarget)}`,
      );
    }
    const selectedSensesForReading = (reading: string | undefined): number[] | undefined => {
      if (entrySelectionOverride === undefined) return undefined;
      const compatible = compatibleSenseNumbersForJMDictUsage(
        entry,
        recognitionTarget,
        usesReadingField ? reading : undefined,
      );
      const selected = [...new Set(entrySelectionOverride.applicableSenseNumbers)]
        .toSorted((left, right) => left - right);
      if (
        selected.length === 0 ||
        selected.some((number) => !compatible.includes(number)) ||
        selected.length !== entrySelectionOverride.applicableSenseNumbers.length
      ) {
        throw new Error(
          `JMDict entry selection chose senses ${
            JSON.stringify(entrySelectionOverride.applicableSenseNumbers)
          }, but recognitionTarget ${JSON.stringify(recognitionTarget)} and kanaReading ${
            JSON.stringify(reading)
          } permit ${JSON.stringify(compatible)} in entry ${entry.id}.`,
        );
      }
      return selected.length === compatible.length &&
          selected.every((number, index) => number === compatible[index])
        ? undefined
        : selected;
    };
    const renderCard = (reading: string | undefined) => {
      const applicableSenseNumbers = selectedSensesForReading(reading);
      return createCard({
        jmdictEntry: entry,
        recognitionTarget,
        ...(usesReadingField ? { kanaReading: reading } : {}),
        ...(applicableSenseNumbers === undefined ? {} : { applicableSenseNumbers }),
        ...(entrySelectionOverride?.hint === undefined || entrySelectionOverride.hint === null
          ? {}
          : { hint: entrySelectionOverride.hint }),
        fullContext: markedContext,
        source: cardSourceFromResolution(sourceResolution),
      });
    };

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
    const sameSpellingEntries = findAllEntriesBySpelling(
      options.spellingIndex,
      keyRecognitionTarget,
    );
    const displayHint = entrySelectionOverride === undefined
      ? card.hint ?? undefined
      : disambiguationHintForJMDictUsage(
        card.hint ?? undefined,
        displayTarget.recognitionTarget,
        keyRecognitionTarget,
        entry,
        entrySelectionOverride.applicableSenseNumbers,
        sameSpellingEntries,
      );
    if (sameSpellingEntries.length > 1) {
      const sameSpellingIds = sameSpellingEntries.map(({ id }) => id);
      const overrideCoversAmbiguity = entrySelectionOverride !== undefined &&
        entrySelectionOverride.recognitionTarget === keyRecognitionTarget &&
        sameSpellingIds.every((id) => entrySelectionOverride.candidateJMDictIds.includes(id));
      if (!overrideCoversAmbiguity) {
        const unresolved = buildUnresolvedJMDictEntry(
          senseSelectionContext(),
          context,
          keyRecognitionTarget,
          fieldValue(note, options.sourceFields.reading),
          sameSpellingIds,
          [entry.id],
          options.entries,
          markedContextHasRuby(markedContext) ? "source-ruby" : "animecard",
          selectedReading,
        );
        if ("candidateEntries" in unresolved) {
          return {
            skipped: {
              noteId: note.noteId,
              word,
              reason: "ambiguous-jmdict-spelling",
              detail: sameSpellingIds.join(", "),
            },
            unresolvedJMDictEntry: unresolved,
          };
        }
        return skip(note.noteId, word, unresolved.reason, unresolved.detail);
      }
    }

    let senseResolution: SenseResolution = { status: "not-needed" };
    if (entrySelectionOverride !== undefined && entry.sense.length > 1) {
      const compatibleSenses = compatibleSenseNumbersForJMDictUsage(
        entry,
        keyRecognitionTarget,
        entry.kanji.some(({ text }) => text === keyRecognitionTarget) ? selectedReading : undefined,
      );
      const applicableSenses = selectedSensesForReading(selectedReading) ?? [];
      senseResolution = {
        status: "generated",
        model: entrySelectionOverride.model,
        generatedAt: entrySelectionOverride.generatedAt,
        compatibleSenses,
        applicableSenses,
      };
    } else if (entry.sense.length > 1) {
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
      "Hint": displayHint ?? "",
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
        senseSelectionContext: senseSelectionContext(),
        sourceResolution,
        targetInContextResolution,
        fullContextResolution,
        minimizedContextResolution: needsAIMinimizedContext(card.fullContext)
          ? { status: "pending" }
          : { status: "not-needed" },
        senseResolution,
        ...(entrySelectionOverride === undefined ? {} : {
          jmdictEntryResolution: {
            model: entrySelectionOverride.model,
            generatedAt: entrySelectionOverride.generatedAt,
            applicableSenseNumbers: entrySelectionOverride.applicableSenseNumbers,
            hint: disambiguationHintForJMDictUsage(
              entrySelectionOverride.hint ?? undefined,
              displayTarget.recognitionTarget,
              keyRecognitionTarget,
              entry,
              entrySelectionOverride.applicableSenseNumbers,
              sameSpellingEntries,
            ) ?? null,
            candidateJMDictIds: entrySelectionOverride.candidateJMDictIds,
            allowedJMDictIds: entrySelectionOverride.allowedJMDictIds,
          },
        }),
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
