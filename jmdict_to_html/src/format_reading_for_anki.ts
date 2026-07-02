import { jmdictFurigana } from "data";

const furigana = await jmdictFurigana();
let kanaNormalizedFurigana: Map<string, string> | null = null;

function normalizeKanaScript(text: string): string {
  return [...text].map((char) => {
    const codePoint = char.codePointAt(0)!;
    if (codePoint >= 0x30A1 && codePoint <= 0x30F6) {
      return String.fromCodePoint(codePoint - 0x60);
    }
    return char;
  }).join("");
}

function getKanaNormalizedFurigana(): Map<string, string> {
  if (kanaNormalizedFurigana === null) {
    kanaNormalizedFurigana = new Map();
    for (const [key, value] of Object.entries(furigana)) {
      const [jmdictId, word, reading] = key.split("|");
      const normalizedKey = [
        jmdictId,
        normalizeKanaScript(word),
        normalizeKanaScript(reading),
      ].join("|");
      kanaNormalizedFurigana.set(normalizedKey, value);
    }
  }
  return kanaNormalizedFurigana;
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
    if (wordChar && normalizeKanaScript(char) === normalizeKanaScript(wordChar)) {
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
  const exact = furigana[key];
  if (exact !== undefined) {
    return exact;
  }

  const normalizedKey = [
    jmdictId,
    normalizeKanaScript(word),
    normalizeKanaScript(reading),
  ].join("|");
  const kanaSwapped = getKanaNormalizedFurigana().get(normalizedKey);
  if (kanaSwapped !== undefined) {
    return applyKanaScriptFromWord(kanaSwapped, word);
  }

  return null;
}
