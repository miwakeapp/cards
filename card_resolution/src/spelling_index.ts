import type { JMDictWord } from "data";
import type { SpellingIndex } from "./recognition_target.ts";

/**
 * Finds every entry containing an exact spelling in either JMDict form category.
 *
 * This differs from `findEntriesBySpelling()`, whose kanji-form precedence is useful while
 * resolving an unknown dictionary target. Once a spelling is displayed on a card front, every
 * same-text entry is a potential contrast regardless of whether JMDict records that text as a
 * kanji spelling or a kana reading. Entries present in both categories are returned only once.
 */
export function findAllEntriesBySpelling(
  index: SpellingIndex,
  spelling: string,
): JMDictWord[] {
  const byId = new Map<string, JMDictWord>();
  for (const entry of index.kanji.get(spelling) ?? []) {
    byId.set(entry.id, entry);
  }
  for (const entry of index.kana.get(spelling) ?? []) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}
