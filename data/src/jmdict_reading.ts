/**
 * Returns whether a JMDict reading remains eligible for a kanji spelling.
 *
 * `jmdict-simplified` represents an unrestricted reading with `["*"]`, an explicit `re_restr`
 * list with the named spellings, and `re_nokanji` with an empty list. This codebase treats
 * `re_nokanji` as inconclusive rather than as proof that an observed kanji-reading pair is invalid:
 * JMdict also uses the marker for reading-script and orthographic conventions. Explicit
 * `re_restr` lists remain strict.
 *
 * See the JMdict editor discussions for concrete examples:
 * - ダメ元・ダメもと: https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2127710.1~2378045
 * - 糞・フン: https://www.edrdg.org/jmwsgi/entr.py?svc=jmdict&g=2834408.1~2378008
 */
export function readingAppliesToKanji(
  reading: { readonly appliesToKanji: readonly string[] },
  kanjiSpelling: string,
): boolean {
  return reading.appliesToKanji.length === 0 ||
    reading.appliesToKanji.includes("*") ||
    reading.appliesToKanji.includes(kanjiSpelling);
}

/** Returns every entry kanji spelling which remains eligible for a JMDict reading. */
export function kanjiSpellingsForReading(
  entry: { readonly kanji: readonly { readonly text: string }[] },
  reading: { readonly appliesToKanji: readonly string[] },
): Set<string> {
  if (reading.appliesToKanji.length === 0 || reading.appliesToKanji.includes("*")) {
    return new Set(entry.kanji.map(({ text }) => text));
  }
  return new Set(reading.appliesToKanji);
}
