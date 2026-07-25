/** Kana readings indexed by their applicable JMDict kanji spelling. */
export type JMDictReadings = Record<string, string[]>;

/** Builds the compact spelling-to-readings resource used for incidental context ruby. */
export function buildJMDictReadings(
  entries: Iterable<{
    kanji: readonly { text: string }[];
    kana: readonly { text: string; appliesToKanji: readonly string[] }[];
  }>,
): JMDictReadings {
  const index = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const kanji of entry.kanji) {
      for (const kana of entry.kana) {
        if (
          kana.appliesToKanji.includes("*") ||
          kana.appliesToKanji.includes(kanji.text)
        ) {
          let readings = index.get(kanji.text);
          if (readings === undefined) {
            readings = new Set();
            index.set(kanji.text, readings);
          }
          readings.add(kana.text);
        }
      }
    }
  }

  return Object.fromEntries(
    [...index].map(([spelling, readings]) => [spelling, [...readings]]),
  );
}
