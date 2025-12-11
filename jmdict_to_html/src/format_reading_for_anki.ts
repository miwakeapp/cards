import jmdictFuriganaData from "./jmdict_furigana.json" with { type: "json" };

type FuriganaSegment = {
  ruby: string;
  rt?: string;
};

type FuriganaEntry = {
  text: string;
  reading: string;
  furigana: FuriganaSegment[];
};

// Build a lookup map indexed by "text|reading"
const furiganaMap = new Map<string, FuriganaEntry>();
for (const entry of jmdictFuriganaData as FuriganaEntry[]) {
  const key = `${entry.text}|${entry.reading}`;
  furiganaMap.set(key, entry);
}

/**
 * Formats a (word, reading) pair into Anki-style furigana format.
 * For example, (大人買い, おとながい) becomes "大人[おとな] 買[が]い"
 * and (頑張る, がんばる) becomes "頑[がん] 張[ば]る".
 *
 * Rules:
 * - No trailing whitespace
 * - A space before each kanji (except at the very start)
 * - Kanji segments are followed by [reading]
 * - Kana-only segments are rendered as-is
 *
 * For kana-only words (where word === reading), returns the word as-is.
 * Returns null if the word/reading pair is not found in the database.
 */
export function formatReadingForAnki(word: string, reading: string): string | null {
  // Kana-only words: if word equals reading, return it unchanged
  if (word === reading) {
    return word;
  }

  const key = `${word}|${reading}`;
  const entry = furiganaMap.get(key);
  if (!entry) {
    return null;
  }

  let result = "";
  for (const segment of entry.furigana) {
    const hasKanji = segment.rt !== undefined;
    if (hasKanji) {
      // Add space before kanji if not at the start
      if (result.length > 0) {
        result += " ";
      }
      result += `${segment.ruby}[${segment.rt}]`;
    } else {
      // Pure kana segment
      result += segment.ruby;
    }
  }

  return result;
}
