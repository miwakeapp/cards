const ANKI_FURIGANA_PATTERN =
  /(?:^| )([^  \[\]]+)\[([\p{Script=Hiragana}\p{Script=Katakana}ー]+)\]/gu;

/**
 * Converts Anki bracket furigana in one rendered text node to its visible surface text.
 *
 * Anki uses a leading ASCII space to separate adjacent annotated bases; that space is control
 * syntax and is not displayed. Bracketed prose whose contents are not a kana reading is preserved.
 */
export function ankiFuriganaToSurface(text: string): string {
  return text.replace(ANKI_FURIGANA_PATTERN, "$1");
}
