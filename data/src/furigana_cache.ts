// This module is deliberately absent from the package's exports map so resource updates can
// invalidate the cache without exposing cache management as public API.

import type { FuriganaData } from "./furigana_import.ts";

/** Internal shared state for the memoized full furigana lookup. */
export const furiganaCache: { promise: Promise<FuriganaData> | null } = { promise: null };
