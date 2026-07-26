import { unescape } from "@std/html/entities";
import * as path from "@std/path";
import type { CardSource } from "card_creator";
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
  paragraphs: EPUBParagraph[];
  window: EPUBParagraph[];
}

const READER_SUFFIX_PATTERN = /\s*\|\s*(?:Miwake Reader|ッツ Ebook Reader)\s*$/iu;
const EDITION_SUFFIX_PATTERN = /\s*[（(]ハヤカワ文庫JA[）)]\s*$/u;
const PRIVATE_SOURCE_HOSTS = new Set([
  "reader.miwake.app",
  "reader.ttsu.app",
]);
const TEMPORARY_QUERY_PARAMETER_PATTERN = /^(?:auth|expires?|signature|token)$/iu;

/** Best-effort language classification for unstructured legacy source labels. */
export function inferLegacySourceLanguage(sourceText: string): "ja" | "en" {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/v.test(sourceText) ? "ja" : "en";
}

/** Adapts an audited Animecards source resolution to deterministic `card_creator` input. */
export function cardSourceFromResolution(source: SourceResolution): CardSource | undefined {
  if (source.name === null) return undefined;
  // EPUBs in this corpus are Japanese works even when a particular title is written in Latin
  // characters. Unstructured legacy fields have no such provenance, so use a script heuristic.
  const lang = source.method === "epub" ? "ja" : inferLegacySourceLanguage(source.name);
  // Animecards source labels are book/work titles. Preserve any explicit Japanese title
  // punctuation in a legacy field; otherwise add book-title punctuation here, at the caller layer.
  const text = lang === "ja" && !/^(?:『.*』|「.*」)$/u.test(source.name)
    ? `『${source.name}』`
    : source.name;
  return {
    text,
    lang,
    ...(source.urlIsPublic && source.url !== null ? { url: source.url } : {}),
  };
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
    if (!plainText) continue;
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

function joinedParagraphText(paragraphs: readonly EPUBParagraph[]): string {
  return paragraphs.map((paragraph) => paragraph.plainText).join("");
}

function paragraphSpanAt(
  paragraphs: readonly EPUBParagraph[],
  start: number,
  end: number,
): EPUBParagraph[] {
  const result: EPUBParagraph[] = [];
  let offset = 0;
  for (const paragraph of paragraphs) {
    const paragraphEnd = offset + paragraph.plainText.length;
    if (paragraphEnd > start && offset < end) result.push(paragraph);
    offset = paragraphEnd;
  }
  return result;
}

function findEPUBContexts(
  corpus: EPUBSourceCorpus,
  contextHTML: string,
  sourceName?: string,
): EPUBContextMatch[] {
  const context = searchableEPUBText(contextHTML);
  if (context.length < 3) return [];

  const matches: EPUBContextMatch[] = [];
  for (const source of corpus.sources) {
    if (sourceName !== undefined && source.name !== sourceName) continue;
    const paragraphsByDocument = Map.groupBy(
      source.paragraphs ?? [],
      (paragraph) => paragraph.document,
    );
    for (const documentParagraphs of paragraphsByDocument.values()) {
      documentParagraphs.sort((left, right) => left.index - right.index);
      const documentText = joinedParagraphText(documentParagraphs);
      let start = documentText.indexOf(context);
      while (start !== -1) {
        const paragraphs = paragraphSpanAt(documentParagraphs, start, start + context.length);
        const firstIndex = paragraphs[0].index;
        const lastIndex = paragraphs.at(-1)!.index;
        const window = documentParagraphs.filter((paragraph) =>
          paragraph.index >= firstIndex - 3 && paragraph.index <= lastIndex + 3
        );
        matches.push({ source: source.name, paragraphs, window });
        start = documentText.indexOf(context, start + 1);
      }
    }
  }
  return matches;
}

/** Finds one exact EPUB occurrence, including across adjacent paragraphs, and returns its window. */
export function findUniqueEPUBContext(
  corpus: EPUBSourceCorpus,
  contextHTML: string,
  sourceName?: string,
): EPUBContextMatch | null {
  const matches = findEPUBContexts(corpus, contextHTML, sourceName);
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
  const paragraphMatches = [...html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gisu)];
  if (
    paragraphMatches.length > 0 &&
    html.replace(/<p\b[^>]*>.*?<\/p>/gisu, "").trim() === ""
  ) {
    const paragraphs = paragraphMatches.map((match, index) => {
      const paragraphHTML = cleanEPUBHTML(match[1]);
      return {
        html: paragraphHTML,
        plainText: searchableEPUBText(paragraphHTML),
        document: "extracted-context",
        index,
      };
    });
    return extractEPUBHTMLFromParagraphs(paragraphs, plainText);
  }

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

/** Re-extracts source HTML while representing every crossed EPUB paragraph semantically. */
export function extractEPUBHTMLFromParagraphs(
  paragraphs: readonly EPUBParagraph[],
  plainText: string,
): string | null {
  const needle = searchableEPUBText(plainText);
  const haystack = joinedParagraphText(paragraphs);
  const start = haystack.indexOf(needle);
  if (!needle || start === -1 || start !== haystack.lastIndexOf(needle)) return null;
  const end = start + needle.length;

  const extracted: string[] = [];
  let offset = 0;
  for (const paragraph of paragraphs) {
    const paragraphEnd = offset + paragraph.plainText.length;
    if (paragraphEnd > start && offset < end) {
      const localStart = Math.max(0, start - offset);
      const localEnd = Math.min(paragraph.plainText.length, end - offset);
      const html = extractEPUBHTMLSubstring(
        paragraph.html,
        paragraph.plainText.slice(localStart, localEnd),
      );
      if (html === null) return null;
      extracted.push(html);
    }
    offset = paragraphEnd;
  }
  if (extracted.length === 0) return null;
  return extracted.length === 1
    ? extracted[0]
    : extracted.map((html) => `<p>${html}</p>`).join("\n\n");
}

/** Plain text covered by an EPUB context match, without synthetic paragraph separators. */
export function epubContextPlainText(match: EPUBContextMatch): string {
  return joinedParagraphText(match.paragraphs);
}

/**
 * Builds a compact source window for semantic decisions about a matched usage.
 *
 * The flashcard context may intentionally omit a preceding reply, speaker cue, or other detail
 * that disambiguates a dictionary sense. Include one neighboring paragraph on each side while
 * keeping this evidence separate from the context eventually rendered on the card.
 */
export function epubSenseSelectionContext(match: EPUBContextMatch): string {
  const firstIndex = match.paragraphs[0].index;
  const lastIndex = match.paragraphs.at(-1)!.index;
  return match.window
    .filter((paragraph) => paragraph.index >= firstIndex - 1 && paragraph.index <= lastIndex + 1)
    .map((paragraph) => paragraph.plainText)
    .join("\n\n");
}

export function EPUBBracketsAreBalanced(text: string): boolean {
  const pairs: Record<string, string> = {
    "「": "」",
    "『": "』",
    "〈": "〉",
    "《": "》",
    "（": "）",
    "【": "】",
  };
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

const JAPANESE_QUOTE_PAIRS: Readonly<Record<string, string>> = {
  "「": "」",
  "『": "』",
  "〈": "〉",
  "《": "》",
};
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
  const openAtStart = openQuotesAt(paragraph, start);
  const openAtEnd = openQuotesAt(paragraph, end);
  if (
    openAtStart === null || openAtStart.length > 0 ||
    openAtEnd === null || openAtEnd.length > 0
  ) {
    return false;
  }
  const leftComplete = start === 0 ||
    /[。！？!?」』〉》「『〈《]/u.test(paragraph[start - 1]) ||
    /^[「『〈《]/u.test(excerpt);
  const rightComplete = end === paragraph.length ||
    /[。！？!?」』〉》]/u.test(excerpt.at(-1) ?? "");
  return leftComplete && rightComplete && EPUBBracketsAreBalanced(excerpt);
}

/** Expands an excerpt to its containing source sentence without model judgment. */
export function expandEPUBContextToSentence(
  paragraphs: readonly EPUBParagraph[],
  contextHTML: string,
): string | null {
  const excerpt = searchableEPUBText(contextHTML);
  const passageText = joinedParagraphText(paragraphs);
  const start = passageText.indexOf(excerpt);
  if (start === -1 || start !== passageText.lastIndexOf(excerpt)) return null;
  const originalEnd = start + excerpt.length;

  let sentenceStart = 0;
  for (let index = start - 1; index >= 0; --index) {
    if (/[。！？!?」』〉》「『〈《]/u.test(passageText[index])) {
      sentenceStart = index + 1;
      break;
    }
  }
  let sentenceEnd = passageText.length;
  for (let index = originalEnd; index < passageText.length; ++index) {
    if (/[。！？!?]/u.test(passageText[index])) {
      sentenceEnd = index + 1;
      break;
    }
  }
  const expanded = passageText.slice(sentenceStart, sentenceEnd);
  if (expanded.length <= excerpt.length || !EPUBBracketsAreBalanced(expanded)) return null;
  return extractEPUBHTMLFromParagraphs(paragraphs, expanded);
}

function sentenceStart(text: string, index: number): number {
  for (let cursor = index - 1; cursor >= 0; --cursor) {
    if (/[。！？!?]/u.test(text[cursor])) return cursor + 1;
  }
  return 0;
}

function sentenceEnd(text: string, index: number): number {
  for (let cursor = index; cursor < text.length; ++cursor) {
    if (/[。！？!?]/u.test(text[cursor])) return cursor + 1;
  }
  return text.length;
}

const MAX_TARGET_EXPANSION_ADDED_CHARACTERS = 200;

/**
 * Expands an Animecards excerpt just far enough to include a uniquely located target in the same
 * EPUB paragraph. This repairs excerpts that stop before the mined word or accidentally retain the
 * preceding sentence, while keeping the result contiguous and source-faithful. If the excerpt is
 * implausibly far from the mined word, the word's complete source sentence is more useful than
 * hundreds of characters of intervening text.
 */
export function expandEPUBContextToIncludeTarget(
  paragraphs: readonly EPUBParagraph[],
  contextHTML: string,
  targetSurface: string,
): string | null {
  const passageText = joinedParagraphText(paragraphs);
  const excerpt = searchableEPUBText(contextHTML);
  const excerptStart = passageText.indexOf(excerpt);
  const targetStart = passageText.indexOf(targetSurface);
  if (
    excerptStart === -1 || excerptStart !== passageText.lastIndexOf(excerpt) ||
    targetStart === -1 || targetStart !== passageText.lastIndexOf(targetSurface)
  ) {
    return null;
  }

  const excerptEnd = excerptStart + excerpt.length;
  const targetEnd = targetStart + targetSurface.length;
  const start = sentenceStart(passageText, Math.min(excerptStart, targetStart));
  const end = sentenceEnd(passageText, Math.max(excerptEnd, targetEnd));
  const expanded = passageText.slice(start, end);
  if (!expanded.includes(excerpt) || !expanded.includes(targetSurface)) return null;
  if (expanded.length - excerpt.length > MAX_TARGET_EXPANSION_ADDED_CHARACTERS) {
    const targetSentence = passageText.slice(
      sentenceStart(passageText, targetStart),
      sentenceEnd(passageText, targetEnd),
    );
    return extractEPUBHTMLFromParagraphs(paragraphs, targetSentence);
  }
  return extractEPUBHTMLFromParagraphs(paragraphs, expanded);
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
  paragraphs: readonly EPUBParagraph[],
  contextHTML: string,
): string | null {
  const passageText = joinedParagraphText(paragraphs);
  const excerpt = searchableEPUBText(contextHTML);
  const start = passageText.indexOf(excerpt);
  if (start === -1 || start !== passageText.lastIndexOf(excerpt)) return null;
  const remainder = passageText.slice(start + excerpt.length);
  if (!/^[」』〉》]+$/u.test(remainder) || !EPUBBracketsAreBalanced(passageText)) return null;
  return extractEPUBHTMLFromParagraphs(paragraphs, passageText);
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
  const matches = findEPUBContexts(corpus, contextHTML, sourceName);
  if (matches.length === 0) return { status: "not-found" };
  const excerpt = searchableEPUBText(contextHTML);
  const analyses = matches.map((match): Exclude<EPUBContextAnalysis, { status: "not-found" }> => {
    if (!hasCompleteContextBoundaries(epubContextPlainText(match), excerpt)) {
      return { status: "cut-off", match };
    }
    const restored = extractEPUBHTMLFromParagraphs(match.paragraphs, excerpt);
    return restored === null
      ? { status: "cut-off", match }
      : { status: "complete", match, contextHTML: restored };
  });

  if (analyses.length === 1) return analyses[0];

  // The historical source location is immaterial when every occurrence is already complete and
  // produces identical cleaned, ruby-preserving HTML. Never choose between distinct expansions.
  if (analyses.every((analysis) => analysis.status === "complete")) {
    const [first, ...rest] = analyses;
    if (
      first.status === "complete" &&
      rest.every((analysis) =>
        analysis.status === "complete" && analysis.contextHTML === first.contextHTML
      )
    ) {
      return first;
    }
  }
  return { status: "not-found" };
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
