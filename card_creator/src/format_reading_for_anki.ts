import { jmdictFurigana } from "data";
import { isKanji } from "japanese_text";

/**
 * Formats a JMDict ID, spelling, and kana reading into Anki-style furigana.
 * For example, ("1234567", "大人買い", "おとながい") becomes "大人[おとな] 買[が]い"
 * and ("2345678", "頑張る", "がんばる") becomes "頑[がん] 張[ば]る".
 *
 * Rules:
 * - No trailing whitespace
 * - A space before each kanji (except at the very start)
 * - Kanji segments are followed by [reading]
 * - Kana-only segments are rendered as-is
 *
 * For kana-only spellings (where `spelling === kanaReading`), returns the spelling as-is. A
 * one-kanji spelling is always formatted directly because its only possible annotation boundary
 * is unambiguous. Returns `null` when a longer spelling/reading pair has no unambiguous placement
 * in the furigana data.
 */
export async function formatReadingForAnki(
  jmdictId: string,
  spelling: string,
  kanaReading: string,
): Promise<string | null> {
  if (spelling === kanaReading) {
    return spelling;
  }

  const furigana = await jmdictFurigana();
  const key = `${jmdictId}|${spelling}|${kanaReading}`;
  const exact = furigana[key];
  if (exact !== undefined) {
    return exact;
  }

  if (isKanji(spelling)) {
    return `${spelling}[${kanaReading}]`;
  }

  return null;
}
