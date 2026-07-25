import { describeNumber, describeNumbers } from "./describe_input.ts";

/**
 * Parsing and formatting of Miwake Card keys.
 *
 * Key format: `spelling | jmdictId` (all senses apply) or `spelling | jmdictId | 2,3`
 * (only the listed 1-indexed senses apply).
 */

export interface MiwakeKey {
  /** The spelling encoded in the key, which may differ from the user-editable recognition target. */
  spelling: string;
  /** The stable JMDict entry identifier. */
  jmdictId: string;
  /** 1-indexed applicable sense numbers, or `null` when all senses apply. */
  senseNumbers: number[] | null;
}

function parsePositiveSafeInteger(text: string): number | null {
  if (!/^[1-9]\d*$/u.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Parses a Miwake Card key, returning `null` when its syntax or sense list is invalid. */
export function parseMiwakeKey(text: string): MiwakeKey | null {
  const parts = text.split("|").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  const [spelling, jmdictId, rawSenseNumbers] = parts;
  if (!spelling || parsePositiveSafeInteger(jmdictId) === null) {
    return null;
  }

  if (rawSenseNumbers === undefined) {
    return { spelling, jmdictId, senseNumbers: null };
  }

  const senseNumbers: number[] = [];
  for (const part of rawSenseNumbers.split(",")) {
    const senseNumber = parsePositiveSafeInteger(part.trim());
    if (senseNumber === null || senseNumbers.includes(senseNumber)) return null;
    senseNumbers.push(senseNumber);
  }

  return { spelling, jmdictId, senseNumbers };
}

/**
 * Formats a key from its components. An empty `senseNumbers` array, or one that covers every
 * sense, produces the short all-senses form.
 */
export function formatMiwakeKey(
  spelling: string,
  jmdictId: string,
  senseNumbers: readonly number[],
  totalSenses: number,
): string {
  if (spelling === "" || spelling !== spelling.trim() || spelling.includes("|")) {
    throw new Error(
      `spelling ${JSON.stringify(spelling)} must be nonempty, trimmed, and contain no | character`,
    );
  }
  if (parsePositiveSafeInteger(jmdictId) === null) {
    throw new Error(
      `jmdictId ${JSON.stringify(jmdictId)} must be a positive safe integer written with ASCII ` +
        `digits`,
    );
  }
  if (!Number.isSafeInteger(totalSenses) || totalSenses <= 0) {
    throw new Error(`totalSenses ${describeNumber(totalSenses)} must be a positive safe integer`);
  }
  if (
    senseNumbers.some((senseNumber) =>
      !Number.isSafeInteger(senseNumber) || senseNumber <= 0 || senseNumber > totalSenses
    ) ||
    new Set(senseNumbers).size !== senseNumbers.length
  ) {
    throw new Error(
      `senseNumbers ${
        describeNumbers(senseNumbers)
      } must contain unique positive safe integers no ` +
        `greater than totalSenses ${describeNumber(totalSenses)}`,
    );
  }

  const sorted = [...senseNumbers].sort((a, b) => a - b);
  const allSensesSelected = sorted.length === totalSenses &&
    sorted.every((senseNumber, index) => senseNumber === index + 1);
  if (sorted.length === 0 || allSensesSelected) {
    return `${spelling} | ${jmdictId}`;
  }

  return `${spelling} | ${jmdictId} | ${sorted.join(",")}`;
}
