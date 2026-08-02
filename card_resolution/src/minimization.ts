import { escape } from "@std/html/entities";
import { type DefaultTreeAdapterTypes, parseFragment, type ParserError, serialize } from "parse5";
import { ankiFuriganaToSurface } from "./anki_furigana.ts";
import { findSourceUnsupportedHiraganaWords } from "./lexical_grounding.ts";

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;
type TextNode = DefaultTreeAdapterTypes.TextNode;

const TARGET_SENTINEL_PREFIX = "⟪target";
const TARGET_END_SENTINEL_PREFIX = "⟪/target";
const TARGET_PATTERN = /⟪target:(\d+)⟫([\s\S]*?)⟪\/target:\1⟫/gu;

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

const INVISIBLE_ELEMENTS = new Set(["rt", "rp", "script", "style"]);

/** Plain source text with every existing target mark replaced by opaque generation sentinels. */
export interface MarkedContextTextTemplate {
  /** Plain rendered source text. Target surfaces remain between occurrence-addressed sentinels. */
  text: string;

  /** Exact visible text and source markup from every `<mark>`, in source order. */
  targets: readonly [{
    /** The zero-based occurrence ID used by this target's sentinels. */
    id: number;

    /** The exact rendered target surface sent to the model. */
    surface: string;

    /** The serialized source contents restored inside the eventual `<mark>`. */
    html: string;
  }, ...Array<{ id: number; surface: string; html: string }>];
}

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

function appendSeparator(text: string, separator: string): string {
  return text.endsWith(separator) ? text : `${text}${separator}`;
}

/**
 * Converts sanitized marked context HTML into safe plain-text model input.
 *
 * Ruby readings and other invisible HTML content are omitted; block boundaries become blank
 * lines; and each `<mark>`'s visible surface is wrapped in opaque sentinels. Exact marked source
 * markup is retained separately for restoration, so models cannot rewrite target markup or inject
 * HTML. Textual Anki bracket furigana is preserved by default for back-side context work;
 * `stripAnkiFurigana` projects only its displayed surface for semantic operations where a reading
 * must not leak onto the card front.
 */
export function markedContextTextTemplate(
  html: string,
  { stripAnkiFurigana = false }: { stripAnkiFurigana?: boolean } = {},
): MarkedContextTextTemplate {
  if (
    html.includes(TARGET_SENTINEL_PREFIX) ||
    html.includes(TARGET_END_SENTINEL_PREFIX)
  ) {
    throw new Error("Context HTML contains reserved target-sentinel text");
  }
  const parseErrors: ParserError[] = [];
  const fragment = parseFragment(html, {
    onParseError(error) {
      parseErrors.push(error);
    },
  });
  if (parseErrors.length > 0) {
    const codes = [...new Set(parseErrors.map(({ code }) => code))].join(", ");
    throw new Error(`Context HTML could not be parsed safely: ${codes}`);
  }

  const targets: Array<{ id: number; surface: string; html: string }> = [];
  function visibleText(parent: ParentNode, insideMark = false): string {
    let text = "";
    for (const child of parent.childNodes) {
      if (isTextNode(child)) {
        text += stripAnkiFurigana ? ankiFuriganaToSurface(child.value) : child.value;
        continue;
      }
      if (!isElement(child) || INVISIBLE_ELEMENTS.has(child.tagName)) continue;
      if (child.tagName === "mark") {
        if (insideMark) throw new Error("Context HTML must not contain nested <mark> elements");
        const surface = visibleText(child, true);
        if (surface.trim() === "") {
          throw new Error("Context HTML <mark> elements must contain substantive visible text");
        }
        const id = targets.length;
        targets.push({ id, surface, html: serialize(child) });
        text += `⟪target:${id}⟫${surface}⟪/target:${id}⟫`;
      } else if (child.tagName === "br") {
        text = appendSeparator(text, "\n");
      } else {
        text += visibleText(child, insideMark);
        if (BLOCK_ELEMENTS.has(child.tagName)) text = appendSeparator(text, "\n\n");
      }
    }
    return text;
  }

  const text = visibleText(fragment).trim();
  const [firstTarget, ...remainingTargets] = targets;
  if (firstTarget === undefined) {
    throw new Error("Context HTML must contain at least one <mark> element");
  }
  return {
    text,
    targets: [firstTarget, ...remainingTargets],
  };
}

/** Returns the visible text of sanitized marked context HTML without generation sentinels. */
export function renderMarkedContextText(html: string): string {
  return markedContextTextTemplate(html).text.replace(TARGET_PATTERN, "$2");
}

function substantiveLength(text: string): number {
  return [...text.replace(TARGET_PATTERN, "$2")]
    .filter((character) => /[\p{Letter}\p{Number}]/v.test(character))
    .length;
}

function requiresLiteralSourceSupport(character: string): boolean {
  return /[\p{Script=Han}\p{Script=Katakana}\p{Script=Latin}\p{Number}]/v.test(character);
}

function balanced(text: string, opening: string, closing: string): boolean {
  let depth = 0;
  for (const character of text) {
    if (character === opening) ++depth;
    if (character === closing && --depth < 0) return false;
  }
  return depth === 0;
}

function endsInDependentFragment(paragraph: string): boolean {
  const withoutClosingPunctuation = paragraph.trim()
    .replace(/[」』）]+$/u, "")
    .replace(/[。！？!?\.]+$/u, "")
    .trimEnd();
  return /(?:のように|とも知らずに)$/u.test(withoutClosingPunctuation);
}

const JAPANESE_WORD_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/v;

function textOutsideTargetSentinels(text: string): string[] {
  const segments: string[] = [];
  let index = 0;
  for (const match of text.matchAll(TARGET_PATTERN)) {
    segments.push(text.slice(index, match.index));
    index = match.index + match[0].length;
  }
  segments.push(text.slice(index));
  return segments;
}

function adjacentCharacter(text: string, index: number, direction: "before" | "after"): string {
  if (direction === "before") return [...text.slice(0, index)].at(-1) ?? "";
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

function supportedBackgroundAttachments(
  template: MarkedContextTextTemplate,
  surface: string,
): ReadonlySet<string> {
  const attachments = new Set<string>();
  for (const segment of textOutsideTargetSentinels(template.text)) {
    for (
      let start = segment.indexOf(surface);
      start !== -1;
      start = segment.indexOf(surface, start + 1)
    ) {
      const before = adjacentCharacter(segment, start, "before");
      const after = adjacentCharacter(segment, start + surface.length, "after");
      if (JAPANESE_WORD_CHARACTER.test(before)) attachments.add(`before:${before}`);
      if (JAPANESE_WORD_CHARACTER.test(after)) attachments.add(`after:${after}`);
    }
  }
  return attachments;
}

function validateUnmarkedTargetSurfaces(
  template: MarkedContextTextTemplate,
  candidate: string,
): void {
  for (const surface of new Set(template.targets.map((target) => target.surface))) {
    const supportedAttachments = supportedBackgroundAttachments(template, surface);
    for (const segment of textOutsideTargetSentinels(candidate)) {
      for (
        let start = segment.indexOf(surface);
        start !== -1;
        start = segment.indexOf(surface, start + 1)
      ) {
        const before = adjacentCharacter(segment, start, "before");
        const after = adjacentCharacter(segment, start + surface.length, "after");
        const isSupportedLookalike = supportedAttachments.has(`before:${before}`) ||
          supportedAttachments.has(`after:${after}`);
        if (!isSupportedLookalike) {
          throw new Error(
            `AI minimized context retained target surface ${JSON.stringify(surface)} without its ` +
              "occurrence sentinel",
          );
        }
      }
    }
  }
}

function validateCandidate(
  template: MarkedContextTextTemplate,
  candidate: string,
): Array<{ start: number; end: number; id: number; surface: string }> {
  const matches = [...candidate.matchAll(TARGET_PATTERN)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    id: Number(match[1]),
    surface: match[2],
  }));
  if (matches.length === 0) {
    throw new Error("AI minimized context must preserve at least one target-sentinel pair");
  }
  const unmatchedSentinels = candidate.replace(TARGET_PATTERN, "");
  if (
    unmatchedSentinels.includes(TARGET_SENTINEL_PREFIX) ||
    unmatchedSentinels.includes(TARGET_END_SENTINEL_PREFIX)
  ) {
    throw new Error("AI minimized context contains unmatched or nested target sentinels");
  }

  const targetsById = new Map(template.targets.map((target) => [target.id, target]));
  const usedIds = new Set<number>();
  for (const { id, surface } of matches) {
    const target = targetsById.get(id);
    if (target === undefined) {
      throw new Error(
        `AI minimized context uses unknown target occurrence ID ${id}`,
      );
    }
    if (usedIds.has(id)) {
      throw new Error(`AI minimized context duplicates target occurrence ID ${id}`);
    }
    usedIds.add(id);
    if (target.surface !== surface) {
      throw new Error(
        `AI minimized context changed target surface for occurrence ID ${id} from ${
          JSON.stringify(target.surface)
        } to ${JSON.stringify(surface)}`,
      );
    }
  }
  validateUnmarkedTargetSurfaces(template, candidate);

  const sourceCharacters = new Set(template.text);
  const unsupportedCharacters = [
    ...new Set(
      [...candidate].filter((character) =>
        requiresLiteralSourceSupport(character) && !sourceCharacters.has(character)
      ),
    ),
  ];
  if (unsupportedCharacters.length > 0) {
    throw new Error(
      `AI minimized context introduces source-unsupported lexical character(s) ${
        unsupportedCharacters.map((character) => JSON.stringify(character)).join(", ")
      }`,
    );
  }
  const unsupportedHiraganaWords = findSourceUnsupportedHiraganaWords(
    candidate.replace(TARGET_PATTERN, ""),
    template.text.replace(TARGET_PATTERN, ""),
  );
  if (unsupportedHiraganaWords.length > 0) {
    throw new Error(
      `AI minimized context introduces source-unsupported hiragana word(s) ${
        unsupportedHiraganaWords.map((word) => JSON.stringify(word)).join(", ")
      }`,
    );
  }
  const sourceText = template.text.replace(TARGET_PATTERN, "$2");
  const candidateText = candidate.replace(TARGET_PATTERN, "$2");
  const unsupportedAdjacentRepetitions = new Set<string>();
  const candidateCharacters = [...candidateText];
  for (let index = 1; index < candidateCharacters.length; ++index) {
    const character = candidateCharacters[index];
    if (
      character === candidateCharacters[index - 1] &&
      requiresLiteralSourceSupport(character) &&
      !sourceText.includes(`${character}${character}`)
    ) {
      unsupportedAdjacentRepetitions.add(`${character}${character}`);
    }
  }
  if (unsupportedAdjacentRepetitions.size > 0) {
    throw new Error(
      `AI minimized context introduces source-unsupported adjacent lexical repetition(s) ${
        [...unsupportedAdjacentRepetitions].map((text) => JSON.stringify(text)).join(", ")
      }`,
    );
  }

  if (substantiveLength(candidate) >= substantiveLength(template.text)) {
    throw new Error("AI minimized context must be substantively shorter than the full context");
  }
  const unterminatedParagraph = candidate.split(/\n\s*\n/gu).find((paragraph) =>
    !/[。！？!?\.」』]$/u.test(paragraph.trim())
  );
  if (unterminatedParagraph !== undefined) {
    throw new Error(
      `AI minimized context paragraph must end as a complete sentence; received ${
        JSON.stringify(unterminatedParagraph.trim())
      }`,
    );
  }
  const dependentFragment = candidate.split(/\n\s*\n/gu).find(endsInDependentFragment);
  if (dependentFragment !== undefined) {
    throw new Error(
      `AI minimized context paragraph ends in a dependent fragment rather than a complete sentence: ${
        JSON.stringify(dependentFragment.trim())
      }`,
    );
  }
  for (const [opening, closing] of [["「", "」"], ["『", "』"], ["（", "）"]]) {
    if (!balanced(candidate, opening, closing)) {
      throw new Error(
        `AI minimized context contains unbalanced ${opening}${closing} punctuation`,
      );
    }
  }
  return matches;
}

function renderInline(
  candidate: string,
  targetsById: ReadonlyMap<number, { html: string }>,
): string {
  let result = "";
  let index = 0;
  for (const match of candidate.matchAll(TARGET_PATTERN)) {
    result += escape(candidate.slice(index, match.index));
    const id = Number(match[1]);
    const target = targetsById.get(id);
    if (target === undefined) {
      throw new Error(
        `Internal error: no source markup exists for target occurrence ID ${id}`,
      );
    }
    result += `<mark>${target.html}</mark>`;
    index = match.index + match[0].length;
  }
  result += escape(candidate.slice(index));
  return result;
}

/**
 * Validates and safely renders model-produced minimized text as context HTML.
 *
 * `null` means the full context is already concise. Non-null text must be substantively shorter,
 * preserve at least one exact source target sentinel, end each paragraph with sentence
 * punctuation, avoid recognized dependent endings, and use balanced Japanese quotation
 * punctuation. All model text is HTML-escaped before the sentinels become `<mark>`. A target
 * surface outside its occurrence sentinel is rejected unless the source contains that same
 * character attachment inside an unmarked lexical lookalike, such as `なる` within `異なる`.
 */
export function renderMinimizedContextText(
  template: MarkedContextTextTemplate,
  minimizedText: string | null,
): string | null {
  if (minimizedText === null) return null;
  const candidate = minimizedText.trim().replaceAll("\r\n", "\n");
  validateCandidate(template, candidate);
  const targetsById = new Map(template.targets.map((target) => [target.id, target]));
  const paragraphs = candidate.split(/\n\s*\n/gu).map((paragraph) =>
    renderInline(paragraph.replaceAll("\n", "").trim(), targetsById)
  );
  return paragraphs.length === 1
    ? paragraphs[0]
    : paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n\n");
}
