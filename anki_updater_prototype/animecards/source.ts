import { unescape } from "@std/html/entities";
import * as path from "@std/path";
import { formatSourceHTML } from "card_creator";
import { normalizePlainText } from "./html.ts";
import type { SourceResolution } from "./types.ts";

export interface EPUBSourceCorpus {
  sources: Array<{ name: string; documents: string[]; paragraphs?: EPUBParagraph[] }>;
}

export interface EPUBParagraph {
  html: string;
  plainText: string;
  document: string;
  index: number;
}

export interface EPUBContextMatch {
  source: string;
  paragraph: EPUBParagraph;
  window: EPUBParagraph[];
}

const READER_SUFFIX_PATTERN = /\s*\|\s*(?:Miwake Reader|ッツ Ebook Reader)\s*$/iu;
const EDITION_SUFFIX_PATTERN = /\s*[（(]ハヤカワ文庫JA[）)]\s*$/u;
const PRIVATE_SOURCE_HOSTS = new Set([
  "reader.miwake.app",
  "reader.ttsu.app",
]);
const TEMPORARY_QUERY_PARAMETER_PATTERN = /^(?:auth|expires?|signature|token)$/iu;

/** Formats the resolved source for storage on a Miwake card. */
export function formatResolvedSourceHTML(source: SourceResolution): string {
  if (source.name === null) return "";
  return formatSourceHTML(source.name, source.urlIsPublic ? source.url : null)!;
}

export function searchableEPUBText(html: string): string {
  return unescape(
    html
      .replace(/<rt\b[^>]*>.*?<\/rt>/gisu, "")
      .replace(/<[^>]+>/gu, ""),
  ).replace(/\s+/gu, "").trim();
}

function cleanEPUBHTML(html: string): string {
  return html
    .replace(/<img\b[^>]*>/giu, "")
    .replace(/<\/?(?:rb|span|a)\b[^>]*>/giu, "")
    .replace(/\s+(?:class|id)=["'][^"']*["']/giu, "")
    .replace(/<ruby\b[^>]*>/giu, "<ruby>")
    .replace(/<rt\b[^>]*>/giu, "<rt>")
    .trim();
}

function extractParagraphs(xhtml: string, document: string): EPUBParagraph[] {
  const paragraphs: EPUBParagraph[] = [];
  for (const match of xhtml.matchAll(/<p\b[^>]*>(.*?)<\/p>/gisu)) {
    const html = cleanEPUBHTML(match[1]);
    const plainText = searchableEPUBText(html);
    if (plainText.length < 2) continue;
    paragraphs.push({ html, plainText, document, index: paragraphs.length });
  }
  return paragraphs;
}

async function* walkFiles(directory: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(directory)) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile) {
      yield entryPath;
    }
  }
}

/** Loads searchable XHTML documents grouped by their containing book directory. */
export async function loadEPUBSourceCorpus(directory: string): Promise<EPUBSourceCorpus> {
  const sources: EPUBSourceCorpus["sources"] = [];
  const entries = [];
  for await (const entry of Deno.readDir(directory)) {
    if (entry.isDirectory) entries.push(entry);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const documents: string[] = [];
    const paragraphs: EPUBParagraph[] = [];
    for await (const filePath of walkFiles(path.join(directory, entry.name))) {
      if (!/\.x?html$/iu.test(filePath) || path.basename(filePath) === "titlepage.xhtml") continue;
      const xhtml = await Deno.readTextFile(filePath);
      const text = searchableEPUBText(xhtml);
      if (text) documents.push(text);
      paragraphs.push(...extractParagraphs(xhtml, filePath));
    }
    if (documents.length > 0) sources.push({ name: entry.name, documents, paragraphs });
  }
  return { sources };
}

/** Finds one exact EPUB paragraph occurrence and returns its surrounding paragraph window. */
export function findUniqueEPUBContext(
  corpus: EPUBSourceCorpus,
  contextHTML: string,
  sourceName?: string,
): EPUBContextMatch | null {
  const context = searchableEPUBText(contextHTML);
  if (context.length < 3) return null;

  const matches: EPUBContextMatch[] = [];
  for (const source of corpus.sources) {
    if (sourceName !== undefined && source.name !== sourceName) continue;
    for (const paragraph of source.paragraphs ?? []) {
      if (
        !paragraph.plainText.includes(context) ||
        paragraph.plainText.indexOf(context) !== paragraph.plainText.lastIndexOf(context)
      ) continue;
      const window = (source.paragraphs ?? []).filter((candidate) =>
        candidate.document === paragraph.document &&
        candidate.index >= paragraph.index - 3 &&
        candidate.index <= paragraph.index + 3
      );
      matches.push({ source: source.name, paragraph, window });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

/** Finds a book only when the complete context occurs in exactly one EPUB source. */
export function findUniqueEPUBSource(
  corpus: EPUBSourceCorpus,
  contextHTML: string,
): string | null {
  const context = searchableEPUBText(contextHTML);
  if (context.length < 3) return null;

  const matches = corpus.sources
    .filter((source) => source.documents.some((document) => document.includes(context)))
    .map((source) => source.name);
  return matches.length === 1 ? matches[0] : null;
}

interface HTMLToken {
  html: string;
  plainText: string;
}

function tokenizeEPUBHTML(html: string): HTMLToken[] {
  const tokens: HTMLToken[] = [];
  const parts =
    html.match(/<ruby>.*?<\/ruby>|<br\s*\/?>|<[^>]+>|&(?:#x[\da-f]+|#\d+|\w+);|[^<&]/gisu) ?? [];
  for (const part of parts) {
    if (/^<ruby>/iu.test(part)) {
      tokens.push({ html: part, plainText: searchableEPUBText(part) });
    } else if (/^</u.test(part)) {
      tokens.push({ html: /^<br/iu.test(part) ? "<br>" : part, plainText: "" });
    } else {
      const plainText = unescape(part);
      tokens.push({ html: part, plainText: /\s/u.test(plainText) ? "" : plainText });
    }
  }
  return tokens;
}

/** Re-extracts a unique plain-text substring from EPUB HTML, retaining source-authored ruby. */
export function extractEPUBHTMLSubstring(html: string, plainText: string): string | null {
  const needle = searchableEPUBText(plainText);
  if (!needle) return null;
  const tokens = tokenizeEPUBHTML(html);
  const haystack = tokens.map((token) => token.plainText).join("");
  const start = haystack.indexOf(needle);
  if (start === -1 || start !== haystack.lastIndexOf(needle)) return null;
  const end = start + needle.length;

  let plainOffset = 0;
  let firstToken = -1;
  let lastToken = -1;
  for (let index = 0; index < tokens.length; ++index) {
    const tokenStart = plainOffset;
    const tokenEnd = tokenStart + tokens[index].plainText.length;
    if (tokens[index].plainText && tokenEnd > start && tokenStart < end) {
      if (firstToken === -1) firstToken = index;
      lastToken = index;
    }
    plainOffset = tokenEnd;
  }
  if (firstToken === -1 || lastToken === -1) return null;
  return tokens.slice(firstToken, lastToken + 1).map((token) => token.html).join("").trim();
}

export function EPUBBracketsAreBalanced(text: string): boolean {
  const pairs: Record<string, string> = { "「": "」", "『": "』", "（": "）", "【": "】" };
  const closing = new Set(Object.values(pairs));
  const stack: string[] = [];
  for (const character of text) {
    if (pairs[character] !== undefined) {
      stack.push(pairs[character]);
    } else if (closing.has(character) && stack.pop() !== character) {
      return false;
    }
  }
  return stack.length === 0;
}

const JAPANESE_QUOTE_PAIRS: Readonly<Record<string, string>> = { "「": "」", "『": "』" };
// Japanese publishing convention represents an omission with two U+2026 leaders.
const JAPANESE_ELLIPSIS = "……";
const MAX_ADDED_CONTEXT_CHARACTERS = 200;
const RELEVANCE_SELECTION_MINIMUM_ADDED_CHARACTERS = 100;
const SENTENCE_END_PATTERN = /[。！？!?]/u;

function openQuotesAt(text: string, end: number): string[] | null {
  const stack: string[] = [];
  const closingQuotes = new Set(Object.values(JAPANESE_QUOTE_PAIRS));
  for (const character of text.slice(0, end)) {
    if (JAPANESE_QUOTE_PAIRS[character] !== undefined) {
      stack.push(character);
    } else if (closingQuotes.has(character)) {
      const opening = stack.pop();
      if (opening === undefined || JAPANESE_QUOTE_PAIRS[opening] !== character) return null;
    }
  }
  return stack;
}

function closeElidedQuotes(openQuotes: string[], selectedText: string): string {
  if (openQuotes.length === 0) return "";
  const ellipsis = /…[。！？!?]?$/u.test(selectedText) ? "" : JAPANESE_ELLIPSIS;
  const closingQuotes = [...openQuotes].reverse()
    .map((opening) => JAPANESE_QUOTE_PAIRS[opening])
    .join("");
  return `${ellipsis}${closingQuotes}`;
}

function elidedQuotedSubstring(
  restoredHTML: string,
  restoredText: string,
  originalText: string,
  start: number,
  end: number,
  maximumAddedCharacters: number,
): string | null {
  const openAtStart = openQuotesAt(restoredText, start);
  const openAtEnd = openQuotesAt(restoredText, end);
  if (openAtStart === null || openAtEnd === null) return null;
  if (openAtStart.length === 0 && openAtEnd.length === 0) return null;

  const sourceHTML = extractEPUBHTMLSubstring(restoredHTML, restoredText.slice(start, end));
  if (sourceHTML === null) return null;
  const prefix = openAtStart.map((opening) => `${opening}${JAPANESE_ELLIPSIS}`).join("");
  const suffix = closeElidedQuotes(openAtEnd, restoredText.slice(start, end));
  const result = `${prefix}${sourceHTML}${suffix}`;
  const resultText = searchableEPUBText(result);
  if (
    !resultText.includes(originalText) ||
    !EPUBBracketsAreBalanced(resultText) ||
    [...resultText].length - [...originalText].length > maximumAddedCharacters
  ) {
    return null;
  }
  return result;
}

/** Whether a long restored quotation merits a separate relevance-selection pass. */
export function quotedEPUBContextNeedsRelevanceSelection(
  restoredHTML: string,
  originalContextHTML: string,
): boolean {
  const restoredText = searchableEPUBText(restoredHTML);
  const originalText = searchableEPUBText(originalContextHTML);
  const addedCharacters = [...restoredText].length - [...originalText].length;
  const sentenceEnds = restoredText.match(/[。！？!?]/gu)?.length ?? 0;
  return addedCharacters > RELEVANCE_SELECTION_MINIMUM_ADDED_CHARACTERS &&
    sentenceEnds >= 2 &&
    /[「『]/u.test(restoredText) &&
    /[」』]/u.test(restoredText) &&
    EPUBBracketsAreBalanced(restoredText);
}

/** Validates a model-selected source span and marks any omitted surrounding dialogue. */
export function formatRelevantQuotedEPUBContext(
  restoredHTML: string,
  selectedContextHTML: string,
  originalContextHTML: string,
): string | null {
  const restoredText = searchableEPUBText(restoredHTML);
  const selectedText = searchableEPUBText(selectedContextHTML);
  const originalText = searchableEPUBText(originalContextHTML);
  if (!selectedText.includes(originalText) || selectedText.length >= restoredText.length) {
    return null;
  }

  const selectedStart = restoredText.indexOf(selectedText);
  if (selectedStart === -1 || selectedStart !== restoredText.lastIndexOf(selectedText)) return null;
  let start = selectedStart;
  let end = selectedStart + selectedText.length;
  while (start > 0 && /[「『]/u.test(restoredText[start - 1])) --start;
  while (end < restoredText.length && /[」』]/u.test(restoredText[end])) ++end;
  const leftIsNatural = start === 0 ||
    /[。！？!?」』]/u.test(restoredText[start - 1]) ||
    /[「『]/u.test(restoredText[start]);
  const rightIsNatural = end === restoredText.length ||
    /[。！？!?」』…]/u.test(restoredText[end - 1] ?? "");
  if (!leftIsNatural || !rightIsNatural) return null;

  const openAtStart = openQuotesAt(restoredText, start);
  const openAtEnd = openQuotesAt(restoredText, end);
  if (openAtStart === null || openAtEnd === null) return null;
  const sourceHTML = extractEPUBHTMLSubstring(restoredHTML, restoredText.slice(start, end));
  if (sourceHTML === null) return null;

  const prefix = openAtStart.map((opening) => `${opening}${JAPANESE_ELLIPSIS}`).join("");
  const suffix = closeElidedQuotes(openAtEnd, restoredText.slice(start, end));
  const result = `${prefix}${sourceHTML}${suffix}`;
  const resultText = searchableEPUBText(result);
  return resultText.includes(originalText) && EPUBBracketsAreBalanced(resultText) ? result : null;
}

/** Explicitly elides distant dialogue when quote balancing would make a context excessive. */
export function elideLongQuotedEPUBContext(
  restoredHTML: string,
  originalContextHTML: string,
  maximumAddedCharacters = MAX_ADDED_CONTEXT_CHARACTERS,
): string {
  const restoredText = searchableEPUBText(restoredHTML);
  const originalText = searchableEPUBText(originalContextHTML);
  if (
    [...restoredText].length - [...originalText].length <= maximumAddedCharacters ||
    !EPUBBracketsAreBalanced(restoredText)
  ) {
    return restoredHTML;
  }

  const originalStart = restoredText.indexOf(originalText);
  if (originalStart === -1 || originalStart !== restoredText.lastIndexOf(originalText)) {
    return restoredHTML;
  }
  const originalEnd = originalStart + originalText.length;

  let sentenceStart = 0;
  for (let index = originalStart - 1; index >= 0; --index) {
    if (SENTENCE_END_PATTERN.test(restoredText[index])) {
      sentenceStart = index + 1;
      break;
    }
  }
  let sentenceEnd = originalEnd;
  if (!SENTENCE_END_PATTERN.test(restoredText[originalEnd - 1] ?? "")) {
    sentenceEnd = restoredText.length;
    for (let index = originalEnd; index < restoredText.length; ++index) {
      if (SENTENCE_END_PATTERN.test(restoredText[index]) || /[」』]/u.test(restoredText[index])) {
        sentenceEnd = index + 1;
        break;
      }
    }
  }

  return elidedQuotedSubstring(
    restoredHTML,
    restoredText,
    originalText,
    sentenceStart,
    sentenceEnd,
    maximumAddedCharacters,
  ) ?? restoredHTML;
}

/** True when an excerpt already starts and ends at natural source-context boundaries. */
export function hasCompleteContextBoundaries(paragraph: string, excerpt: string): boolean {
  const start = paragraph.indexOf(excerpt);
  if (start === -1 || start !== paragraph.lastIndexOf(excerpt)) return false;
  const end = start + excerpt.length;
  const leftComplete = start === 0 || /[。！？!?」』「『]/u.test(paragraph[start - 1]);
  const rightComplete = end === paragraph.length || /[。！？!?」』]/u.test(excerpt.at(-1) ?? "");
  return leftComplete && rightComplete && EPUBBracketsAreBalanced(excerpt);
}

/** Expands an excerpt to its containing source sentence without model judgment. */
export function expandEPUBContextToSentence(
  paragraph: EPUBParagraph,
  contextHTML: string,
): string | null {
  const excerpt = searchableEPUBText(contextHTML);
  const start = paragraph.plainText.indexOf(excerpt);
  if (start === -1 || start !== paragraph.plainText.lastIndexOf(excerpt)) return null;
  const originalEnd = start + excerpt.length;

  let sentenceStart = 0;
  for (let index = start - 1; index >= 0; --index) {
    if (/[。！？!?」』「『]/u.test(paragraph.plainText[index])) {
      sentenceStart = index + 1;
      break;
    }
  }
  let sentenceEnd = paragraph.plainText.length;
  for (let index = originalEnd; index < paragraph.plainText.length; ++index) {
    if (/[。！？!?]/u.test(paragraph.plainText[index])) {
      sentenceEnd = index + 1;
      break;
    }
  }
  const expanded = paragraph.plainText.slice(sentenceStart, sentenceEnd);
  if (expanded.length <= excerpt.length || !EPUBBracketsAreBalanced(expanded)) return null;
  return extractEPUBHTMLSubstring(paragraph.html, expanded);
}

/**
 * Recovers a balanced paragraph when an excerpt reaches its final closing quotation mark.
 *
 * This is intentionally narrower than general paragraph expansion: it applies only when the
 * source text after the excerpt consists entirely of closing Japanese quotation marks, and only
 * when the whole paragraph is balanced. It handles Animecards excerpts that dropped the closing
 * quote from a paragraph whose internal sentence punctuation prevents sentence-only balancing.
 */
export function expandEPUBContextToBalancedParagraphEnd(
  paragraph: EPUBParagraph,
  contextHTML: string,
): string | null {
  const excerpt = searchableEPUBText(contextHTML);
  const start = paragraph.plainText.indexOf(excerpt);
  if (start === -1 || start !== paragraph.plainText.lastIndexOf(excerpt)) return null;
  const remainder = paragraph.plainText.slice(start + excerpt.length);
  if (!/^[」』]+$/u.test(remainder) || !EPUBBracketsAreBalanced(paragraph.plainText)) return null;
  return extractEPUBHTMLSubstring(paragraph.html, paragraph.plainText);
}

export type EPUBContextAnalysis =
  | { status: "not-found" }
  | { status: "complete"; match: EPUBContextMatch; contextHTML: string }
  | { status: "cut-off"; match: EPUBContextMatch };

/** Finds an EPUB excerpt, restores ruby immediately, and flags only true cutoff cases for AI. */
export function analyzeEPUBContext(
  corpus: EPUBSourceCorpus,
  contextHTML: string,
  sourceName?: string,
): EPUBContextAnalysis {
  const match = findUniqueEPUBContext(corpus, contextHTML, sourceName);
  if (match === null) return { status: "not-found" };
  const excerpt = searchableEPUBText(contextHTML);
  if (!hasCompleteContextBoundaries(match.paragraph.plainText, excerpt)) {
    return { status: "cut-off", match };
  }
  const restored = extractEPUBHTMLSubstring(match.paragraph.html, excerpt);
  return restored === null
    ? { status: "cut-off", match }
    : { status: "complete", match, contextHTML: restored };
}

export function cleanSourceName(sourceHTML: string): string | null {
  const source = normalizePlainText(sourceHTML)
    .replace(READER_SUFFIX_PATTERN, "")
    .replace(EDITION_SUFFIX_PATTERN, "")
    .trim();
  return source || null;
}

export function extractSourceURL(sourceURLHTML: string): string | null {
  const href = sourceURLHTML.match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
  const candidate = unescape(href ?? normalizePlainText(sourceURLHTML));
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function isPublicSourceURL(sourceURL: string): boolean {
  const url = new URL(sourceURL);
  if (PRIVATE_SOURCE_HOSTS.has(url.hostname) || url.username || url.password) return false;
  return ![...url.searchParams.keys()].some((name) => TEMPORARY_QUERY_PARAMETER_PATTERN.test(name));
}

/** Resolves an auditable source using explicit fields first, then a unique EPUB match. */
export function resolveSource(
  sourceHTML: string,
  sourceURLHTML: string,
  contextHTML: string,
  epubCorpus?: EPUBSourceCorpus,
): SourceResolution {
  const explicitName = cleanSourceName(sourceHTML);
  const sourceURL = extractSourceURL(sourceURLHTML);
  if (explicitName !== null) {
    return {
      name: explicitName,
      method: "source-field",
      url: sourceURL,
      urlIsPublic: sourceURL !== null && isPublicSourceURL(sourceURL),
    };
  }

  const epubName = epubCorpus === undefined ? null : findUniqueEPUBSource(epubCorpus, contextHTML);
  return {
    name: epubName,
    method: epubName === null ? "none" : "epub",
    url: sourceURL,
    urlIsPublic: sourceURL !== null && isPublicSourceURL(sourceURL),
  };
}
