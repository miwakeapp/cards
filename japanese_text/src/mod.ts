const SMALL_HIRAGANA_BY_FULL_SIZE_HIRAGANA = new Map([
  ["あ", "ぁ"],
  ["い", "ぃ"],
  ["う", "ぅ"],
  ["え", "ぇ"],
  ["お", "ぉ"],
  ["や", "ゃ"],
  ["ゆ", "ゅ"],
  ["よ", "ょ"],
  ["つ", "っ"],
  ["わ", "ゎ"],
  ["か", "ゕ"],
  ["け", "ゖ"],
]);

/**
 * Converts ordinary katakana to hiragana for kana-script-insensitive comparisons.
 *
 * This is a comparison key, not a canonical spelling: callers should retain the original text
 * for display and storage.
 */
export function toHiragana(text: string): string {
  return [...text].map((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0x30A1 && codePoint <= 0x30F6
      ? String.fromCodePoint(codePoint - 0x60)
      : character;
  }).join("");
}

/** Whether `text` contains at least one Han-script character. */
export function containsKanji(text: string): boolean {
  return /\p{Script=Han}/v.test(text);
}

/** Whether `text` consists of exactly one Han-script character. */
export function isKanji(text: string): boolean {
  return /^\p{Script=Han}$/v.test(text);
}

/**
 * Returns the ordinary small-kana counterpart of one full-size kana character.
 *
 * The result preserves hiragana versus katakana. This is the inverse of the common
 * `text-transform: full-size-kana` mappings used to make small ruby annotations more legible.
 * Returns `undefined` for a character with no ordinary small-kana counterpart.
 *
 * @throws {RangeError} If `character` does not contain exactly one Unicode code point.
 */
export function smallKanaForFullSizeKana(character: string): string | undefined {
  if ([...character].length !== 1) {
    throw new RangeError("character must contain exactly one Unicode code point");
  }

  const hiragana = toHiragana(character);
  const smallHiragana = SMALL_HIRAGANA_BY_FULL_SIZE_HIRAGANA.get(hiragana);
  if (smallHiragana === undefined) return undefined;

  const codePoint = character.codePointAt(0)!;
  return codePoint >= 0x30A1 && codePoint <= 0x30F6
    ? String.fromCodePoint(smallHiragana.codePointAt(0)! + 0x60)
    : smallHiragana;
}
