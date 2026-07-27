import { toHiragana } from "japanese_text";

// Lorenzi's matcher treats these characters as orthographic separators rather than sounds. Its
// exported segmentation can therefore omit one that remains present in the corresponding JMDict
// reading, as in `ＯＢ` / `オー・ビー`.
const IGNORED_READING_SEPARATORS = /[・、。．＝?？\-−]/gu;

function normalizeReading(reading: string): string {
  return toHiragana(reading).replace(IGNORED_READING_SEPARATORS, "");
}

/** Builds an exact key for the generated JMDict furigana lookup. */
export function furiganaKey(
  jmdictId: string,
  spelling: string,
  reading: string,
): string {
  return `${jmdictId}|${spelling}|${reading}`;
}

/**
 * Builds the comparison key corresponding to the reading normalization performed by Lorenzi's
 * matcher.
 */
export function normalizedFuriganaKey(
  jmdictId: string,
  spelling: string,
  reading: string,
): string {
  return furiganaKey(jmdictId, spelling, normalizeReading(reading));
}
