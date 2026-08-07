// Async access to Miwake Cards' checked-in and locally generated language resources.

import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { entriesCache } from "./entries_cache.ts";
import { furiganaCache } from "./furigana_cache.ts";
import type { JMDictReadings } from "./jmdict_readings.ts";
import { jmdictReadingsCache } from "./jmdict_readings_cache.ts";
import type { JMDictWord } from "./jmdict_types.ts";
import type { FuriganaData } from "./furigana_import.ts";
import { furiganaKey, normalizedFuriganaKey } from "./furigana_key.ts";
import { resourcePaths } from "./resource_paths.ts";

export type { JMDictWord } from "./jmdict_types.ts";
export { kanjiSpellingsForReading, readingAppliesToKanji } from "./jmdict_reading.ts";

/** JMDict tag expansions. Key: tag abbreviation, value: full description. */
export type JMDictTags = Record<string, string>;

/** Map of JMDict entry ID to entry data. */
export type JMDictEntries = Map<string, JMDictWord>;

// Module-level promises for deduplication. Mutable-resource caches live in separate internal
// modules so their downloaders can invalidate them without exposing cache management publicly.
let tagsPromise: Promise<JMDictTags> | null = null;
const preextractedEntryPromises = new Map<string, Promise<JMDictWord>>();

/**
 * Lazily loads and returns JMDict tag expansions.
 * Safe to call multiple times concurrently - will deduplicate requests.
 */
export function jmdictTags(): Promise<JMDictTags> {
  if (!tagsPromise) {
    tagsPromise = (async () => {
      const content = await Deno.readTextFile(resourcePaths.jmdictTags);
      return JSON.parse(content) as JMDictTags;
    })();
  }
  return tagsPromise;
}

function loadJMDictFurigana(): Promise<FuriganaData> {
  if (!furiganaCache.promise) {
    furiganaCache.promise = (async () => {
      const content = await Deno.readTextFile(resourcePaths.jmdictFurigana);
      return JSON.parse(content) as FuriganaData;
    })();
  }
  return furiganaCache.promise;
}

/**
 * Returns precisely placed Anki furigana for a JMDict spelling and reading, when available.
 *
 * Exact upstream keys take precedence. The fallback accounts only for kana-script differences and
 * orthographic separators ignored by Lorenzi's matcher; callers remain responsible for selecting
 * an exact reading from JMDict.
 */
export async function jmdictFuriganaFor(
  jmdictId: string,
  spelling: string,
  reading: string,
): Promise<string | undefined> {
  const furigana = await loadJMDictFurigana();
  return furigana[furiganaKey(jmdictId, spelling, reading)] ??
    furigana[normalizedFuriganaKey(jmdictId, spelling, reading)];
}

/**
 * Returns the applicable JMDict kana readings for a kanji spelling.
 *
 * The compact index supports validation of incidental source ruby without loading the complete
 * dictionary. An absent spelling has no readings.
 */
export async function jmdictReadingsForSpelling(spelling: string): Promise<readonly string[]> {
  if (!jmdictReadingsCache.promise) {
    jmdictReadingsCache.promise = (async () => {
      const content = await Deno.readTextFile(resourcePaths.jmdictReadings);
      return JSON.parse(content) as JMDictReadings;
    })();
  }
  return (await jmdictReadingsCache.promise)[spelling] ?? [];
}

/**
 * Lazily loads and returns all JMDict entries from the full dictionary.
 * Safe to call multiple times concurrently - will deduplicate requests.
 */
export function allJMDictEntries(): Promise<JMDictEntries> {
  if (!entriesCache.promise) {
    entriesCache.promise = (async () => {
      const content = await Deno.readTextFile(resourcePaths.jmdict);
      const jmdict = JSON.parse(content) as JMdict;

      const entries: JMDictEntries = new Map();
      for (const word of jmdict.words) {
        entries.set(word.id, word);
      }
      return entries;
    })();
  }
  return entriesCache.promise;
}

/**
 * Lazily loads and returns a single pre-extracted JMDict entry by ID.
 * Safe to call multiple times concurrently - will deduplicate requests.
 * Throws if the entry doesn't exist in the pre-extracted entries.
 */
export function preextractedJMDictEntry(id: string): Promise<JMDictWord> {
  let promise = preextractedEntryPromises.get(id);
  if (!promise) {
    promise = (async () => {
      const entryPath = `${resourcePaths.preextractedJMDictEntries}/${id}.json`;
      try {
        const content = await Deno.readTextFile(entryPath);
        return JSON.parse(content) as JMDictWord;
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          throw new Error(`JMDict entry ${id} not found in pre-extracted entries`);
        }
        throw e;
      }
    })();
    preextractedEntryPromises.set(id, promise);
  }
  return promise;
}
