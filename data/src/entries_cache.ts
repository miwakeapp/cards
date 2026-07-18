// Internal shared state: the memoized `allJMDictEntries()` load. It lives in its own module —
// deliberately absent from the package's exports map — so `jmdict_download.ts` can reset it
// after replacing `jmdict_eng.json` without that being public API.

import type { JMDictEntries } from "./mod.ts";

/** Memoized full-dictionary load shared with the downloader. */
export const entriesCache: { promise: Promise<JMDictEntries> | null } = { promise: null };
