import type { JMDictWord } from "data";
import { toHiragana } from "japanese_text";

// Source ebooks occasionally use a large kana where JMDict has the corresponding small kana.
// Keep this correction local to ruby validation: large kana can be legitimate in other contexts,
// and we only accept the substitution from source large kana to canonical JMDict small kana.
const LARGE_HIRAGANA_BY_SMALL_HIRAGANA: Readonly<Record<string, string>> = {
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
};

interface RubyComponent {
  base: string;
  reading: string;
  targetStart: number;
  readingStart: number;
  readingLength: number;
}

interface ContextRubyReading {
  annotation: string;
  reading: string | null;
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

const SMALL_HIRAGANA_BY_LARGE_HIRAGANA = new Map(
  Object.entries(LARGE_HIRAGANA_BY_SMALL_HIRAGANA).map(([small, large]) => [large, small]),
);

function sourceReadingPattern(text: string): string {
  return [...toHiragana(text)].map((character) => {
    const small = SMALL_HIRAGANA_BY_LARGE_HIRAGANA.get(character);
    return small === undefined
      ? RegExp.escape(character)
      : `(?:${RegExp.escape(character)}|${RegExp.escape(small)})`;
  }).join("");
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
    if (
      LARGE_HIRAGANA_BY_SMALL_HIRAGANA[canonicalCharacters[index]] !== sourceCharacters[index]
    ) {
      return false;
    }
    changed = true;
  }
  return changed;
}

function parseContextRubyReading(
  annotation: string,
  recognitionTarget: string,
): ContextRubyReading | null {
  // Ebook markup may represent a compound either as one `<ruby>` containing
  // several `<rt>` elements or as adjacent `<ruby>` elements. The latter
  // becomes `微[み]塵[じん]` before Anki spacing is normalized, so component
  // parsing must not require an already-inserted separator.
  const componentPattern = /([^ <>\[\]]+)\[([^\]]+)\]/gu;
  const matches = [...annotation.matchAll(componentPattern)];
  if (matches.length === 0) return null;

  let targetIndex = 0;
  const readingCharacters: string[] = [];
  const components: RubyComponent[] = [];
  let complete = true;

  for (const match of matches) {
    const base = match[1];
    const reading = match[2];
    const baseIndex = recognitionTarget.indexOf(base, targetIndex);
    if (baseIndex === -1) return null;

    const unannotated = recognitionTarget.slice(targetIndex, baseIndex);
    if (containsKanji(unannotated)) complete = false;
    readingCharacters.push(...unannotated);

    const componentReading = [...reading];
    components.push({
      base,
      reading,
      targetStart: baseIndex,
      readingStart: readingCharacters.length,
      readingLength: componentReading.length,
    });
    readingCharacters.push(...componentReading);
    targetIndex = baseIndex + base.length;
  }

  const unannotatedSuffix = recognitionTarget.slice(targetIndex);
  if (containsKanji(unannotatedSuffix)) complete = false;
  readingCharacters.push(...unannotatedSuffix);

  return {
    annotation,
    reading: complete ? readingCharacters.join("") : null,
    components,
  };
}

/**
 * Builds the regex fragment for a recognition-target portion that has no source ruby.
 *
 * Kana must occur literally in the JMDict reading, while each unannotated kanji stands for one
 * or more unknown kana. For example, the unannotated `き火` in `焚[た]き火` becomes `き[ぁ-ゖー]+`.
 * The completed pattern is accepted only when it matches exactly one applicable JMDict reading.
 */
function unannotatedTargetReadingPattern(text: string): string {
  return [...toHiragana(text)].map((character) =>
    containsKanji(character) ? "[ぁ-ゖー]+" : RegExp.escape(character)
  ).join("");
}

function partialRubyReadingPattern(
  contextRuby: ContextRubyReading,
  recognitionTarget: string,
  captureComponents = false,
): RegExp {
  let targetIndex = 0;
  let pattern = "";
  for (const component of contextRuby.components) {
    pattern += unannotatedTargetReadingPattern(
      recognitionTarget.slice(targetIndex, component.targetStart),
    );
    const readingPattern = sourceReadingPattern(component.reading);
    pattern += captureComponents ? `(${readingPattern})` : readingPattern;
    targetIndex = component.targetStart + component.base.length;
  }
  pattern += unannotatedTargetReadingPattern(recognitionTarget.slice(targetIndex));
  return new RegExp(`^${pattern}$`, captureComponents ? "du" : "u");
}

function canonicalComponentReadings(
  contextRuby: ContextRubyReading,
  recognitionTarget: string,
  canonicalReading: string,
): string[] {
  const match = partialRubyReadingPattern(contextRuby, recognitionTarget, true).exec(
    toHiragana(canonicalReading),
  );
  if (match?.indices === undefined) {
    throw new Error(
      `Canonical reading ${JSON.stringify(canonicalReading)} no longer matches context ruby ` +
        JSON.stringify(contextRuby.annotation),
    );
  }

  return contextRuby.components.map((_component, index) => {
    const indices = match.indices![index + 1];
    if (indices === undefined) throw new Error("Missing context-ruby capture group.");
    const [start, end] = indices;
    return canonicalReading.slice(start, end);
  });
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

  // Ruby is a pronunciation annotation, not necessarily an attestation of the word's canonical
  // kana spelling. Publishers normally use hiragana ruby even when JMDict intentionally uses
  // katakana for a loanword. Return the original JMDict form after comparing pronunciations.
  const kanaNormalizedMatches = readings.filter((reading) =>
    toHiragana(reading) === toHiragana(sourceReading)
  );
  if (kanaNormalizedMatches.length === 1) return kanaNormalizedMatches[0];

  const normalizedMatches = readings.filter((reading) =>
    isFullSizeKanaVersion(
      toHiragana(sourceReading),
      toHiragana(reading),
    )
  );
  if (normalizedMatches.length === 1) return normalizedMatches[0];

  return null;
}

function findJMDictReadingForContextRuby(
  contextRuby: ContextRubyReading,
  recognitionTarget: string,
  entry: JMDictWord,
): string | null {
  if (contextRuby.reading !== null) {
    return findJMDictReading(contextRuby.reading, recognitionTarget, entry);
  }

  const pattern = partialRubyReadingPattern(contextRuby, recognitionTarget);
  const matches = applicableReadings(entry, recognitionTarget).filter((reading) =>
    pattern.test(toHiragana(reading))
  );
  return matches.length === 1 ? matches[0] : null;
}

function resolveJMDictReadingForContextRuby(
  contextRuby: ContextRubyReading,
  recognitionTarget: string,
  entry: JMDictWord,
): string {
  const reading = findJMDictReadingForContextRuby(contextRuby, recognitionTarget, entry);
  if (reading !== null) return reading;

  const readings = applicableReadings(entry, recognitionTarget);
  const available = readings.length === 0 ? "(none)" : readings.join(", ");
  throw new Error(
    `Context ruby ${JSON.stringify(contextRuby.annotation)} does not match a JMDict reading ` +
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

function parseMarkedContextRubyReading(
  annotation: string,
  recognitionTarget: string,
  sourceAnnotations: Iterable<SourceRubyAnnotation>,
): ContextRubyReading | null {
  const matchingAnnotations = [
    ...new Set(
      [...sourceAnnotations]
        .map(({ formatted }) => formatted)
        .filter((formatted) => annotation.includes(formatted)),
    ),
  ];
  if (matchingAnnotations.length > 0) {
    const parsed = parseContextRubyReading(
      matchingAnnotations.join(" "),
      recognitionTarget,
    );
    if (parsed !== null) return { ...parsed, annotation };
  }
  return parseContextRubyReading(annotation, recognitionTarget);
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

  const candidates = new Set<string>();
  const annotatedTargetPattern = new RegExp(
    [...recognitionTarget]
      .map((character) => `${RegExp.escape(character)}(?:\\[[^\\]]+\\])?`)
      .join("\\s*"),
    "gu",
  );
  const annotatedTargetMatches = [...convertedContext.matchAll(annotatedTargetPattern)];
  if (annotatedTargetMatches.length === 1) {
    const contextRuby = parseContextRubyReading(
      annotatedTargetMatches[0][0],
      recognitionTarget,
    );
    if (contextRuby !== null) {
      const reading = findJMDictReadingForContextRuby(contextRuby, recognitionTarget, entry);
      if (reading !== null) candidates.add(reading);
    }
  }

  for (const { formatted, surface } of annotations) {
    // A matching ruby annotation is not necessarily the card target. Only use
    // it before target identification when that surface occurs once in the
    // source; marked target ruby is validated strictly after field generation.
    if (countOccurrences(plainContext, surface) !== 1) continue;

    const contextRuby = parseContextRubyReading(formatted, recognitionTarget);
    if (contextRuby === null) continue;
    const reading = findJMDictReadingForContextRuby(contextRuby, recognitionTarget, entry);
    // A mismatching annotation may belong to another word. If it is later
    // marked as the target, `resolveContextReading()` reports the mismatch.
    if (reading !== null) candidates.add(reading);
  }

  return {
    context: convertedContext,
    annotations,
    reading: candidates.size === 1 ? candidates.values().next().value! : null,
  };
}

function rewriteContextRuby(
  contextRuby: ContextRubyReading,
  recognitionTarget: string,
  canonicalReading: string,
): string {
  if (
    contextRuby.reading !== null &&
    toHiragana(contextRuby.reading) === toHiragana(canonicalReading)
  ) {
    return contextRuby.annotation;
  }

  const componentReadings = canonicalComponentReadings(
    contextRuby,
    recognitionTarget,
    canonicalReading,
  );
  let componentIndex = 0;
  return contextRuby.annotation.replace(
    /([^ <>\[\]]+)\[([^\]]+)\]/gu,
    (_whole, base: string, sourceReading: string) => {
      const canonicalComponentReading = componentReadings[componentIndex++];
      const reading = toHiragana(sourceReading) === toHiragana(canonicalComponentReading)
        ? sourceReading
        : canonicalComponentReading;
      return `${base}[${reading}]`;
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

      const contextRuby = parseMarkedContextRubyReading(
        annotation,
        recognitionTarget,
        preparedContextRuby.annotations,
      );
      if (contextRuby === null) {
        throw new Error(
          `Could not derive a complete reading for ${JSON.stringify(recognitionTarget)} ` +
            `from context ruby ${JSON.stringify(annotation)}`,
        );
      }

      const reading = resolveJMDictReadingForContextRuby(
        contextRuby,
        recognitionTarget,
        entry,
      );
      resolvedReadings.add(reading);
      if (contextRuby.reading !== null) {
        formattedReading ??= formatRecognitionTargetFromContextRuby(
          contextRuby,
          recognitionTarget,
          reading,
        );
      }
      return `<mark>${rewriteContextRuby(contextRuby, recognitionTarget, reading)}</mark>`;
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
