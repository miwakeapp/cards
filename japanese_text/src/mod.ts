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
