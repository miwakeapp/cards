import {
  defaultTreeAdapter,
  type DefaultTreeAdapterTypes,
  html as parse5HTML,
  parseFragment,
  type ParserError,
  serialize,
} from "parse5";
import type { RenderedTextOccurrence } from "./rendered_text.ts";

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type TextNode = DefaultTreeAdapterTypes.TextNode;

interface TextRange {
  start: number;
  end: number;
}

interface IndexedFragment {
  renderedText: string;
  ranges: Map<ChildNode, TextRange>;
}

type Match = RenderedTextOccurrence;

const HORIZONTAL_WHITESPACE = /[\p{Zs}\t]/v;

const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "ul",
]);

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

function isRuby(node: ChildNode): node is Element {
  return isElement(node) && node.tagName === "ruby";
}

function isReadingAnnotation(node: ChildNode): boolean {
  return isElement(node) && (node.tagName === "rt" || node.tagName === "rp");
}

function indexFragment(fragment: DefaultTreeAdapterTypes.DocumentFragment): IndexedFragment {
  const ranges = new Map<ChildNode, TextRange>();
  let renderedText = "";

  function visit(node: ChildNode): void {
    const start = renderedText.length;
    if (isTextNode(node)) {
      renderedText += node.value;
    } else if (isElement(node) && !isReadingAnnotation(node)) {
      if (node.tagName === "br") {
        renderedText += "\n";
      } else {
        for (const child of node.childNodes) visit(child);
        if (BLOCK_ELEMENTS.has(node.tagName)) renderedText += "\n";
      }
    }
    ranges.set(node, { start, end: renderedText.length });
  }

  for (const child of fragment.childNodes) visit(child);
  return { renderedText, ranges };
}

function matchSurfaceAt(renderedText: string, start: number, surface: string): number | null {
  const characters = [...surface];
  let textIndex = start;

  for (let index = 0; index < characters.length; ++index) {
    const character = characters[index];
    if (!renderedText.startsWith(character, textIndex)) return null;
    textIndex += character.length;

    const nextCharacter = characters[index + 1];
    if (
      nextCharacter !== undefined &&
      !HORIZONTAL_WHITESPACE.test(character) &&
      !HORIZONTAL_WHITESPACE.test(nextCharacter)
    ) {
      while (HORIZONTAL_WHITESPACE.test(renderedText[textIndex] ?? "")) ++textIndex;
    }
  }

  return textIndex;
}

function findMatches(renderedText: string, targetSurfaces: readonly string[]): Match[] {
  const alternatives = [...targetSurfaces].sort((left, right) => right.length - left.length);
  const matches: Match[] = [];

  for (let index = 0; index < renderedText.length;) {
    const matched = alternatives
      .map((surface) => ({ surface, end: matchSurfaceAt(renderedText, index, surface) }))
      .find(({ end }) => end !== null);
    if (matched !== undefined && matched.end !== null) {
      matches.push({ start: index, end: matched.end, surface: matched.surface });
      index = matched.end;
    } else {
      const codePoint = renderedText.codePointAt(index)!;
      index += codePoint > 0xFFFF ? 2 : 1;
    }
  }

  return matches;
}

function splitTextNode(parent: ParentNode, node: TextNode, offset: number): void {
  if (offset <= 0 || offset >= node.value.length) {
    throw new Error("Internal error while splitting a context text node");
  }

  const index = parent.childNodes.indexOf(node);
  if (index === -1) {
    throw new Error("Internal error: context text node has no parent");
  }

  const left = defaultTreeAdapter.createTextNode(node.value.slice(0, offset));
  const right = defaultTreeAdapter.createTextNode(node.value.slice(offset));
  left.parentNode = parent;
  right.parentNode = parent;
  node.parentNode = null;
  parent.childNodes.splice(index, 1, left, right);
}

function partialElementError(match: Match, element: Element): Error {
  return new Error(
    `Target occurrence ${JSON.stringify(match.surface)} partially crosses a <${element.tagName}> ` +
      "element; refusing to rewrite structurally ambiguous HTML",
  );
}

interface RubyComponent extends TextRange {
  nodes: ChildNode[];
}

function rangeForNodes(
  nodes: readonly ChildNode[],
  ranges: ReadonlyMap<ChildNode, TextRange>,
): TextRange | null {
  const visible = nodes.map((node) => ranges.get(node)!).filter((range) =>
    range.start !== range.end
  );
  if (visible.length === 0) return null;
  return { start: visible[0].start, end: visible.at(-1)!.end };
}

function rubyComponents(
  ruby: Element,
  ranges: ReadonlyMap<ChildNode, TextRange>,
): RubyComponent[] {
  const rbIndexes = ruby.childNodes.flatMap((node, index) =>
    isElement(node) && node.tagName === "rb" ? [index] : []
  );

  if (rbIndexes.length > 0) {
    const components: RubyComponent[] = [];
    for (let componentIndex = 0; componentIndex < rbIndexes.length; ++componentIndex) {
      const rbIndex = rbIndexes[componentIndex];
      const endIndex = rbIndexes[componentIndex + 1] ?? ruby.childNodes.length;
      const nodes = ruby.childNodes.slice(componentIndex === 0 ? 0 : rbIndex, endIndex);
      const rbRange = ranges.get(ruby.childNodes[rbIndex])!;
      const groupRange = rangeForNodes(nodes, ranges);
      if (
        groupRange === null || groupRange.start !== rbRange.start || groupRange.end !== rbRange.end
      ) {
        throw new Error(
          "Cannot split <ruby>: text outside its explicit <rb> annotation components",
        );
      }
      components.push({ ...rbRange, nodes });
    }
    return components;
  }

  const components: RubyComponent[] = [];
  let startIndex = 0;
  for (let index = 0; index < ruby.childNodes.length; ++index) {
    const node = ruby.childNodes[index];
    if (!isElement(node) || node.tagName !== "rt") continue;

    let endIndex = index + 1;
    while (endIndex < ruby.childNodes.length) {
      const following = ruby.childNodes[endIndex];
      if (!isElement(following) || following.tagName !== "rp") break;
      ++endIndex;
    }
    const nodes = ruby.childNodes.slice(startIndex, endIndex);
    const range = rangeForNodes(nodes, ranges);
    if (range === null) {
      throw new Error("Cannot split <ruby>: an annotation has no corresponding base text");
    }
    components.push({ ...range, nodes });
    startIndex = endIndex;
    index = endIndex - 1;
  }

  if (startIndex < ruby.childNodes.length) {
    const nodes = ruby.childNodes.slice(startIndex);
    const range = rangeForNodes(nodes, ranges);
    if (range !== null) components.push({ ...range, nodes });
  }
  return components;
}

function cloneRuby(
  source: Element,
  nodes: readonly ChildNode[],
  keepId: boolean,
): Element {
  const attrs = source.attrs
    .filter((attribute) => keepId || attribute.name !== "id")
    .map((attribute) => ({ ...attribute }));
  const clone = defaultTreeAdapter.createElement("ruby", source.namespaceURI, attrs);
  for (const node of nodes) {
    node.parentNode = clone;
    clone.childNodes.push(node);
  }
  return clone;
}

function splitRubyAtMatchBoundaries(
  parent: ParentNode,
  ruby: Element,
  match: Match,
  ranges: ReadonlyMap<ChildNode, TextRange>,
): void {
  const rubyRange = ranges.get(ruby)!;
  const selectedStart = Math.max(match.start, rubyRange.start);
  const selectedEnd = Math.min(match.end, rubyRange.end);
  const components = rubyComponents(ruby, ranges);
  const firstSelected = components.findIndex((component) =>
    component.end > selectedStart && component.start < selectedEnd
  );
  let lastSelected = firstSelected;
  while (
    lastSelected + 1 < components.length &&
    components[lastSelected + 1].start < selectedEnd
  ) {
    ++lastSelected;
  }
  if (
    firstSelected === -1 ||
    components[firstSelected].start !== selectedStart ||
    components[lastSelected].end !== selectedEnd
  ) {
    throw new Error(
      `Target occurrence ${JSON.stringify(match.surface)} selects only part of a ruby annotation ` +
        "component",
    );
  }

  const nodeGroups = [
    components.slice(0, firstSelected).flatMap((component) => component.nodes),
    components.slice(firstSelected, lastSelected + 1).flatMap((component) => component.nodes),
    components.slice(lastSelected + 1).flatMap((component) => component.nodes),
  ].filter((nodes) => nodes.length > 0);
  const replacements = nodeGroups.map((nodes, index) => cloneRuby(ruby, nodes, index === 0));
  for (const replacement of replacements) replacement.parentNode = parent;

  const rubyIndex = parent.childNodes.indexOf(ruby);
  if (rubyIndex === -1) throw new Error("Internal error: <ruby> has no parent");
  ruby.childNodes = [];
  ruby.parentNode = null;
  parent.childNodes.splice(rubyIndex, 1, ...replacements);
}

type WrapResult = "wrapped" | "retry";

function wrapWithin(
  parent: ParentNode,
  match: Match,
  ranges: ReadonlyMap<ChildNode, TextRange>,
): WrapResult {
  for (const child of parent.childNodes) {
    const range = ranges.get(child)!;
    if (range.start <= match.start && match.end <= range.end && range.start !== range.end) {
      if (isRuby(child)) {
        if (range.start !== match.start || range.end !== match.end) {
          splitRubyAtMatchBoundaries(parent, child, match, ranges);
          return "retry";
        }
      } else if (isElement(child)) {
        return wrapWithin(child, match, ranges);
      }
      break;
    }
  }

  const firstIndex = parent.childNodes.findIndex((child) => {
    const range = ranges.get(child)!;
    return range.end > match.start && range.start < match.end;
  });
  if (firstIndex === -1) {
    throw new Error(
      `Could not map target occurrence ${JSON.stringify(match.surface)} back to context HTML`,
    );
  }

  let lastIndex = firstIndex;
  for (let index = firstIndex + 1; index < parent.childNodes.length; ++index) {
    const range = ranges.get(parent.childNodes[index])!;
    if (range.start >= match.end) break;
    if (range.end > match.start) lastIndex = index;
  }

  const first = parent.childNodes[firstIndex];
  const last = parent.childNodes[lastIndex];
  const firstRange = ranges.get(first)!;
  const lastRange = ranges.get(last)!;

  if (firstRange.start < match.start) {
    if (isRuby(first)) {
      splitRubyAtMatchBoundaries(parent, first, match, ranges);
      return "retry";
    }
    if (isTextNode(first)) {
      splitTextNode(parent, first, match.start - firstRange.start);
      return "retry";
    }
    if (isElement(first)) throw partialElementError(match, first);
  }
  if (lastRange.end > match.end) {
    if (isRuby(last)) {
      splitRubyAtMatchBoundaries(parent, last, match, ranges);
      return "retry";
    }
    if (isTextNode(last)) {
      splitTextNode(parent, last, match.end - lastRange.start);
      return "retry";
    }
    if (isElement(last)) throw partialElementError(match, last);
  }
  if (firstRange.start !== match.start || lastRange.end !== match.end) {
    throw new Error(
      `Target occurrence ${JSON.stringify(match.surface)} crosses a rendered-text boundary that ` +
        "cannot be represented safely in HTML",
    );
  }

  const selected = parent.childNodes.slice(firstIndex, lastIndex + 1);
  const selectedBlock = selected.find((node) =>
    isElement(node) && BLOCK_ELEMENTS.has(node.tagName)
  );
  if (selectedBlock !== undefined && isElement(selectedBlock)) {
    throw new Error(
      `Target occurrence ${JSON.stringify(match.surface)} crosses a <${selectedBlock.tagName}> ` +
        "boundary",
    );
  }

  const mark = defaultTreeAdapter.createElement("mark", parse5HTML.NS.HTML, []);
  mark.parentNode = parent;
  for (const node of selected) {
    node.parentNode = mark;
    mark.childNodes.push(node);
  }
  parent.childNodes.splice(firstIndex, selected.length, mark);
  return "wrapped";
}

function wrapMatch(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
  match: Match,
): void {
  // At most two retries are normally needed to split the start and end text nodes. Keep a
  // generous fixed bound so malformed internal state fails clearly instead of looping.
  for (let attempt = 0; attempt < 8; ++attempt) {
    const { ranges } = indexFragment(fragment);
    if (wrapWithin(fragment, match, ranges) === "wrapped") return;
  }
  throw new Error(`Could not safely wrap target occurrence ${JSON.stringify(match.surface)}`);
}

function containsElement(
  parent: ParentNode,
  tagName: string,
): boolean {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === tagName || containsElement(child, tagName)) return true;
  }
  return false;
}

function parseUnmarkedContext(html: string): DefaultTreeAdapterTypes.DocumentFragment {
  const parseErrors: ParserError[] = [];
  const fragment = parseFragment(html, {
    onParseError(error) {
      parseErrors.push(error);
    },
  });
  if (parseErrors.length > 0) {
    const codes = [...new Set(parseErrors.map((error) => error.code))].join(", ");
    throw new Error(`Context HTML could not be parsed safely: ${codes}`);
  }
  if (containsElement(fragment, "mark")) {
    throw new Error("Context HTML must not already contain <mark> elements");
  }
  return fragment;
}

/**
 * Projects a trusted context fragment to the exact rendered base text used by range-aware markup.
 *
 * Ruby readings and element attributes are omitted, `<br>` contributes a newline, and block
 * elements contribute a trailing newline. Keep this projection package-internal: callers that need
 * to resolve dictionary spellings should use `resolveContextTarget()` so lookup ranges cannot be
 * paired accidentally with a different HTML-to-text convention.
 */
export function contextRenderedText(html: string): string {
  return indexFragment(parseUnmarkedContext(html)).renderedText;
}

function isUTF16Boundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const preceding = text.charCodeAt(offset - 1);
  const following = text.charCodeAt(offset);
  return !(preceding >= 0xD800 && preceding <= 0xDBFF && following >= 0xDC00 &&
    following <= 0xDFFF);
}

function validateOccurrences(
  renderedText: string,
  occurrences: readonly RenderedTextOccurrence[],
): Match[] {
  if (occurrences.length === 0) {
    throw new Error("targetOccurrences must contain at least one occurrence");
  }

  const matches = occurrences.map((occurrence, index) => {
    if (
      !Number.isInteger(occurrence.start) || !Number.isInteger(occurrence.end) ||
      occurrence.start < 0 || occurrence.start >= occurrence.end ||
      occurrence.end > renderedText.length
    ) {
      throw new Error(
        `targetOccurrences[${index}] has invalid UTF-16 range ` +
          `[${occurrence.start}, ${occurrence.end}) for rendered context length ${renderedText.length}`,
      );
    }
    if (
      !isUTF16Boundary(renderedText, occurrence.start) ||
      !isUTF16Boundary(renderedText, occurrence.end)
    ) {
      throw new Error(`targetOccurrences[${index}] splits a UTF-16 surrogate pair`);
    }

    const actualSurface = renderedText.slice(occurrence.start, occurrence.end);
    if (actualSurface !== occurrence.surface) {
      throw new Error(
        `targetOccurrences[${index}].surface is ${JSON.stringify(occurrence.surface)}, but range ` +
          `[${occurrence.start}, ${occurrence.end}) contains ${JSON.stringify(actualSurface)}`,
      );
    }
    return { ...occurrence };
  }).sort((left, right) => left.start - right.start || left.end - right.end);

  for (let index = 1; index < matches.length; ++index) {
    if (matches[index].start < matches[index - 1].end) {
      throw new Error(
        `targetOccurrences contains overlapping ranges [${matches[index - 1].start}, ` +
          `${matches[index - 1].end}) and [${matches[index].start}, ${matches[index].end})`,
      );
    }
  }
  return matches;
}

function markMatches(
  fragment: DefaultTreeAdapterTypes.DocumentFragment,
  matches: readonly Match[],
): string {
  for (const match of matches.toReversed()) wrapMatch(fragment, match);
  return serialize(fragment);
}

/** Whether a context contains source ruby inside one of its target marks. */
export function markedContextHasRuby(html: string): boolean {
  const fragment = parseFragment(html);

  function visit(parent: ParentNode, insideMark: boolean): boolean {
    for (const child of parent.childNodes) {
      if (!isElement(child)) continue;
      const childInsideMark = insideMark || child.tagName === "mark";
      if (childInsideMark && child.tagName === "ruby") return true;
      if (visit(child, childInsideMark)) return true;
    }
    return false;
  }

  return visit(fragment, false);
}

/**
 * Marks explicit rendered-text occurrences in an HTML context fragment.
 *
 * The supplied UTF-16 ranges refer to rendered base text: element attributes and `<rt>`/`<rp>`
 * contents are ignored, `<br>` contributes a newline, and block elements contribute a trailing
 * newline. Each `surface` must exactly match its range. This API is preferred when lookup has
 * already identified specific occurrences rather than every use of a surface string.
 */
export function markContextTargetOccurrences(
  html: string,
  targetOccurrences: readonly RenderedTextOccurrence[],
): string {
  const fragment = parseUnmarkedContext(html);
  const { renderedText } = indexFragment(fragment);
  return markMatches(fragment, validateOccurrences(renderedText, targetOccurrences));
}

/**
 * Marks every nonoverlapping occurrence of the requested surfaces in an HTML context fragment.
 *
 * Matching uses rendered base text: element attributes and `<rt>`/`<rp>` contents are ignored.
 * Horizontal whitespace inserted between a surface's characters is included in the mark. Source
 * `<ruby>` is split only when a target aligns exactly with complete annotation components.
 */
export function markContextTargets(
  html: string,
  targetSurfaces: readonly [string, ...string[]],
): string {
  if (targetSurfaces.length === 0 || targetSurfaces.some((surface) => surface === "")) {
    throw new Error("targetSurfaces must contain at least one nonempty string");
  }

  const fragment = parseUnmarkedContext(html);

  const distinctTargets = [...new Set(targetSurfaces)];
  const { renderedText } = indexFragment(fragment);
  for (const surface of distinctTargets) {
    if (findMatches(renderedText, [surface]).length === 0) {
      throw new Error(
        `targetSurfaces contains ${JSON.stringify(surface)}, which is absent from rendered context`,
      );
    }
  }

  const matches = findMatches(renderedText, distinctTargets);
  return markMatches(fragment, matches);
}
