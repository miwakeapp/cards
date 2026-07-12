/**
 * Parsing and formatting of Miwake card keys.
 *
 * Key format: `spelling | jmdictId` (all senses apply) or `spelling | jmdictId | 2,3`
 * (only the listed 1-indexed senses apply).
 */

export interface MiwakeKey {
  /** The spelling shown on the front of the card. */
  recognitionTarget: string;
  /** The stable JMDict entry identifier. */
  jmdictId: string;
  /** 1-indexed applicable sense numbers, or `null` when all senses apply. */
  senseNumbers: number[] | null;
}

/** Parses a Miwake key, returning `null` when its syntax or sense list is invalid. */
export function parseMiwakeKey(text: string): MiwakeKey | null {
  const parts = text.split("|").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  const [recognitionTarget, jmdictId, rawSenseNumbers] = parts;
  if (!recognitionTarget || !/^\d+$/.test(jmdictId)) {
    return null;
  }

  if (rawSenseNumbers === undefined) {
    return { recognitionTarget, jmdictId, senseNumbers: null };
  }

  const senseNumbers = rawSenseNumbers.split(",").map((part) => Number(part.trim()));
  if (
    senseNumbers.length === 0 ||
    senseNumbers.some((senseNumber) => !Number.isInteger(senseNumber) || senseNumber <= 0) ||
    new Set(senseNumbers).size !== senseNumbers.length
  ) {
    return null;
  }

  return { recognitionTarget, jmdictId, senseNumbers };
}

/**
 * Formats a key from its components. An empty `senseNumbers` array, or one that covers every
 * sense, produces the short all-senses form.
 */
export function formatMiwakeKey(
  recognitionTarget: string,
  jmdictId: string,
  senseNumbers: number[],
  totalSenses: number,
): string {
  if (senseNumbers.length === 0 || senseNumbers.length === totalSenses) {
    return `${recognitionTarget} | ${jmdictId}`;
  }

  const sorted = [...senseNumbers].sort((a, b) => a - b);
  return `${recognitionTarget} | ${jmdictId} | ${sorted.join(",")}`;
}
