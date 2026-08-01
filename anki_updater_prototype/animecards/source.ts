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
  /** Start of the matched Animecard excerpt in the concatenated plain text of `window`. */
  contextStart?: number;
}

const READER_SUFFIX_PATTERN = /\s*\|\s*(?:Miwake Reader|ッツ Ebook Reader)\s*$/iu;
const EDITION_SUFFIX_PATTERN = /\s*[（(]ハヤカワ文庫JA[）)]\s*$/u;
const PRIVATE_SOURCE_HOSTS = new Set([
  "reader.miwake.app",
  "reader.ttsu.app",
]);
const TEMPORARY_QUERY_PARAMETER_PATTERN = /^(?:auth|expires?|signature|token)$/iu;
const ANKI_RUBY_READING_PATTERN =
  /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヵヶ])\[[\p{Script=Hiragana}\p{Script=Katakana}ー・]+\]/gv;

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
  )
    // Animecards may serialize source ruby as Anki brackets. Match its printed base against the
    // EPUB base text; `extractEPUBHTMLSubstring()` later restores the authoritative `<ruby>`.
    .replace(ANKI_RUBY_READING_PATTERN, "")
    .replace(/\s+/gu, "")
    .trim();
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

function paragraphBoundaryOffsets(paragraphs: readonly EPUBParagraph[]): ReadonlySet<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const paragraph of paragraphs) {
    offset += paragraph.plainText.length;
    boundaries.add(offset);
  }
  return boundaries;
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

interface ParagraphOffset {
  paragraph: EPUBParagraph;
  start: number;
  end: number;
}

function paragraphOffsets(paragraphs: readonly EPUBParagraph[]): ParagraphOffset[] {
  const result: ParagraphOffset[] = [];
  let start = 0;
  for (const paragraph of paragraphs) {
    const end = start + paragraph.plainText.length;
    result.push({ paragraph, start, end });
    start = end;
  }
  return result;
}

const DIALOGUE_QUOTE_PAIRS: Readonly<Record<string, string>> = {
  "「": "」",
  "『": "』",
};

interface DialogueSpan {
  start: number;
  end: number;
}

/**
 * Finds the outer dialogue span(s) that an excerpt cuts into.
 *
 * A complete quotation already contained by the excerpt needs no expansion. If the excerpt starts
 * or ends inside one or more nested quotations, the returned union includes every affected outer
 * quotation.
 */
function dialogueExpansionSpan(
  text: string,
  excerptStart: number,
  excerptEnd: number,
): DialogueSpan | null {
  const stack: Array<{ character: string; index: number }> = [];
  const closingQuotes = new Set(Object.values(DIALOGUE_QUOTE_PAIRS));
  const pairs: DialogueSpan[] = [];
  for (let index = 0; index < text.length; ++index) {
    const character = text[index];
    if (DIALOGUE_QUOTE_PAIRS[character] !== undefined) {
      stack.push({ character, index });
    } else if (closingQuotes.has(character)) {
      const opening = stack.pop();
      if (
        opening === undefined ||
        DIALOGUE_QUOTE_PAIRS[opening.character] !== character
      ) {
        return null;
      }
      pairs.push({ start: opening.index, end: index + 1 });
    }
  }
  if (stack.length > 0) return null;

  const cutPairs = pairs.filter((pair) =>
    pair.start < excerptEnd &&
    pair.end > excerptStart &&
    !(pair.start >= excerptStart && pair.end <= excerptEnd)
  );
  if (cutPairs.length === 0) return null;
  return {
    start: Math.min(excerptStart, ...cutPairs.map((pair) => pair.start)),
    end: Math.max(excerptEnd, ...cutPairs.map((pair) => pair.end)),
  };
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
        const dialogueSpan = dialogueExpansionSpan(
          documentText,
          start,
          start + context.length,
        );
        const dialogueParagraphs = dialogueSpan === null
          ? []
          : paragraphSpanAt(documentParagraphs, dialogueSpan.start, dialogueSpan.end);
        const windowFirstIndex = Math.min(
          firstIndex - 3,
          dialogueParagraphs[0]?.index ?? firstIndex,
        );
        const windowLastIndex = Math.max(
          lastIndex + 3,
          dialogueParagraphs.at(-1)?.index ?? lastIndex,
        );
        const window = documentParagraphs.filter((paragraph) =>
          paragraph.index >= windowFirstIndex && paragraph.index <= windowLastIndex
        );
        const windowDocumentStart = documentParagraphs
          .filter((paragraph) => paragraph.index < window[0].index)
          .reduce((sum, paragraph) => sum + paragraph.plainText.length, 0);
        matches.push({
          source: source.name,
          paragraphs,
          window,
          contextStart: start - windowDocumentStart,
        });
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

function matchingTextStart(haystack: string, needle: string, startHint?: number): number {
  if (
    startHint !== undefined &&
    startHint >= 0 &&
    haystack.slice(startHint, startHint + needle.length) === needle
  ) {
    return startHint;
  }
  const start = haystack.indexOf(needle);
  return start !== -1 && start === haystack.lastIndexOf(needle) ? start : -1;
}

function matchingTextStartContaining(
  haystack: string,
  needle: string,
  positionHint?: number,
): number {
  if (positionHint === undefined) return matchingTextStart(haystack, needle);

  const containingStarts: number[] = [];
  let start = haystack.indexOf(needle);
  while (start !== -1) {
    if (start <= positionHint && positionHint < start + needle.length) {
      containingStarts.push(start);
    }
    start = haystack.indexOf(needle, start + 1);
  }
  return containingStarts.length === 1 ? containingStarts[0] : -1;
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
export function extractEPUBHTMLSubstring(
  html: string,
  plainText: string,
  startHint?: number,
): string | null {
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
    return extractEPUBHTMLFromParagraphs(paragraphs, plainText, startHint);
  }

  const needle = searchableEPUBText(plainText);
  if (!needle) return null;
  const tokens = tokenizeEPUBHTML(html);
  const haystack = tokens.map((token) => token.plainText).join("");
  const start = matchingTextStart(haystack, needle, startHint);
  if (start === -1) return null;
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
  startHint?: number,
): string | null {
  const needle = searchableEPUBText(plainText);
  const haystack = joinedParagraphText(paragraphs);
  const start = matchingTextStart(haystack, needle, startHint);
  if (!needle || start === -1) return null;
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
        localStart,
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

/**
 * Expands a source excerpt to include every outer piece of dialogue it cuts into.
 *
 * The result remains a contiguous source span, retains source ruby, and may cross EPUB paragraphs.
 * Complete quotations already contained in the excerpt do not cause expansion.
 */
export function expandEPUBContextToFullDialogue(
  match: EPUBContextMatch,
  contextHTML: string,
): string | null {
  return expandEPUBContextToFullDialogueResult(match, contextHTML)?.html ?? null;
}

interface ExpandedEPUBContext {
  html: string;
  elided: boolean;
}

const MAX_COMPLETE_DIALOGUE_PARAGRAPHS = 2;
const SHORT_DIALOGUE_PARAGRAPH_CHARACTERS = 40;

function prependContextHTML(html: string, prefix: string): string {
  return html.startsWith("<p>") ? html.replace("<p>", `<p>${prefix}`) : `${prefix}${html}`;
}

function appendContextHTML(html: string, suffix: string): string {
  const finalParagraphEnd = html.lastIndexOf("</p>");
  return finalParagraphEnd !== -1 && finalParagraphEnd === html.length - "</p>".length
    ? `${html.slice(0, finalParagraphEnd)}${suffix}</p>`
    : `${html}${suffix}`;
}

/**
 * Elides an unusually long cross-paragraph quotation around its target paragraph.
 *
 * A complete quotation of one or two paragraphs remains source-verbatim. Longer quotations keep
 * the target paragraph and, only when that paragraph is very short, one adjacent paragraph.
 * Synthetic Japanese ellipses make the omission explicit while retaining balanced outer quotes.
 */
function cappedDialogueContext(
  match: EPUBContextMatch,
  dialogueSpan: DialogueSpan,
  excerptStart: number,
  excerptEnd: number,
): ExpandedEPUBContext | null {
  const offsets = paragraphOffsets(match.window);
  const dialogueParagraphs = offsets.filter(({ start, end }) =>
    end > dialogueSpan.start && start < dialogueSpan.end
  );
  const fullDialogue = joinedParagraphText(match.window).slice(
    dialogueSpan.start,
    dialogueSpan.end,
  );
  const fullHTML = extractEPUBHTMLFromParagraphs(
    match.window,
    fullDialogue,
    dialogueSpan.start,
  );
  if (fullHTML === null) return null;
  if (dialogueParagraphs.length <= MAX_COMPLETE_DIALOGUE_PARAGRAPHS) {
    return { html: fullHTML, elided: false };
  }

  const targetParagraphs = offsets.filter(({ start, end }) =>
    end > excerptStart && start < excerptEnd
  );
  if (targetParagraphs.length === 0) return null;

  const selected = [...targetParagraphs];
  if (selected.length === 1) {
    const target = selected[0];
    const targetDialogueCharacters = Math.min(target.end, dialogueSpan.end) -
      Math.max(target.start, dialogueSpan.start);
    if (targetDialogueCharacters < SHORT_DIALOGUE_PARAGRAPH_CHARACTERS) {
      const targetIndex = dialogueParagraphs.indexOf(target);
      const adjacent = dialogueParagraphs[targetIndex - 1] ?? dialogueParagraphs[targetIndex + 1];
      if (adjacent !== undefined) selected.push(adjacent);
    }
  }
  selected.sort((left, right) => left.start - right.start);

  const selectedStart = Math.max(dialogueSpan.start, selected[0].start);
  const selectedEnd = Math.min(dialogueSpan.end, selected.at(-1)!.end);
  const selectedText = joinedParagraphText(match.window).slice(selectedStart, selectedEnd);
  let html = extractEPUBHTMLFromParagraphs(match.window, selectedText, selectedStart);
  if (html === null) return null;

  const passage = joinedParagraphText(match.window);
  const omittedBefore = selectedStart > dialogueSpan.start;
  const omittedAfter = selectedEnd < dialogueSpan.end;
  if (omittedBefore) html = prependContextHTML(html, `${passage[dialogueSpan.start]}……`);
  if (omittedAfter) html = appendContextHTML(html, `……${passage[dialogueSpan.end - 1]}`);

  // A selected paragraph can cut through a nested quotation. Preserve the complete source
  // dialogue in that rare case rather than manufacturing structurally invalid context.
  return EPUBBracketsAreBalanced(searchableEPUBText(html))
    ? { html, elided: omittedBefore || omittedAfter }
    : { html: fullHTML, elided: false };
}

function expandEPUBContextToFullDialogueResult(
  match: EPUBContextMatch,
  contextHTML: string,
  startHint = match.contextStart,
): ExpandedEPUBContext | null {
  const excerpt = searchableEPUBText(contextHTML);
  const passage = joinedParagraphText(match.window);
  const start = matchingTextStart(passage, excerpt, startHint);
  if (!excerpt || start === -1) return null;
  const span = dialogueExpansionSpan(passage, start, start + excerpt.length);
  if (span === null) return null;
  const expanded = passage.slice(span.start, span.end);
  if (!hasCompleteContextBoundaries(passage, expanded, new Set(), span.start)) return null;
  return cappedDialogueContext(match, span, start, start + excerpt.length);
}

/**
 * Restores source ruby for a complete excerpt, accepting an unchanged Animecards excerpt outside
 * dialogue and expanding any excerpt that cuts into `「…」` or `『…』`.
 */
function finalizeEPUBContextSelection(
  match: EPUBContextMatch,
  selectedContextHTML: string,
  originalContextHTML: string,
  containedPositionHint?: number,
): ExpandedEPUBContext | null {
  const selectedText = searchableEPUBText(selectedContextHTML);
  const originalText = searchableEPUBText(originalContextHTML);
  if (!selectedText.includes(originalText)) return null;

  const passage = joinedParagraphText(match.window);
  const selectedStart = matchingTextStartContaining(
    passage,
    selectedText,
    containedPositionHint,
  );
  if (selectedStart === -1) return null;
  const sourceHTML = extractEPUBHTMLFromParagraphs(match.window, selectedText, selectedStart);
  if (sourceHTML === null) return null;
  if (
    hasCompleteContextBoundaries(
      passage,
      selectedText,
      paragraphBoundaryOffsets(match.window),
      selectedStart,
    )
  ) {
    return { html: sourceHTML, elided: false };
  }
  return expandEPUBContextToFullDialogueResult(match, sourceHTML, selectedStart);
}

function requiredEPUBContextResult(
  match: EPUBContextMatch,
  contextHTML: string,
): ExpandedEPUBContext | null {
  const exact = finalizeEPUBContextSelection(
    match,
    contextHTML,
    contextHTML,
    match.contextStart,
  );
  if (exact !== null) return exact;

  const sentence = expandEPUBContextToSentence(match.window, contextHTML, match.contextStart);
  if (sentence !== null) {
    const finalized = finalizeEPUBContextSelection(
      match,
      sentence,
      contextHTML,
      match.contextStart,
    );
    if (finalized !== null) return finalized;
  }
  const paragraph = expandEPUBContextToBalancedParagraphEnd(
    match.window,
    contextHTML,
    match.contextStart,
  );
  return paragraph === null ? null : { html: paragraph, elided: false };
}

/**
 * Produces the smallest source-faithful span that a semantic context selection must retain.
 *
 * This restores ruby, completes a partial sentence when possible, and expands excerpts that cut
 * into dialogue. It deliberately does not decide whether the resulting span is understandable
 * without neighboring source text.
 */
export function requiredEPUBContext(
  match: EPUBContextMatch,
  contextHTML: string,
): string | null {
  return requiredEPUBContextResult(match, contextHTML)?.html ?? null;
}

/**
 * Validates an AI-selected context against its deterministic lower bound and the EPUB source.
 *
 * The selection must be a unique contiguous source span containing the required context. Any
 * dialogue it cuts into is expanded before the final natural-boundary checks.
 */
export function validateEPUBContextSelection(
  match: EPUBContextMatch,
  selectedContextHTML: string,
  requiredContextHTML: string,
): string | null {
  const finalizedResult = finalizeEPUBContextSelection(
    match,
    selectedContextHTML,
    requiredContextHTML,
    match.contextStart,
  );
  if (finalizedResult === null || finalizedResult.elided) return null;
  const finalized = finalizedResult.html;

  const passage = joinedParagraphText(match.window);
  const finalizedText = searchableEPUBText(finalized);
  const requiredText = searchableEPUBText(requiredContextHTML);
  return finalizedText.includes(requiredText) &&
      EPUBBracketsAreBalanced(finalizedText) &&
      hasCompleteContextBoundaries(
        passage,
        finalizedText,
        paragraphBoundaryOffsets(match.window),
        match.contextStart,
      )
    ? finalized
    : null;
}

/** True when an excerpt already starts and ends at natural source-context boundaries. */
export function hasCompleteContextBoundaries(
  paragraph: string,
  excerpt: string,
  additionalBoundaries: ReadonlySet<number> = new Set(),
  containedPositionHint?: number,
): boolean {
  const start = matchingTextStartContaining(paragraph, excerpt, containedPositionHint);
  if (start === -1) return false;
  const end = start + excerpt.length;
  const openAtStart = openQuotesAt(paragraph, start);
  const openAtEnd = openQuotesAt(paragraph, end);
  if (
    openAtStart === null || openAtStart.length > 0 ||
    openAtEnd === null || openAtEnd.length > 0
  ) {
    return false;
  }
  const leftComplete = start === 0 || additionalBoundaries.has(start) ||
    /[。！？!?」』〉》「『〈《]/u.test(paragraph[start - 1]) ||
    /^[「『〈《]/u.test(excerpt);
  const rightComplete = end === paragraph.length || additionalBoundaries.has(end) ||
    /[。！？!?」』〉》]/u.test(excerpt.at(-1) ?? "");
  return leftComplete && rightComplete && EPUBBracketsAreBalanced(excerpt);
}

/** Expands an excerpt to its containing source sentence without model judgment. */
export function expandEPUBContextToSentence(
  paragraphs: readonly EPUBParagraph[],
  contextHTML: string,
  startHint?: number,
): string | null {
  const excerpt = searchableEPUBText(contextHTML);
  const passageText = joinedParagraphText(paragraphs);
  const start = matchingTextStart(passageText, excerpt, startHint);
  if (start === -1) return null;
  const originalEnd = start + excerpt.length;

  let sentenceStart = 0;
  for (let index = start - 1; index >= 0; --index) {
    if (/[。！？!?]/u.test(passageText[index])) {
      sentenceStart = index + 1;
      break;
    }
  }
  let sentenceEnd = originalEnd;
  if (!/[。！？!?]/u.test(passageText[originalEnd - 1] ?? "")) {
    sentenceEnd = passageText.length;
    for (let index = originalEnd; index < passageText.length; ++index) {
      if (/[。！？!?]/u.test(passageText[index])) {
        sentenceEnd = index + 1;
        break;
      }
    }
  }
  const expanded = passageText.slice(sentenceStart, sentenceEnd);
  if (expanded.length <= excerpt.length) return null;
  return extractEPUBHTMLFromParagraphs(paragraphs, expanded, sentenceStart);
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
  startHint?: number,
): string | null {
  const passageText = joinedParagraphText(paragraphs);
  const excerpt = searchableEPUBText(contextHTML);
  const start = matchingTextStart(passageText, excerpt, startHint);
  if (start === -1) return null;
  const remainder = passageText.slice(start + excerpt.length);
  if (!/^[」』〉》]+$/u.test(remainder) || !EPUBBracketsAreBalanced(passageText)) return null;
  return extractEPUBHTMLFromParagraphs(paragraphs, passageText, 0);
}

type LocatedEPUBContextAnalysis =
  | {
    status: "complete";
    match: EPUBContextMatch;
    contextHTML: string;
    dialogueElided?: true;
  }
  | { status: "cut-off"; match: EPUBContextMatch };

export type EPUBContextAnalysis =
  | { status: "not-found" }
  | { status: "ambiguous" }
  | LocatedEPUBContextAnalysis;

/**
 * Finds an EPUB excerpt and derives the source-faithful span that later semantic selection must
 * retain.
 */
export function analyzeEPUBContext(
  corpus: EPUBSourceCorpus,
  contextHTML: string,
  sourceName?: string,
): EPUBContextAnalysis {
  const matches = findEPUBContexts(corpus, contextHTML, sourceName);
  if (matches.length === 0) return { status: "not-found" };
  const analyses = matches.map((match): LocatedEPUBContextAnalysis => {
    const restored = requiredEPUBContextResult(match, contextHTML);
    return restored === null ? { status: "cut-off", match } : {
      status: "complete",
      match,
      contextHTML: restored.html,
      ...(restored.elided ? { dialogueElided: true as const } : {}),
    };
  });

  if (analyses.length === 1) return analyses[0];

  // Repeated source text is safe when every occurrence restores to exactly the same complete HTML.
  // Its wider narrative surroundings remain unavailable as sense-selection evidence because
  // `findUniqueEPUBContext()` deliberately requires one historical location.
  if (analyses.every((analysis) => analysis.status === "complete")) {
    const [first, ...rest] = analyses;
    if (
      first.status === "complete" &&
      rest.every((analysis) =>
        analysis.status === "complete" &&
        analysis.contextHTML === first.contextHTML
      )
    ) {
      return first;
    }
  }
  return { status: "ambiguous" };
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
