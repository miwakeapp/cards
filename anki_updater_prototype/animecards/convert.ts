import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { createCard, formatMiwakeKey, needsAIMinimizedContext } from "card_creator";
import { formatReadingForAnki } from "jmdict_to_html/format-reading-for-anki";
import {
  deriveLookupSpellings,
  findEntriesBySpelling,
  findSurfaceFormsForLookupSpelling,
  type SpellingIndex,
} from "../shared/jmdict_resolution/recognition_target_lookup.ts";
import { normalizeRecognitionTarget } from "../shared/jmdict_resolution/csv_resolution.ts";
import {
  contextPlainText,
  extractJMDictIDs,
  kanaScriptsMatch,
  normalizeContextHTML,
  normalizePlainText,
  parseRecognitionTargetField,
  readingFieldCandidates,
} from "./html.ts";
import {
  analyzeEPUBContext,
  type EPUBSourceCorpus,
  formatSourceCitation,
  resolveSource,
} from "./source.ts";
import {
  type AnkiNoteInfo,
  type ConversionCandidate,
  type FullContextResolution,
  type SkippedNote,
  snapshotNote,
  type SourceFieldMapping,
  type SourceResolution,
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

type ConversionResult =
  | { candidate: ConversionCandidate; skipped?: never }
  | { candidate?: never; skipped: SkippedNote };

function skip(noteId: number, word: string, reason: string, detail?: string): ConversionResult {
  return { skipped: { noteId, word, reason, detail } };
}

function fieldValue(note: AnkiNoteInfo, fieldName: string | null): string {
  return fieldName === null ? "" : note.fields[fieldName]?.value ?? "";
}

function normalizeNotationMarkers(target: string): string {
  return target.replace(/^[~〜]+|[~〜]+$/gu, (markers) => "～".repeat(markers.length));
}

function entrySpellings(entry: JMdictWord): string[] {
  return [
    ...entry.kanji.map((item) => item.text),
    ...entry.kana.map((item) => item.text),
  ];
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
    keyRecognitionTargetOverride: string | null;
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
  const hasNotationMarker = (word.startsWith("～") || word.endsWith("～")) &&
    spellings.some((spelling) => word.includes(spelling));
  const normalizedTarget = await normalizeRecognitionTarget(context, word, entry);
  const recognitionTarget = hasNotationMarker ||
      spellings.some((spelling) => kanaScriptsMatch(spelling, word))
    ? word
    : normalizedTarget;
  const keyRecognitionTargetOverride = hasNotationMarker ? normalizedTarget : null;
  if (
    !spellings.includes(recognitionTarget) &&
    !spellings.some((spelling) => kanaScriptsMatch(spelling, recognitionTarget)) &&
    !hasNotationMarker
  ) {
    return { reason: "jmdict-target-mismatch", detail: entry.id };
  }

  if (!spellings.includes(word)) {
    const derived = await deriveLookupSpellings(context, word);
    const defensible = derived.some((spelling) => spellings.includes(spelling)) ||
      spellings.some((spelling) => word.includes(spelling)) ||
      spellings.some((spelling) => kanaScriptsMatch(spelling, word));
    if (!defensible) {
      return {
        reason: "jmdict-target-mismatch",
        detail: `${word} does not resolve to entry ${entry.id}`,
      };
    }
  }

  return { entry, recognitionTarget, keyRecognitionTargetOverride };
}

function applicableReadings(entry: JMdictWord, recognitionTarget: string): string[] {
  const containsKanji = /\p{Script=Han}/v.test(recognitionTarget);
  const applicableKanji = entry.kanji
    .map((item) => item.text)
    .filter((spelling) => recognitionTarget.includes(spelling));
  const readings = entry.kana
    .filter((item) =>
      entry.kanji.length === 0 ||
      !containsKanji ||
      item.appliesToKanji.includes("*") ||
      item.appliesToKanji.includes(recognitionTarget) ||
      applicableKanji.some((spelling) => item.appliesToKanji.includes(spelling))
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
    return { reading: matching[0] };
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

function inflectionStemSpellings(entry: JMdictWord, reading: string): string[] {
  const partOfSpeech = new Set(entry.sense.flatMap((sense) => sense.partOfSpeech));
  const stems: string[] = [];
  const godanEndings: Record<string, string> = {
    う: "い",
    く: "き",
    ぐ: "ぎ",
    す: "し",
    つ: "ち",
    ぬ: "に",
    ぶ: "び",
    む: "み",
    る: "り",
  };
  if ([...partOfSpeech].some((value) => value.startsWith("v5"))) {
    const ending = reading.at(-1)!;
    const replacement = godanEndings[ending];
    if (replacement !== undefined) {
      stems.push(`${reading.slice(0, -1)}${replacement}`);
    }
  }
  if (partOfSpeech.has("v1") && reading.endsWith("る")) {
    stems.push(reading.slice(0, -1));
  }
  if (partOfSpeech.has("adj-i") && reading.endsWith("い")) {
    stems.push(reading.slice(0, -1));
  }
  return stems;
}

async function formatNotationMarkerReading(
  entry: JMdictWord,
  recognitionTarget: string,
  reading: string,
  fallback: string | null,
): Promise<string | null> {
  if (!recognitionTarget.startsWith("～") && !recognitionTarget.endsWith("～")) return fallback;
  const containedSpellings = entrySpellings(entry)
    .filter((spelling) => /\p{Script=Han}/v.test(spelling) && recognitionTarget.includes(spelling))
    .sort((left, right) => right.length - left.length);
  for (const spelling of containedSpellings) {
    const formatted = await formatReadingForAnki(entry.id, spelling, reading);
    if (formatted !== null) return recognitionTarget.replace(spelling, formatted);
    if (/^\p{Script=Han}+$/v.test(spelling)) {
      return recognitionTarget.replace(spelling, `${spelling}[${reading}]`);
    }
  }
  return fallback;
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
  let fullContextResolution: FullContextResolution = options.contextOverride?.resolution ?? {
    status: "source-unavailable",
  };
  if (options.contextOverride === undefined && options.epubSourceCorpus !== undefined) {
    const analysis = analyzeEPUBContext(
      options.epubSourceCorpus,
      originalContextHTML,
      sourceResolution.name,
    );
    if (analysis.status === "complete") {
      contextHTML = normalizeContextHTML(analysis.contextHTML);
      fullContextResolution = { status: "restored", method: "exact" };
    } else if (analysis.status === "cut-off") {
      fullContextResolution = { status: "pending", source: analysis.match.source };
    }
  }

  const context = contextPlainText(contextHTML);
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
  const { entry, recognitionTarget, keyRecognitionTargetOverride } = resolution;
  if (entry.sense.length !== 1 && options.includeMultipleSenses !== true) {
    return skip(note.noteId, word, "multiple-jmdict-senses", String(entry.sense.length));
  }
  const readingResult = chooseReading(
    entry,
    recognitionTarget,
    fieldValue(note, options.sourceFields.reading),
  );
  if (!("reading" in readingResult)) {
    return skip(note.noteId, word, readingResult.reason, readingResult.detail);
  }

  async function findSurfaceForms(lookupSpellings: Iterable<string>): Promise<string[]> {
    const found: string[] = [];
    for (const lookupSpelling of new Set(lookupSpellings)) {
      found.push(...await findSurfaceFormsForLookupSpelling(context, lookupSpelling));
    }
    return [...new Set(found)];
  }
  let surfaceForms = await findSurfaceForms([recognitionTarget]);
  if (
    surfaceForms.length === 0 &&
    (recognitionTarget.startsWith("～") || recognitionTarget.endsWith("～"))
  ) {
    surfaceForms = await findSurfaceForms([recognitionTarget.replace(/^～|～$/gu, "")]);
  }
  if (surfaceForms.length === 0) {
    surfaceForms = await findSurfaceForms([readingResult.reading]);
  }
  if (surfaceForms.length === 0) {
    surfaceForms = await findSurfaceForms(entrySpellings(entry));
  }
  if (surfaceForms.length === 0) {
    surfaceForms = await findSurfaceForms(inflectionStemSpellings(entry, readingResult.reading));
  }
  const uniqueSurfaceForms = surfaceForms;
  if (uniqueSurfaceForms.length === 0) {
    return skip(note.noteId, word, "target-not-found-in-sentence", recognitionTarget);
  }
  if (uniqueSurfaceForms.length > 1) {
    return skip(
      note.noteId,
      word,
      "ambiguous-target-in-sentence",
      uniqueSurfaceForms.join(", "),
    );
  }

  try {
    const card = await createCard({
      input: {
        context: contextHTML,
        jmdictId: entry.id,
        recognitionTarget,
        source: sourceResolution.name ?? undefined,
        sourceURL: sourceResolution.url ?? undefined,
      },
      jmdictEntry: entry,
      generateFields: () =>
        Promise.resolve({
          applicableSenses: [],
          reading: readingResult.reading,
          targetInContext: uniqueSurfaceForms[0],
          hint: null,
          minimizedContext: null,
          cleanedSource: null,
          sourceURLIsPublic: sourceResolution.urlIsPublic,
        }),
    });

    if (!card.fullContext.includes("<mark>")) {
      return skip(note.noteId, word, "failed-to-highlight-target", uniqueSurfaceForms[0]);
    }
    const formattedReading = await formatNotationMarkerReading(
      entry,
      card.recognitionTarget,
      readingResult.reading,
      card.reading,
    );
    const keyRecognitionTarget = keyRecognitionTargetOverride ?? card.recognitionTarget;
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

    const targetFields = {
      "Key": formatMiwakeKey(keyRecognitionTarget, entry.id, [], entry.sense.length),
      "Recognition target": card.recognitionTarget,
      "Reading": formattedReading ?? "",
      "Hint": card.hint ?? "",
      "Full context": card.fullContext,
      "Minimized context": card.minimizedContext ?? "",
      "Dictionary entry": card.dictionaryEntry,
      "Source": formatSourceCitation(sourceResolution),
    };

    return {
      candidate: {
        noteId: note.noteId,
        approved: fullContextResolution.status !== "source-unavailable",
        jmdictId: entry.id,
        recognitionTarget: card.recognitionTarget,
        keyRecognitionTarget,
        readingKana: readingResult.reading,
        sourceResolution,
        fullContextResolution,
        minimizedContextResolution: needsAIMinimizedContext(card.fullContext)
          ? { status: "pending" }
          : { status: "not-needed" },
        senseResolution: entry.sense.length === 1
          ? { status: "not-needed" }
          : { status: "pending" },
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
