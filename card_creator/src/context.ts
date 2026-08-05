import {
  type DocumentFragment,
  DOMParser,
  type Element,
  type HTMLTemplateElement,
  Node,
  type Text,
} from "@b-fuze/deno-dom";
import { jmdictReadingsForSpelling } from "data";
import { containsKanji, smallKanaForFullSizeKana, toHiragana } from "japanese_text";

type ContextParent = DocumentFragment | Element;

interface RubyComponent {
  base: string;
  reading: string;
  readingElement: Element;
}

interface RubyAnalysis {
  components: RubyComponent[];
  trailingBase: string;
}

interface PositionedRubyComponent {
  component: RubyComponent;
  sourceIndex: number;
}

interface MarkedRubyAnalysis {
  components: PositionedRubyComponent[];
  visibleText: string;
}

type RubyReadingResolver = (spelling: string) => Promise<readonly string[]>;

interface ProcessContextHTMLOptions {
  /** Resolves readings for incidental, unmarked source ruby. */
  resolveRubyReadings?: RubyReadingResolver;

  /** Precisely placed Anki furigana keyed by accepted JMDict reading. */
  formattedTargetReadings?: ReadonlyMap<string, string>;
}

const HTML_DOCUMENT = new DOMParser().parseFromString("<body></body>", "text/html");
const RUBY_STRUCTURE_SELECTOR = "ruby, rb, rt, rp";
const INVISIBLE_TEXT_ELEMENTS = new Set(["rt", "rp", "script", "style"]);
const YOON_PRECEDERS = new Set([..."きぎしじちぢにひびぴみり"]);
const SOKUON_FOLLOWER_TEXT = "かきくけこがぎぐげござしすせそざじずぜぞたちつてとだぢづでど" +
  "はひふへほばびぶべぼぱぴぷぺぽ";
const SOKUON_FOLLOWERS = new Set([...SOKUON_FOLLOWER_TEXT]);

function parseHTMLFragment(html: string): HTMLTemplateElement {
  const template = HTML_DOCUMENT.createElement("template") as HTMLTemplateElement;
  template.innerHTML = html;
  return template;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

function queryElements(parent: ContextParent, selectors: string): Element[] {
  return [...parent.querySelectorAll(selectors)].filter(isElement);
}

function normalizeTextNodes(parent: ContextParent): void {
  for (const child of parent.childNodes) {
    if (isText(child)) {
      child.data = child.data.replace(/[\u00a0\u202f]/gu, " ");
    } else if (isElement(child)) {
      normalizeTextNodes(child);
    }
  }
}

function visibleText(parent: ContextParent): string {
  const clone = parent.cloneNode(true) as ContextParent;
  for (const element of queryElements(clone, "rt, rp, script, style")) {
    element.remove();
  }
  return clone.textContent;
}

function analyzeRuby(ruby: Element): RubyAnalysis {
  const components: RubyComponent[] = [];
  let pendingBase = "";

  for (const child of ruby.childNodes) {
    if (isElement(child) && child.localName === "rp") continue;

    if (isElement(child) && child.localName === "rt") {
      if (child.querySelector(RUBY_STRUCTURE_SELECTOR) !== null) {
        throw new Error("Supplied HTML contains unsupported nested ruby markup");
      }
      const base = pendingBase.trim();
      const reading = child.textContent.trim();
      if (base === "" || reading === "") {
        throw new Error("Supplied HTML contains ruby with an empty base or reading");
      }
      components.push({ base, reading, readingElement: child });
      pendingBase = "";
      continue;
    }

    if (isElement(child) && child.querySelector(RUBY_STRUCTURE_SELECTOR) !== null) {
      throw new Error("Supplied HTML contains unsupported nested ruby markup");
    }
    if (isText(child) || isElement(child)) {
      pendingBase += child.textContent;
    }
  }

  // A `<ruby>` without any `<rt>` carries no annotation, so unwrapping it is lossless. With real
  // annotations, any remaining base is likewise ordinary, unannotated text after the last
  // component.
  return {
    components,
    trailingBase: pendingBase.trim(),
  };
}

function unannotatedReadingPattern(text: string): string {
  // Kana must appear literally in the selected reading. Each unannotated kanji represents an
  // unknown nonempty kana sequence, allowing partial source ruby such as `焚[た]き火`.
  return [...toHiragana(text)].map((character) =>
    containsKanji(character) ? "[ぁ-ゖー]+" : RegExp.escape(character)
  ).join("");
}

function sourceReadingPattern(text: string): string {
  return [...toHiragana(text)].map((character) => {
    const small = smallKanaForFullSizeKana(character);
    return small === undefined
      ? RegExp.escape(character)
      : `(?:${RegExp.escape(character)}|${RegExp.escape(small)})`;
  }).join("");
}

function analyzeMarkedRuby(
  mark: Element,
  rubyAnalyses: ReadonlyMap<Element, RubyAnalysis>,
): MarkedRubyAnalysis {
  const components: PositionedRubyComponent[] = [];
  let visibleText = "";

  function visit(parent: ContextParent): void {
    for (const child of parent.childNodes) {
      if (isText(child)) {
        visibleText += child.data;
        continue;
      }
      if (!isElement(child)) continue;

      if (child.localName === "ruby") {
        const analysis = rubyAnalyses.get(child)!;
        for (const component of analysis.components) {
          components.push({ component, sourceIndex: visibleText.length });
          visibleText += component.base;
        }
        visibleText += analysis.trailingBase;
      } else if (!INVISIBLE_TEXT_ELEMENTS.has(child.localName)) {
        visit(child);
      }
    }
  }

  visit(mark);
  return { components, visibleText };
}

function componentTargetIndexes(
  components: readonly PositionedRubyComponent[],
  markedText: string,
  jmdictSpelling: string,
): number[] {
  const exactTargetStarts: number[] = [];
  for (
    let start = markedText.indexOf(jmdictSpelling);
    start !== -1;
    start = markedText.indexOf(jmdictSpelling, start + 1)
  ) {
    if (
      components.every(({ component, sourceIndex }) => {
        const targetIndex = sourceIndex - start;
        return targetIndex >= 0 &&
          jmdictSpelling.startsWith(component.base, targetIndex);
      })
    ) {
      exactTargetStarts.push(start);
    }
  }
  if (exactTargetStarts.length === 1) {
    return components.map(({ sourceIndex }) => sourceIndex - exactTargetStarts[0]);
  }

  const targetIndexes: number[] = [];
  let targetIndex = 0;
  for (const { component } of components) {
    const baseIndex = jmdictSpelling.indexOf(component.base, targetIndex);
    if (baseIndex === -1) {
      throw new Error(
        `Supplied HTML ruby base ${JSON.stringify(component.base)} does not occur in ` +
          `the JMDict spelling ${JSON.stringify(jmdictSpelling)}`,
      );
    }
    if (jmdictSpelling.indexOf(component.base, baseIndex + component.base.length) !== -1) {
      throw new Error(
        `Supplied HTML ruby base ${JSON.stringify(component.base)} has an ambiguous position in ` +
          `the JMDict spelling ${JSON.stringify(jmdictSpelling)}`,
      );
    }
    targetIndexes.push(baseIndex);
    targetIndex = baseIndex + component.base.length;
  }
  return targetIndexes;
}

function canonicalComponentReadings(
  components: readonly PositionedRubyComponent[],
  markedText: string,
  jmdictSpelling: string,
  jmdictReading: string,
): string[] {
  const targetIndexes = componentTargetIndexes(
    components,
    markedText,
    jmdictSpelling,
  );
  let targetIndex = 0;
  let pattern = "";

  for (let index = 0; index < components.length; ++index) {
    const component = components[index].component;
    const baseIndex = targetIndexes[index];
    pattern += unannotatedReadingPattern(jmdictSpelling.slice(targetIndex, baseIndex));
    pattern += `(${sourceReadingPattern(component.reading)})`;
    targetIndex = baseIndex + component.base.length;
  }
  pattern += unannotatedReadingPattern(jmdictSpelling.slice(targetIndex));

  const match = new RegExp(`^${pattern}$`, "du").exec(toHiragana(jmdictReading));
  if (match?.indices === undefined) {
    throw new Error(
      `Supplied HTML ruby does not agree with kanaReading ${
        JSON.stringify(jmdictReading)
      } for recognitionTarget ${JSON.stringify(jmdictSpelling)}`,
    );
  }

  return components.map((_component, index) => {
    const indices = match.indices![index + 1];
    if (indices === undefined) throw new Error("Missing source-ruby capture group");
    return jmdictReading.slice(indices[0], indices[1]);
  });
}

function inspectMarkup(fragment: DocumentFragment): {
  marks: Element[];
  rubies: Element[];
} {
  for (const element of queryElements(fragment, "rb, rt, rp")) {
    if (element.closest("ruby") === null) {
      throw new Error(`Supplied HTML contains <${element.localName}> outside <ruby>`);
    }
  }

  const marks = queryElements(fragment, "mark");
  for (const mark of marks) {
    if (mark.querySelector("mark") !== null) {
      throw new Error("Supplied HTML must not contain nested <mark> elements");
    }
    if (mark.closest("ruby, rt, rp") !== null) {
      throw new Error("Supplied HTML must not contain <mark> inside ruby markup");
    }
    if (mark.attributes.length > 0) {
      throw new Error("Supplied HTML <mark> elements must not have attributes");
    }
  }

  const rubies = queryElements(fragment, "ruby");
  if (rubies.some((ruby) => ruby.querySelector("ruby") !== null)) {
    throw new Error("Supplied HTML must not contain nested <ruby> elements");
  }

  return { marks, rubies };
}

function precedingTextNeedsSeparator(ruby: Element): boolean {
  for (let sibling = ruby.previousSibling; sibling !== null; sibling = sibling.previousSibling) {
    if (!isText(sibling)) return false;
    if (sibling.data === "") continue;
    return !/\s$/u.test(sibling.data);
  }
  return false;
}

function isPotentialFullSizeKanaArtifactAt(
  characters: readonly string[],
  index: number,
): boolean {
  const character = toHiragana(characters[index]);
  const previous = index === 0 ? undefined : toHiragana(characters[index - 1]);
  const next = index + 1 === characters.length ? undefined : toHiragana(characters[index + 1]);

  return (
    (["や", "ゆ", "よ"].includes(character) &&
      previous !== undefined &&
      YOON_PRECEDERS.has(previous)) ||
    (character === "つ" &&
      previous !== undefined &&
      next !== undefined &&
      SOKUON_FOLLOWERS.has(next))
  );
}

function hasPotentialFullSizeKanaArtifact(reading: string): boolean {
  const characters = [...reading];
  return characters.some((_character, index) =>
    isPotentialFullSizeKanaArtifactAt(characters, index)
  );
}

function tryCorrectFullSizeKana(source: string, canonical: string): string | undefined {
  const sourceCharacters = [...source];
  const canonicalCharacters = [...canonical];
  if (sourceCharacters.length !== canonicalCharacters.length) {
    return undefined;
  }

  const corrected: string[] = [];
  for (let index = 0; index < sourceCharacters.length; ++index) {
    const sourceCharacter = sourceCharacters[index];
    const canonicalCharacter = canonicalCharacters[index];
    if (toHiragana(sourceCharacter) === toHiragana(canonicalCharacter)) {
      corrected.push(sourceCharacter);
      continue;
    }

    const smallKana = smallKanaForFullSizeKana(sourceCharacter);
    if (smallKana === undefined || toHiragana(smallKana) !== toHiragana(canonicalCharacter)) {
      return undefined;
    }
    corrected.push(smallKana);
  }
  return corrected.join("");
}

function correctFullSizeKana(source: string, canonical: string): string {
  const corrected = tryCorrectFullSizeKana(source, canonical);
  if (corrected === undefined) {
    throw new Error(
      `Internal error: source ruby ${JSON.stringify(source)} differs from validated canonical ` +
        `ruby ${JSON.stringify(canonical)}`,
    );
  }
  return corrected;
}

/** Transfers a whole-target source ruby's typography onto the precise JMDict placement. */
function preciselyPlacedSourceRuby(
  formattedTargetReading: string,
  jmdictSpelling: string,
  jmdictReading: string,
  sourceReading: string,
): string {
  const sourceCharacters = [...correctFullSizeKana(sourceReading, jmdictReading)];
  let sourceOffset = 0;
  let surface = "";
  const result = formattedTargetReading.replace(
    / ?([^ \[\]]+)\[([^\]]+)\]|([^ \[\]]+)/gu,
    (match, annotatedSurface: string | undefined, annotation: string | undefined, literal) => {
      const partSurface = annotatedSurface ?? literal;
      const canonicalPartReading = annotation ?? literal;
      const length = [...canonicalPartReading].length;
      const sourcePart = sourceCharacters.slice(sourceOffset, sourceOffset + length).join("");
      sourceOffset += length;
      surface += partSurface;
      return annotation === undefined
        ? partSurface
        : `${match.startsWith(" ") ? " " : ""}${partSurface}[${sourcePart}]`;
    },
  );
  if (surface !== jmdictSpelling || sourceOffset !== sourceCharacters.length) {
    throw new Error(
      `Internal error: formatted target reading ${
        JSON.stringify(formattedTargetReading)
      } cannot transfer source ruby ${JSON.stringify(sourceReading)} for JMDict spelling ${
        JSON.stringify(jmdictSpelling)
      }`,
    );
  }
  return result;
}

function normalizeForeignRubyReading(base: string, reading: string): string {
  const characters = [...reading];
  const isKatakanaReading = characters.every((character) =>
    /\p{Script=Katakana}/u.test(character) || ["ー", "・", "＝", "="].includes(character)
  );
  const baseCharacters = [...base];
  const isShortHanSpelling = baseCharacters.length <= 3 &&
    baseCharacters.every(containsKanji);
  if (!isKatakanaReading || isShortHanSpelling) return reading;

  return characters.map((character, index) => {
    if (!isPotentialFullSizeKanaArtifactAt(characters, index)) return character;
    return smallKanaForFullSizeKana(character) ?? character;
  }).join("");
}

async function canonicalUnmarkedRubyReading(
  component: RubyComponent,
  resolveRubyReadings: RubyReadingResolver,
): Promise<string> {
  if (!hasPotentialFullSizeKanaArtifact(component.reading)) {
    return component.reading;
  }

  const dictionaryReadings = await resolveRubyReadings(component.base);
  const exact = dictionaryReadings.find((reading) =>
    toHiragana(reading) === toHiragana(component.reading)
  );
  if (exact !== undefined) return component.reading;

  const corrections = new Set(
    dictionaryReadings
      .map((reading) => tryCorrectFullSizeKana(component.reading, reading))
      .filter((reading): reading is string => reading !== undefined),
  );
  if (corrections.size === 1) return [...corrections][0];

  // Gikun annotations and explanatory ruby often have no dictionary reading for their visible
  // base. For clearly non-lexical or long bases, apply only the standard yōon and sokuon patterns.
  // Short all-Han spellings are left alone so an unknown proper name such as `松田[マツダ]` is not
  // silently changed.
  return normalizeForeignRubyReading(component.base, component.reading);
}

async function canonicalUnmarkedCompoundReadings(
  analysis: RubyAnalysis,
  resolveRubyReadings: RubyReadingResolver,
): Promise<ReadonlyMap<Element, string>> {
  if (
    analysis.components.length < 2 ||
    analysis.trailingBase !== "" ||
    !hasPotentialFullSizeKanaArtifact(
      analysis.components.map(({ reading }) => reading).join(""),
    )
  ) {
    return new Map();
  }

  const spelling = analysis.components.map(({ base }) => base).join("");
  const sourceReading = analysis.components.map(({ reading }) => reading).join("");
  const dictionaryReadings = await resolveRubyReadings(spelling);
  if (
    dictionaryReadings.some((reading) => toHiragana(reading) === toHiragana(sourceReading))
  ) {
    return new Map();
  }

  const corrections = new Set(
    dictionaryReadings
      .map((reading) => tryCorrectFullSizeKana(sourceReading, reading))
      .filter((reading): reading is string => reading !== undefined),
  );
  if (corrections.size !== 1) return new Map();

  // EPUBs often split one compound annotation into an `<rt>` per kanji. JMdict generally records
  // the compound, not each kanji as a standalone spelling, so validate the joined reading first
  // and then restore the original component boundaries.
  const correctedCharacters = [...corrections.values().next().value!];
  const result = new Map<Element, string>();
  let offset = 0;
  for (const component of analysis.components) {
    const length = [...component.reading].length;
    const corrected = correctedCharacters.slice(offset, offset + length).join("");
    if (corrected !== component.reading) {
      result.set(component.readingElement, corrected);
    }
    offset += length;
  }
  return offset === correctedCharacters.length ? result : new Map();
}

function replaceRuby(
  ruby: Element,
  analysis: RubyAnalysis,
  canonicalReadings: ReadonlyMap<Element, string>,
  preciselyFormattedComponents: ReadonlyMap<Element, string>,
): void {
  const formattedComponents = analysis.components.map((component) => {
    const preciselyFormatted = preciselyFormattedComponents.get(component.readingElement);
    if (preciselyFormatted !== undefined) return preciselyFormatted;
    const canonicalReading = canonicalReadings.get(component.readingElement);
    const reading = canonicalReading === undefined
      ? component.reading
      : correctFullSizeKana(component.reading, canonicalReading);
    return `${component.base}[${reading}]`;
  });
  let replacement = formattedComponents.join(" ") + analysis.trailingBase;
  if (formattedComponents.length > 0 && precedingTextNeedsSeparator(ruby)) {
    replacement = ` ${replacement}`;
  }

  if (replacement === "") {
    ruby.remove();
  } else {
    ruby.replaceWith(replacement);
  }
}

/**
 * Validates and converts a caller-selected context fragment to Anki-ready HTML.
 *
 * @param html Final sanitized context HTML. It must contain at least one attribute-free `<mark>`
 * around each intended target occurrence. Source `<ruby>` is allowed.
 * @param jmdictSpelling The exact undecorated JMDict spelling selected for the card. It provides
 * the alignment template for partial ruby inside marked, possibly inflected source text.
 * @param acceptedJMDictReadings The accepted exact JMDict kana readings. Marked source ruby must
 * agree with at least one, allowing equivalent kana scripts and full-size source kana. Unmarked
 * ruby does not influence the accepted set; its own JMDict readings are used when available to
 * reverse full-size-kana typography safely. When a matching precisely formatted target reading
 * is supplied, whole-word marked ruby is redistributed to that JMDict-derived placement while
 * retaining the source's kana script.
 * @returns The supplied fragment with nonbreaking spaces normalized and source ruby converted to
 * Anki bracket notation.
 */
export async function processContextHTML(
  html: string,
  jmdictSpelling: string,
  acceptedJMDictReadings: readonly string[],
  {
    resolveRubyReadings = jmdictReadingsForSpelling,
    formattedTargetReadings,
  }: ProcessContextHTMLOptions = {},
): Promise<string> {
  if (acceptedJMDictReadings.length === 0) {
    throw new Error("At least one accepted JMDict reading is required");
  }
  const template = parseHTMLFragment(html);
  const fragment = template.content;
  normalizeTextNodes(fragment);

  const { marks, rubies } = inspectMarkup(fragment);
  const analyses = new Map(rubies.map((ruby) => [ruby, analyzeRuby(ruby)]));

  if (visibleText(fragment).trim() === "") {
    throw new Error("Supplied HTML must contain substantive text");
  }
  if (marks.length === 0) {
    throw new Error("Supplied HTML must contain at least one <mark> element");
  }
  for (const mark of marks) {
    if (visibleText(mark).trim() === "") {
      throw new Error("Supplied HTML <mark> elements must contain substantive text");
    }
  }

  const canonicalReadings = new Map<Element, string>();
  const formattedComponents = new Map<Element, string>();
  for (const mark of marks) {
    const markedRuby = analyzeMarkedRuby(mark, analyses);
    const { components } = markedRuby;
    if (components.length === 0) continue;
    let readings: string[] | undefined;
    let matchedJMDictReading: string | undefined;
    let firstError: unknown;
    for (const jmdictReading of acceptedJMDictReadings) {
      try {
        readings = canonicalComponentReadings(
          components,
          markedRuby.visibleText,
          jmdictSpelling,
          jmdictReading,
        );
        matchedJMDictReading = jmdictReading;
        break;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (readings === undefined) {
      if (acceptedJMDictReadings.length === 1) throw firstError;
      throw new Error(
        `Supplied HTML ruby does not agree with any accepted kanaReading ${
          JSON.stringify(acceptedJMDictReadings)
        } for recognitionTarget ${JSON.stringify(jmdictSpelling)}`,
        { cause: firstError },
      );
    }
    const formattedTargetReading = matchedJMDictReading === undefined
      ? undefined
      : formattedTargetReadings?.get(matchedJMDictReading);
    for (let index = 0; index < components.length; ++index) {
      const component = components[index].component;
      canonicalReadings.set(component.readingElement, readings[index]);
      if (formattedTargetReading !== undefined && component.base === jmdictSpelling) {
        formattedComponents.set(
          component.readingElement,
          preciselyPlacedSourceRuby(
            formattedTargetReading,
            jmdictSpelling,
            matchedJMDictReading!,
            component.reading,
          ),
        );
      }
    }
  }

  for (const analysis of analyses.values()) {
    if (
      analysis.components.every(({ readingElement }) => !canonicalReadings.has(readingElement))
    ) {
      const compoundReadings = await canonicalUnmarkedCompoundReadings(
        analysis,
        resolveRubyReadings,
      );
      for (const [readingElement, reading] of compoundReadings) {
        canonicalReadings.set(readingElement, reading);
      }
    }
    for (const component of analysis.components) {
      if (canonicalReadings.has(component.readingElement)) continue;
      const canonicalReading = await canonicalUnmarkedRubyReading(
        component,
        resolveRubyReadings,
      );
      if (canonicalReading !== component.reading) {
        canonicalReadings.set(component.readingElement, canonicalReading);
      }
    }
  }

  for (const ruby of rubies) {
    replaceRuby(ruby, analyses.get(ruby)!, canonicalReadings, formattedComponents);
  }
  return template.innerHTML.trim();
}
