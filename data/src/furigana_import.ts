interface Segment {
  base: string;
  reading: string;
}

interface SourceRow {
  id: string;
  word: string;
  reading: string;
  segments: Segment[];
}

function containsUnsafeSourceCharacter(text: string): boolean {
  return [...text].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return "<>[]|".includes(character) || codePoint <= 0x1F || codePoint === 0x7F;
  });
}

function parseSourceRow(line: string, lineNumber: number): SourceRow {
  const parts = line.split(";");
  if (parts.length !== 3) {
    throw new Error(`Invalid furigana data on line ${lineNumber}: ${line}`);
  }

  const [id, dottedWord, dottedReading] = parts;
  if (!/^\d+$/u.test(id)) {
    throw new Error(`Invalid JMDict ID on line ${lineNumber}: ${id}`);
  }
  if (
    containsUnsafeSourceCharacter(dottedWord) ||
    containsUnsafeSourceCharacter(dottedReading)
  ) {
    throw new Error(`Unsafe furigana data on line ${lineNumber}: ${line}`);
  }
  const bases = dottedWord.split(".");
  const readings = dottedReading.split(".");
  if (bases.length !== readings.length) {
    throw new Error(
      `Mismatched furigana segments on line ${lineNumber}: ${dottedWord} / ${dottedReading}`,
    );
  }

  const word = bases.join("");
  const reading = readings.join("");
  if (word === "" || reading === "") {
    throw new Error(`Empty word or reading on line ${lineNumber}: ${line}`);
  }

  return {
    id,
    word,
    reading,
    segments: bases.map((base, index) => ({ base, reading: readings[index] })),
  };
}

function toAnkiFormat(segments: readonly Segment[]): string {
  const word = segments.map(({ base }) => base).join("");
  const reading = segments.map((segment) => segment.reading).join("");
  if (segments.some(({ base, reading }) => base === "" || reading === "")) {
    return `${word}[${reading}]`;
  }

  let result = "";
  for (const { base, reading } of segments) {
    if (base === reading) {
      result += base;
    } else {
      result += `${result === "" ? "" : " "}${base}[${reading}]`;
    }
  }
  return result;
}

/**
 * Builds Miwake Cards' exact furigana lookup from Lorenzi's Jisho output.
 */
export function importFurigana(source: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [index, line] of source.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;

    const row = parseSourceRow(line, index + 1);
    const key = `${row.id}|${row.word}|${row.reading}`;
    const formatted = toAnkiFormat(row.segments);
    const existing = data[key];
    if (existing !== undefined && existing !== formatted) {
      throw new Error(`Conflicting furigana rows for ${key}`);
    }
    data[key] = formatted;
  }

  return data;
}
