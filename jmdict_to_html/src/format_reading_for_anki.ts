import { jmdictFurigana } from "data";
import { toHiragana } from "japanese_text";

let kanaNormalizedFurigana:
  | { source: Record<string, string>; values: Map<string, string | null> }
  | undefined;

function getKanaNormalizedFurigana(
  furigana: Record<string, string>,
): Map<string, string | null> {
  if (kanaNormalizedFurigana?.source !== furigana) {
    const values = new Map<string, string | null>();
    for (const [key, value] of Object.entries(furigana)) {
      const [jmdictId, word, reading] = key.split("|");
      const normalizedKey = [
        jmdictId,
        toHiragana(word),
        toHiragana(reading),
      ].join("|");
      const existing = values.get(normalizedKey);
      if (existing === undefined) {
        values.set(normalizedKey, value);
      } else if (
        existing !== null && toHiragana(existing) !== toHiragana(value)
      ) {
        values.set(normalizedKey, null);
      }
    }
    kanaNormalizedFurigana = { source: furigana, values };
  }
  return kanaNormalizedFurigana.values;
}

function applyKanaScriptFromWord(formattedReading: string, word: string): string {
  const wordChars = [...word];
  let wordIndex = 0;
  let inReading = false;
  let result = "";

  for (const char of formattedReading) {
    if (char === "[") {
      inReading = true;
      result += char;
      continue;
    }
    if (char === "]") {
      inReading = false;
      result += char;
      continue;
    }
    if (inReading || char === " ") {
      result += char;
      continue;
    }

    const wordChar = wordChars[wordIndex++];
    if (wordChar && toHiragana(char) === toHiragana(wordChar)) {
      result += wordChar;
    } else {
      result += char;
    }
  }

  return result;
}

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
export async function formatReadingForAnki(
  jmdictId: string,
  word: string,
  reading: string,
): Promise<string | null> {
  // Kana-only words: if word equals reading, return it unchanged
  if (word === reading) {
    return word;
  }

  const furigana = await jmdictFurigana();
  const key = `${jmdictId}|${word}|${reading}`;
  const exact = furigana[key];
  if (exact !== undefined) {
    return exact;
  }

  const normalizedKey = [
    jmdictId,
    toHiragana(word),
    toHiragana(reading),
  ].join("|");
  const kanaSwapped = getKanaNormalizedFurigana(furigana).get(normalizedKey);
  if (kanaSwapped !== undefined && kanaSwapped !== null) {
    return applyKanaScriptFromWord(kanaSwapped, word);
  }

  return null;
}
