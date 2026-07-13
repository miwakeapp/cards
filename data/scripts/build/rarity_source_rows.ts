const requiredBCCWJColumns = [
  "rank",
  "lForm",
  "lemma",
  "pos",
  "subLemma",
  "wType",
  "frequency",
  "pmw",
];
const expectedBCCWJFieldCount = 80;
const positiveIntegerRegex = /^[1-9]\d*$/;
const positiveNumberRegex = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function parseNWJCRow(line: string, lineNumber: number): {
  surface: string;
  count: number;
} {
  const parts = line.split("\t");
  if (parts.length !== 2 || !parts[0]) {
    throw new Error(`Invalid NWJC row at line ${lineNumber}: expected surface and count`);
  }
  return {
    surface: parts[0],
    count: parsePositiveSafeInteger(parts[1], `NWJC count at line ${lineNumber}`),
  };
}

export function validateBCCWJHeader(line: string): void {
  const columns = line.split("\t");
  if (
    columns.length !== expectedBCCWJFieldCount ||
    !requiredBCCWJColumns.every((column, index) => columns[index] === column)
  ) {
    throw new Error("Invalid BCCWJ header: unsupported LUW2 schema");
  }
}

export function parseBCCWJRow(line: string, lineNumber: number): {
  lemma: string;
  totalPMW: number;
} {
  const parts = line.split("\t");
  if (parts.length !== expectedBCCWJFieldCount || !parts[2]) {
    throw new Error(`Invalid BCCWJ row at line ${lineNumber}: unexpected field count or lemma`);
  }

  parsePositiveSafeInteger(parts[0], `BCCWJ rank at line ${lineNumber}`);
  parsePositiveSafeInteger(parts[6], `BCCWJ frequency at line ${lineNumber}`);
  return {
    lemma: parts[2],
    totalPMW: parsePositiveNumber(parts[7], `BCCWJ pmw at line ${lineNumber}`),
  };
}

function parsePositiveSafeInteger(text: string, label: string): number {
  if (!positiveIntegerRegex.test(text)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(text)}`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} exceeds the safe integer range`);
  }
  return value;
}

function parsePositiveNumber(text: string, label: string): number {
  if (!positiveNumberRegex.test(text)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(text)}`);
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(text)}`);
  }
  return value;
}
