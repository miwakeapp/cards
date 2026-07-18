import type { JMDictWord } from "../../src/jmdict_types.ts";

interface Segment {
  base: string;
  reading: string;
}

interface SourceRow {
  id: string;
  word: string;
  reading: string;
  segments: Segment[];
}

/** Statistics about converting Lorenzi's Jisho data into Miwake's lookup table. */
export interface FuriganaImportStats {
  /** Rows read directly from Lorenzi's Jisho. */
  sourceRows: number;
  /** Missing `sK` rows reconstructed unambiguously from sibling spellings. */
  derivedSearchOnlyKanjiRows: number;
  /** Missing `sK` rows for which sibling spellings did not determine a unique result. */
  unresolvedSearchOnlyKanjiRows: number;
}

/** The result of importing Lorenzi's Jisho data and restoring omitted JMDict spellings. */
export interface FuriganaImportResult {
  /** Exact `(JMDict ID, spelling, reading)` lookups in Anki's furigana syntax. */
  data: Record<string, string>;
  /** Import and reconstruction counts. */
  stats: FuriganaImportStats;
}

function normalizeKanaScript(text: string): string {
  return [...text].map((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0x30A1 && codePoint <= 0x30F6
      ? String.fromCodePoint(codePoint - 0x60)
      : character;
  }).join("");
}

function parseSourceRow(line: string, lineNumber: number): SourceRow {
  const parts = line.split(";");
  if (parts.length !== 3) {
    throw new Error(`Invalid furigana data on line ${lineNumber}: ${line}`);
  }

  const [id, dottedWord, dottedReading] = parts;
  const bases = dottedWord.split(".");
  const readings = dottedReading.split(".");
  if (bases.length !== readings.length) {
    throw new Error(
      `Mismatched furigana segments on line ${lineNumber}: ${dottedWord} / ${dottedReading}`,
    );
  }

  return {
    id,
    word: bases.join(""),
    reading: readings.join(""),
    segments: bases.map((base, index) => ({ base, reading: readings[index] })),
  };
}

function toAnkiFormat(segments: readonly Segment[]): string {
  let result = "";
  for (const { base, reading } of segments) {
    if (base === reading) {
      result += base;
    } else {
      result += `${result === "" ? "" : " "}${base}[${reading}]`;
    }
  }
  return result;
}

function transferToSpelling(segments: readonly Segment[], targetWord: string): string | null {
  const targetCharacters = [...targetWord];
  const transferred: Segment[] = [];
  let targetIndex = 0;

  for (const segment of segments) {
    const baseLength = [...segment.base].length;
    const targetBase = targetCharacters.slice(targetIndex, targetIndex + baseLength).join("");
    if (targetBase === segment.base) {
      transferred.push(segment);
      targetIndex += baseLength;
      continue;
    }

    const readingLength = [...segment.reading].length;
    const targetReading = targetCharacters.slice(targetIndex, targetIndex + readingLength).join("");
    if (normalizeKanaScript(targetReading) !== normalizeKanaScript(segment.reading)) {
      return null;
    }
    transferred.push({ base: targetReading, reading: targetReading });
    targetIndex += readingLength;
  }

  return targetIndex === targetCharacters.length ? toAnkiFormat(transferred) : null;
}

function appliesToKanji(reading: JMDictWord["kana"][number], kanji: string): boolean {
  return reading.appliesToKanji.includes("*") || reading.appliesToKanji.includes(kanji);
}

/**
 * Builds Miwake's exact furigana lookup from Lorenzi's Jisho output.
 *
 * Lorenzi's importer calculates furigana for JMDict's search-only kanji (`sK`) spellings, but its
 * current exporter omits them. Restore the safely transferable subset from another spelling in the
 * same JMDict entry with the same reading. A transfer is accepted only when every successful source
 * spelling produces the same complete result.
 */
export function importFurigana(
  source: string,
  words: readonly JMDictWord[],
): FuriganaImportResult {
  const targetsByEntryAndReading = new Map<
    string,
    { id: string; word: string; reading: string }[]
  >();
  for (const entry of words) {
    for (const kanji of entry.kanji) {
      if (!kanji.tags.includes("sK")) continue;
      for (const reading of entry.kana) {
        if (!appliesToKanji(reading, kanji.text)) continue;
        const indexKey = `${entry.id}|${normalizeKanaScript(reading.text)}`;
        const targets = targetsByEntryAndReading.get(indexKey) ?? [];
        targets.push({ id: entry.id, word: kanji.text, reading: reading.text });
        targetsByEntryAndReading.set(indexKey, targets);
      }
    }
  }

  const data: Record<string, string> = {};
  const sourcesByEntryAndReading = new Map<string, Segment[][]>();
  let sourceRows = 0;
  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "" || line.startsWith("#")) continue;

    const row = parseSourceRow(line, index + 1);
    const key = `${row.id}|${row.word}|${row.reading}`;
    const formatted = toAnkiFormat(row.segments);
    const existing = data[key];
    if (existing !== undefined && existing !== formatted) {
      throw new Error(`Conflicting furigana rows for ${key}`);
    }
    data[key] = formatted;
    sourceRows++;

    const indexKey = `${row.id}|${normalizeKanaScript(row.reading)}`;
    if (targetsByEntryAndReading.has(indexKey)) {
      const segmentations = sourcesByEntryAndReading.get(indexKey) ?? [];
      segmentations.push(row.segments);
      sourcesByEntryAndReading.set(indexKey, segmentations);
    }
  }

  let derivedSearchOnlyKanjiRows = 0;
  let unresolvedSearchOnlyKanjiRows = 0;
  for (const [indexKey, targets] of targetsByEntryAndReading) {
    const segmentations = sourcesByEntryAndReading.get(indexKey) ?? [];
    for (const target of targets) {
      const key = `${target.id}|${target.word}|${target.reading}`;
      if (data[key] !== undefined) continue;

      const results = new Set<string>();
      for (const segmentation of segmentations) {
        const result = transferToSpelling(segmentation, target.word);
        if (result !== null) results.add(result);
      }
      if (results.size === 1) {
        data[key] = results.values().next().value!;
        derivedSearchOnlyKanjiRows++;
      } else {
        unresolvedSearchOnlyKanjiRows++;
      }
    }
  }

  return {
    data,
    stats: { sourceRows, derivedSearchOnlyKanjiRows, unresolvedSearchOnlyKanjiRows },
  };
}
