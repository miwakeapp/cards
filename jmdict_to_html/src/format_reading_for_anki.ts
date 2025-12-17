import { jmdictFurigana } from "data";

const furigana = await jmdictFurigana();

/**
 * Formats a (jmdictId, word, reading) triple into Anki-style furigana format.
 * For example, ("1234567", "大人買い", "おとながい") becomes "大人[おとな] 買[が]い"
 * and ("2345678", "頑張る", "がんばる") becomes "頑[がん] 張[ば]る".
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
export function formatReadingForAnki(
  jmdictId: string,
  word: string,
  reading: string,
): string | null {
  // Kana-only words: if word equals reading, return it unchanged
  if (word === reading) {
    return word;
  }

  const key = `${jmdictId}|${word}|${reading}`;
  return furigana[key] ?? null;
}
