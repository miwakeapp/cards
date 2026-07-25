// Internal shared state for the memoized compact JMDict reading index.

import type { JMDictReadings } from "./jmdict_readings.ts";

/** Shared state for the memoized compact JMDict reading index. */
export const jmdictReadingsCache: { promise: Promise<JMDictReadings> | null } = {
  promise: null,
};
