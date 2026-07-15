import type { JMDictWord } from "data";

const SMALL_TO_LARGE_KANA: Readonly<Record<string, string>> = {
  ぁ: "あ",
  ぃ: "い",
  ぅ: "う",
  ぇ: "え",
  ぉ: "お",
  ゃ: "や",
  ゅ: "ゆ",
  ょ: "よ",
  っ: "つ",
  ゎ: "わ",
  ゕ: "か",
  ゖ: "け",
  ァ: "ア",
  ィ: "イ",
  ゥ: "ウ",
  ェ: "エ",
  ォ: "オ",
  ャ: "ヤ",
  ュ: "ユ",
  ョ: "ヨ",
  ッ: "ツ",
  ヮ: "ワ",
  ヵ: "カ",
  ヶ: "ケ",
};

interface RubyComponent {
  base: string;
  targetStart: number;
  readingStart: number;
  readingLength: number;
}

interface ContextRubyReading {
  annotation: string;
  reading: string;
  components: RubyComponent[];
}

interface SourceRubyAnnotation {
  formatted: string;
  surface: string;
}

interface PreparedContextRuby {
  context: string;
  annotations: SourceRubyAnnotation[];
  reading: string | null;
}

interface ContextReadingResolution {
  context: string;
  reading: string | null;
  formattedReading: string | null;
}

const rubyTagPattern = /<ruby>((?:(?:<rb>)?[^<]+(?:<\/rb>)?<rt>[^<]+<\/rt>)+)<\/ruby>/g;
const rubyComponentPattern = /(?:<rb>)?([^<]+)(?:<\/rb>)?<rt>([^<]+)<\/rt>/g;

function containsKanji(text: string): boolean {
  return /\p{Script=Han}/v.test(text);
}

function applicableReadings(entry: JMDictWord, recognitionTarget: string): string[] {
  const applicableKanji = entry.kanji
    .map((item) => item.text)
    .filter((spelling) => recognitionTarget.includes(spelling));

  // Search-only readings are intentionally included: their tags do not affect
  // whether the source ruby identifies this JMDict entry and reading.
  const readings = entry.kana
    .filter((item) =>
      entry.kanji.length === 0 ||
      !containsKanji(recognitionTarget) ||
      item.appliesToKanji.includes("*") ||
      item.appliesToKanji.includes(recognitionTarget) ||
      applicableKanji.some((spelling) => item.appliesToKanji.includes(spelling))
    )
    .map((item) => item.text);
  return [...new Set(readings)];
}

function isFullSizeKanaVersion(source: string, canonical: string): boolean {
  const sourceCharacters = [...source];
  const canonicalCharacters = [...canonical];
  if (sourceCharacters.length !== canonicalCharacters.length) return false;

  let changed = false;
  for (let index = 0; index < sourceCharacters.length; ++index) {
    if (sourceCharacters[index] === canonicalCharacters[index]) continue;
    if (SMALL_TO_LARGE_KANA[canonicalCharacters[index]] !== sourceCharacters[index]) return false;
    changed = true;
  }
  return changed;
}

function parseContextRubyReading(
  annotation: string,
  recognitionTarget: string,
): ContextRubyReading | null {
  const componentPattern = /(^| )([^ <>\[\]]+)\[([^\]]+)\]/gu;
  const matches = [...annotation.matchAll(componentPattern)];
  if (matches.length === 0) return null;

  let targetIndex = 0;
  const readingCharacters: string[] = [];
  const components: RubyComponent[] = [];

  for (const match of matches) {
    const base = match[2];
    const reading = match[3];
    const baseIndex = recognitionTarget.indexOf(base, targetIndex);
    if (baseIndex === -1) return null;

    const unannotated = recognitionTarget.slice(targetIndex, baseIndex);
    if (containsKanji(unannotated)) return null;
    readingCharacters.push(...unannotated);

    const componentReading = [...reading];
    components.push({
      base,
      targetStart: baseIndex,
      readingStart: readingCharacters.length,
      readingLength: componentReading.length,
    });
    readingCharacters.push(...componentReading);
    targetIndex = baseIndex + base.length;
  }

  const unannotatedSuffix = recognitionTarget.slice(targetIndex);
  if (containsKanji(unannotatedSuffix)) return null;
  readingCharacters.push(...unannotatedSuffix);

  return {
    annotation,
    reading: readingCharacters.join(""),
    components,
  };
}

function formatRecognitionTargetFromContextRuby(
  contextRuby: ContextRubyReading,
  recognitionTarget: string,
  canonicalReading: string,
): string {
  const canonicalCharacters = [...canonicalReading];
  let targetIndex = 0;
  let result = "";

  for (const component of contextRuby.components) {
    result += recognitionTarget.slice(targetIndex, component.targetStart);
    if (result !== "" && !result.endsWith(" ")) result += " ";
    const reading = canonicalCharacters
      .slice(component.readingStart, component.readingStart + component.readingLength)
      .join("");
    result += `${component.base}[${reading}]`;
    targetIndex = component.targetStart + component.base.length;
  }

  return result + recognitionTarget.slice(targetIndex);
}

function findJMDictReading(
  sourceReading: string,
  recognitionTarget: string,
  entry: JMDictWord,
): string | null {
  const readings = applicableReadings(entry, recognitionTarget);
  if (readings.includes(sourceReading)) return sourceReading;

  const normalizedMatches = readings.filter((reading) =>
    isFullSizeKanaVersion(sourceReading, reading)
  );
  if (normalizedMatches.length === 1) return normalizedMatches[0];

  return null;
}

function resolveJMDictReading(
  sourceReading: string,
  recognitionTarget: string,
  entry: JMDictWord,
): string {
  const reading = findJMDictReading(sourceReading, recognitionTarget, entry);
  if (reading !== null) return reading;

  const readings = applicableReadings(entry, recognitionTarget);
  const available = readings.length === 0 ? "(none)" : readings.join(", ");
  throw new Error(
    `Context ruby reading ${JSON.stringify(sourceReading)} does not match a JMDict reading ` +
      `applicable to ${JSON.stringify(recognitionTarget)} in entry ${entry.id}: ${available}`,
  );
}

function countOccurrences(text: string, searchValue: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(searchValue, index)) !== -1) {
    ++count;
    index += searchValue.length;
  }
  return count;
}

/** Converts source ruby and recovers a reading only when its occurrence is unambiguous. */
export function prepareContextRuby(
  context: string,
  recognitionTarget: string,
  entry: JMDictWord,
): PreparedContextRuby {
  const annotations: SourceRubyAnnotation[] = [];
  let plainContext = "";
  let sourceIndex = 0;
  const convertedContext = context.replace(
    rubyTagPattern,
    (whole, inner: string, offset: number) => {
      const components = [...inner.matchAll(rubyComponentPattern)];
      const surface = components.map(([, base]) => base).join("");
      const formatted = components.map(([, base, reading]) => `${base}[${reading}]`).join(" ");

      plainContext += context.slice(sourceIndex, offset) + surface;
      sourceIndex = offset + whole.length;
      annotations.push({ formatted, surface });
      return formatted;
    },
  );
  plainContext += context.slice(sourceIndex);

  const candidates: string[] = [];
  for (const { formatted, surface } of annotations) {
    // A matching ruby annotation is not necessarily the card target. Only use
    // it before target identification when that surface occurs once in the
    // source; marked target ruby is validated strictly after field generation.
    if (countOccurrences(plainContext, surface) !== 1) continue;

    const contextRuby = parseContextRubyReading(formatted, recognitionTarget);
    if (contextRuby === null) continue;
    const reading = findJMDictReading(contextRuby.reading, recognitionTarget, entry);
    // A mismatching annotation may belong to another word. If it is later
    // marked as the target, `resolveContextReading()` reports the mismatch.
    if (reading !== null) candidates.push(reading);
  }

  return {
    context: convertedContext,
    annotations,
    reading: candidates.length === 1 ? candidates[0] : null,
  };
}

function rewriteContextRuby(
  contextRuby: ContextRubyReading,
  canonicalReading: string,
): string {
  if (contextRuby.reading === canonicalReading) return contextRuby.annotation;

  const canonicalCharacters = [...canonicalReading];
  let componentIndex = 0;
  return contextRuby.annotation.replace(
    /(^| )([^ <>\[\]]+)\[([^\]]+)\]/gu,
    (_whole, separator: string, base: string) => {
      const component = contextRuby.components[componentIndex++];
      const reading = canonicalCharacters
        .slice(component.readingStart, component.readingStart + component.readingLength)
        .join("");
      return `${separator}${base}[${reading}]`;
    },
  );
}

function addUnmarkedRubySeparators(
  context: string,
  annotations: Iterable<SourceRubyAnnotation>,
): string {
  let separated = context;
  const longestFirst = [...new Set([...annotations].map(({ formatted }) => formatted))]
    .sort((left, right) => right.length - left.length);
  for (const annotation of longestFirst) {
    separated = separated.replaceAll(
      annotation,
      (match, offset: number, wholeContext: string) => {
        const previous = wholeContext[offset - 1];
        return offset === 0 || previous === " " || previous === ">" ? match : ` ${match}`;
      },
    );
  }
  return separated;
}

/** Validates marked target ruby, repairs its kana, and finishes Anki-style spacing. */
export function resolveContextReading(
  context: string,
  preparedContextRuby: PreparedContextRuby,
  recognitionTarget: string,
  entry: JMDictWord,
): ContextReadingResolution {
  const resolvedReadings = new Set<string>();
  let formattedReading: string | null = null;
  const resolvedContext = context.replace(
    /<mark>(.*?)<\/mark>/gs,
    (whole, annotation: string) => {
      if (!annotation.includes("[")) return whole;

      const contextRuby = parseContextRubyReading(annotation, recognitionTarget);
      if (contextRuby === null) {
        throw new Error(
          `Could not derive a complete reading for ${JSON.stringify(recognitionTarget)} ` +
            `from context ruby ${JSON.stringify(annotation)}`,
        );
      }

      const reading = resolveJMDictReading(contextRuby.reading, recognitionTarget, entry);
      resolvedReadings.add(reading);
      formattedReading ??= formatRecognitionTargetFromContextRuby(
        contextRuby,
        recognitionTarget,
        reading,
      );
      return `<mark>${rewriteContextRuby(contextRuby, reading)}</mark>`;
    },
  );

  if (resolvedReadings.size > 1) {
    throw new Error(
      `Context uses multiple JMDict readings for ${JSON.stringify(recognitionTarget)}: ` +
        [...resolvedReadings].join(", "),
    );
  }

  const reading = resolvedReadings.values().next().value ?? null;
  if (preparedContextRuby.reading !== null && reading !== preparedContextRuby.reading) {
    throw new Error(
      `Source ruby reading ${JSON.stringify(preparedContextRuby.reading)} could not be ` +
        `associated with the marked target ${JSON.stringify(recognitionTarget)}`,
    );
  }

  return {
    context: addUnmarkedRubySeparators(resolvedContext, preparedContextRuby.annotations),
    reading,
    formattedReading,
  };
}
