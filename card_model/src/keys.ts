function describeNumber(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function describeNumbers(values: readonly number[]): string {
  return `[${values.map(describeNumber).join(", ")}]`;
}

/** One JMDict entry and sense selection represented by a Miwake Card Key. */
export interface KeyUsage {
  /** Stable JMDict entry identifier. */
  jmdictId: string;
  /** 1-indexed applicable sense numbers, or `null` when all senses apply. */
  senseNumbers: number[] | null;
}

/** Parsed semantic identity for a Miwake Card. Entry usages are sorted by JMDict ID. */
export interface Key {
  /** Canonical spelling, which may differ from the user-editable Recognition target. */
  spelling: string;
  /** One or more accepted entry usages, sorted numerically by JMDict ID. */
  usages: [KeyUsage, ...KeyUsage[]];
}

/** Fully resolved usage from which a canonical Key can be formatted. */
export interface KeyUsageInput {
  /** Stable JMDict entry identifier. */
  jmdictId: string;
  /** Selected 1-indexed senses; empty means all senses. */
  senseNumbers: readonly number[];
  /** Current number of senses in this JMDict entry. */
  totalSenses: number;
}

function parsePositiveSafeInteger(text: string): number | null {
  if (!/^[1-9]\d*$/u.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function compareJMDictIds(
  left: { jmdictId: string },
  right: { jmdictId: string },
): number {
  return Number(left.jmdictId) - Number(right.jmdictId);
}

function parseUsage(text: string): KeyUsage | null {
  const parts = text.split(":");
  if (parts.length > 2) return null;
  const [rawJMDictId, rawSenseNumbers] = parts;
  if (parsePositiveSafeInteger(rawJMDictId) === null) return null;
  if (rawSenseNumbers === undefined) {
    return { jmdictId: rawJMDictId, senseNumbers: null };
  }

  const senseNumbers: number[] = [];
  for (const part of rawSenseNumbers.split(",")) {
    const senseNumber = parsePositiveSafeInteger(part);
    if (
      senseNumber === null ||
      (senseNumbers.length > 0 && senseNumber <= senseNumbers.at(-1)!)
    ) return null;
    senseNumbers.push(senseNumber);
  }
  return { jmdictId: rawJMDictId, senseNumbers };
}

/** Parses the canonical `spelling | id[:senses][;id[:senses]...]` Key syntax. */
export function parseKey(text: string): Key | null {
  const parts = text.split(" | ");
  if (parts.length !== 2) return null;
  const [spelling, rawUsages] = parts;
  if (
    spelling === "" || spelling !== spelling.trim() || spelling.includes("|") ||
    rawUsages === ""
  ) return null;

  const usages: KeyUsage[] = [];
  for (const rawUsage of rawUsages.split(";")) {
    const usage = parseUsage(rawUsage);
    if (
      usage === null ||
      (usages.length > 0 && compareJMDictIds(usages.at(-1)!, usage) >= 0)
    ) return null;
    usages.push(usage);
  }
  return {
    spelling,
    usages: usages as [KeyUsage, ...KeyUsage[]],
  };
}

function formatUsage(input: KeyUsageInput, fieldName: string): string {
  if (parsePositiveSafeInteger(input.jmdictId) === null) {
    throw new Error(
      `${fieldName}.jmdictId ${JSON.stringify(input.jmdictId)} must be a positive safe integer ` +
        "written with ASCII digits",
    );
  }
  if (!Number.isSafeInteger(input.totalSenses) || input.totalSenses <= 0) {
    throw new Error(
      `${fieldName}.totalSenses ${
        describeNumber(input.totalSenses)
      } must be a positive safe integer`,
    );
  }
  if (
    input.senseNumbers.some((senseNumber) =>
      !Number.isSafeInteger(senseNumber) || senseNumber <= 0 ||
      senseNumber > input.totalSenses
    ) || new Set(input.senseNumbers).size !== input.senseNumbers.length
  ) {
    throw new Error(
      `${fieldName}.senseNumbers ${
        describeNumbers(input.senseNumbers)
      } must contain unique positive safe integers no greater than ${fieldName}.totalSenses ${
        describeNumber(input.totalSenses)
      }`,
    );
  }

  const sorted = [...input.senseNumbers].sort((left, right) => left - right);
  const allSensesSelected = sorted.length === input.totalSenses &&
    sorted.every((senseNumber, index) => senseNumber === index + 1);
  return sorted.length === 0 || allSensesSelected
    ? input.jmdictId
    : `${input.jmdictId}:${sorted.join(",")}`;
}

/** Formats a canonical Key, sorting every entry usage numerically by JMDict ID. */
export function formatKey(
  spelling: string,
  usages: readonly KeyUsageInput[],
): string {
  if (spelling === "" || spelling !== spelling.trim() || spelling.includes("|")) {
    throw new Error(
      `spelling ${JSON.stringify(spelling)} must be nonempty, trimmed, and contain no | character`,
    );
  }
  if (usages.length === 0) throw new Error("usages must contain at least one JMDict usage");
  if (new Set(usages.map(({ jmdictId }) => jmdictId)).size !== usages.length) {
    throw new Error("usages must not repeat a JMDict entry");
  }

  const ordered = usages.toSorted(compareJMDictIds);
  return `${spelling} | ${
    ordered.map((usage, index) => formatUsage(usage, `usages[${index}]`)).join(";")
  }`;
}
