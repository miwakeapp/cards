// Internal shared state for the memoized `jmdictFurigana()` load. This module is deliberately
// absent from the package's exports map so resource updates can invalidate the cache without
// exposing cache management as public API.

import type { JMDictFurigana } from "./mod.ts";

/** Internal shared state for the memoized full furigana lookup. */
export const furiganaCache: { promise: Promise<JMDictFurigana> | null } = { promise: null };
