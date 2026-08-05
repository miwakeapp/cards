import {
  type DocumentFragment,
  DOMParser,
  type Element,
  type HTMLTemplateElement,
  Node,
  type Text,
} from "@b-fuze/deno-dom";
import { escape, unescape } from "@std/html/entities";
import { parseAnkiFurigana } from "japanese_text";

/** One validated alternative recovered from a canonical Miwake Card Reading field. */
export interface ParsedReadingAlternative {
  /** One alternative's decoded Anki bracket notation. */
  formatted: string;
  /** The complete pronunciation reconstructed from its bracket notation. */
  kanaReading: string;
}

const HTML_DOCUMENT = new DOMParser().parseFromString("<body></body>", "text/html");

function parseHTMLFragment(html: string): DocumentFragment {
  const template = HTML_DOCUMENT.createElement("template") as HTMLTemplateElement;
  template.innerHTML = html;
  return template.content;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/** Formats decoded Anki bracket notation as a complete HTML-valued Reading field. */
export function formatReading(alternatives: readonly string[]): string {
  if (alternatives.length === 0 || alternatives.some((alternative) => alternative === "")) {
    throw new Error("Reading alternatives must be nonempty");
  }

  const escaped = alternatives.map((alternative) => escape(alternative));
  if (escaped.length === 1) return escaped[0];
  return `<ul>${escaped.map((alternative) => `<li>${alternative}</li>`).join("")}</ul>`;
}

/** Adds display affixes without letting a leading affix become part of the first ruby base. */
export function decorateReadingAlternative(
  alternative: string,
  prefix: string,
  suffix: string,
): string {
  const parsed = parseAnkiFurigana(alternative);
  if (parsed === null) throw new Error("Reading alternative must use valid Anki furigana syntax");
  const prefixDelimiter = prefix !== "" && parsed.parts[0].type === "ruby" ? " " : "";
  return `${prefix}${prefixDelimiter}${alternative}${suffix}`;
}

function parseAlternative(
  formatted: string,
  expectedSurface: string,
): ParsedReadingAlternative | null {
  const parsed = parseAnkiFurigana(formatted);
  return parsed?.surface === expectedSurface ? { formatted, kanaReading: parsed.reading } : null;
}

function textOnly(node: Node): string | null {
  return [...node.childNodes].every(isText) ? node.textContent : null;
}

function formattedAlternatives(field: string): string[] | null {
  const fragment = parseHTMLFragment(field);
  const topLevelNodes = [...fragment.childNodes];
  if (topLevelNodes.length === 1 && isText(topLevelNodes[0])) {
    return [topLevelNodes[0].data];
  }
  if (topLevelNodes.length !== 1 || !isElement(topLevelNodes[0])) return null;

  const list = topLevelNodes[0];
  if (list.tagName !== "UL" || list.attributes.length !== 0) return null;

  const alternatives: string[] = [];
  for (const child of list.childNodes) {
    if (isText(child) && child.data.trim() === "") continue;
    if (!isElement(child) || child.tagName !== "LI" || child.attributes.length !== 0) return null;
    const text = textOnly(child);
    if (text === null) return null;
    alternatives.push(text);
  }
  return alternatives.length >= 2 ? alternatives : null;
}

/** Parses the strict plain-single or HTML-list Reading field representation. */
export function parseReading(
  field: string,
  expectedSurface: string,
): ParsedReadingAlternative[] | null {
  const alternatives = formattedAlternatives(field);
  if (alternatives === null) return null;

  const decodedSurface = unescape(expectedSurface);
  const parsed: ParsedReadingAlternative[] = [];
  for (const alternative of alternatives) {
    const result = parseAlternative(alternative, decodedSurface);
    if (result === null) return null;
    parsed.push(result);
  }
  return parsed;
}
