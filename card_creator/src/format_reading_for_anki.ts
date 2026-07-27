import { jmdictFuriganaFor, type JMDictWord } from "data";
import { isKanji } from "japanese_text";

/**
 * Formats a JMDict entry's exact spelling and applicable kana reading as Anki-style furigana.
 * For example, ("大人買い", "おとながい") becomes "大人[おとな] 買[が]い" and ("頑張る",
 * "がんばる") becomes "頑[がん] 張[ば]る".
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
  jmdictEntry: JMDictWord,
  spelling: string,
  kanaReading: string,
): Promise<string | null> {
  const kanaForm = jmdictEntry.kana.find(({ text }) => text === spelling);
  if (kanaForm !== undefined) {
    return spelling === kanaReading ? spelling : null;
  }

  const kanjiForm = jmdictEntry.kanji.find(({ text }) => text === spelling);
  const applicableReading = jmdictEntry.kana.find(({ text, appliesToKanji }) =>
    text === kanaReading &&
    (appliesToKanji.includes("*") || appliesToKanji.includes(spelling))
  );
  if (kanjiForm === undefined || applicableReading === undefined) {
    return null;
  }

  if (spelling === kanaReading) {
    return spelling;
  }

  const formatted = await jmdictFuriganaFor(jmdictEntry.id, spelling, kanaReading);
  if (formatted !== undefined) {
    return formatted;
  }

  if (isKanji(spelling)) {
    return `${spelling}[${kanaReading}]`;
  }

  return null;
}
