const ANKI_FURIGANA_PATTERN =
  /(?:^| )([^  \[\]]+)\[([\p{Script=Hiragana}\p{Script=Katakana}ー]+)\]/gu;

/** Converts HTML-escaped Anki bracket furigana in one text node to ruby HTML. */
export function furiganaToRuby(escapedText: string): string {
  return escapedText.replace(
    ANKI_FURIGANA_PATTERN,
    (_match, base, reading) => `<ruby>${base}<rt>${reading}</rt></ruby>`,
  );
}
