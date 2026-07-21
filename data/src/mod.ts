// Async access to Miwake Cards' checked-in and locally generated language resources.

import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { entriesCache } from "./entries_cache.ts";
import { furiganaCache } from "./furigana_cache.ts";
import type { JMDictWord } from "./jmdict_types.ts";
import { resourcePaths } from "./resource_paths.ts";

export type { JMDictWord } from "./jmdict_types.ts";

/** JMDict tag expansions. Key: tag abbreviation, value: full description. */
export type JMDictTags = Record<string, string>;

/** Furigana placement data. Key format: "jmdictId|word|reading", value: Anki furigana format. */
export type JMDictFurigana = Record<string, string>;

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

/**
 * Lazily loads and returns JMDict furigana placement data.
 * Safe to call multiple times concurrently - will deduplicate requests.
 */
export function jmdictFurigana(): Promise<JMDictFurigana> {
  if (!furiganaCache.promise) {
    furiganaCache.promise = (async () => {
      const content = await Deno.readTextFile(resourcePaths.jmdictFurigana);
      return JSON.parse(content) as JMDictFurigana;
    })();
  }
  return furiganaCache.promise;
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
