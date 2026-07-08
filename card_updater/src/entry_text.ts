/**
 * Text-level understanding of rendered dictionary-entry HTML (the `Dictionary entry` card
 * field): parsing into forms/senses, encoding-insensitive normalization, word-level diffing,
 * and alignment of old senses to new ones.
 *
 * Parsing works on the semantic HTML produced by `jmdict_to_html`'s `renderEntry`, both current
 * output and the older variants stored on existing cards (which may differ in entity encoding).
 */

export interface ParsedSense {
  /** 1-indexed position within the entry. */
  number: number;
  /** Full normalized text of the sense, with `; ` between glosses and ` · ` between blocks. */
  text: string;
  glosses: string[];
}

export interface ParsedEntry {
  kanjiForms: string[];
  kanaForms: string[];
  /** Normalized text of entry-level (shared) lists other than forms and senses. */
  sharedText: string;
  senses: ParsedSense[];
}

export type DiffSegmentType = "same" | "ins" | "del";

export interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

export interface SensePair {
  old: ParsedSense;
  new: ParsedSense;
  /** True when the texts differ (beyond encoding/whitespace). */
  changed: boolean;
}

export interface SenseAlignment {
  pairs: SensePair[];
  addedSenses: ParsedSense[];
  removedSenses: ParsedSense[];
}

/* ---------- normalization ---------- */

export function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_match, codePoint) => String.fromCodePoint(parseInt(codePoint, 16)),
    )
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(parseInt(codePoint, 10)))
    .replace(/&amp;/g, "&");
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Strips tags and returns normalized, entity-decoded text content. */
export function textContent(html: string): string {
  return normalizeText(decodeHTMLEntities(html.replace(/<[^>]+>/g, " ")).replace(/ /g, " "));
}

/**
 * Canonicalizes entry HTML so that comparisons ignore entity encoding and whitespace layout.
 * Two entries with equal canonical forms display identically.
 */
export function canonicalEntryHTML(html: string): string {
  return normalizeText(decodeHTMLEntities(html.replace(/\r\n?/g, "\n")));
}

/* ---------- rendered-entry parsing ---------- */

export function parseRenderedEntry(html: string): ParsedEntry {
  const kanjiForms = extractForms(html, "kanji");
  const kanaForms = extractForms(html, "kana");
  const senses = extractSenses(html);
  const sharedText = extractSharedText(html);

  return { kanjiForms, kanaForms, sharedText, senses };
}

function extractForms(html: string, kind: "kanji" | "kana"): string[] {
  const section = extractElementInner(html, "ul", `forms ${kind}`);
  if (section === null) {
    return [];
  }

  const forms: string[] = [];
  for (const match of section.matchAll(/<span\s+lang="ja">([\s\S]*?)<\/span>/gi)) {
    const text = textContent(match[1]);
    if (text && !forms.includes(text)) {
      forms.push(text);
    }
  }
  return forms;
}

function extractSenses(html: string): ParsedSense[] {
  const sensesSection = extractElementInner(html, "ol", "senses");
  if (sensesSection === null) {
    return [];
  }

  return extractTopLevelBlocks(sensesSection, "li").map((block, index) => {
    const inner = block.replace(/^<li\b[^>]*>/i, "").replace(/<\/li>$/i, "");
    const glossesSection = extractElementInner(inner, "ul", "glosses");
    const glosses = glossesSection === null ? [] : extractTopLevelBlocks(glossesSection, "li")
      .map((glossBlock) => textContent(glossBlock))
      .filter(Boolean);

    // Build the sense text from its blocks in order, so glosses get `; ` separators and other
    // blocks (part-of-speech, misc, info, ...) stay distinguishable.
    const parts: string[] = [];
    let lastIndex = 0;
    for (const [blockStart, blockEnd, blockHTML] of topLevelBlockRanges(inner)) {
      const between = textContent(inner.slice(lastIndex, blockStart));
      if (between) {
        parts.push(between);
      }
      const isGlosses = /^<ul\b[^>]*\bclass\s*=\s*(["'])(?:[^"']*\s)?glosses(?:\s[^"']*)?\1/i
        .test(blockHTML);
      if (isGlosses) {
        parts.push(glosses.join("; "));
      } else {
        const text = textContent(blockHTML);
        if (text) {
          parts.push(text);
        }
      }
      lastIndex = blockEnd;
    }
    const trailing = textContent(inner.slice(lastIndex));
    if (trailing) {
      parts.push(trailing);
    }

    return {
      number: index + 1,
      text: parts.filter(Boolean).join(" · ") || textContent(inner),
      glosses,
    };
  });
}

function extractSharedText(html: string): string {
  const parts: string[] = [];
  for (const [, , blockHTML] of topLevelBlockRanges(html)) {
    if (/^<(ul|ol)\b/i.test(blockHTML)) {
      const classMatch = blockHTML.match(/^<(?:ul|ol)\b[^>]*\bclass\s*=\s*(["'])(.*?)\1/i);
      const classes = classMatch ? classMatch[2].split(/\s+/) : [];
      if (classes.includes("forms") || classes.includes("senses")) {
        continue;
      }
      const text = textContent(blockHTML);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join(" · ");
}

/** Returns the inner HTML of the first `tagName` element bearing all the given classes. */
function extractElementInner(html: string, tagName: string, className: string): string | null {
  const startTagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  let startMatch: RegExpExecArray | null;

  while ((startMatch = startTagPattern.exec(html)) !== null) {
    if (!startTagHasClasses(startMatch[0], className)) {
      continue;
    }

    const innerStart = startTagPattern.lastIndex;
    const endIndex = findElementCloseIndex(html, tagName, innerStart);
    return endIndex === null ? null : html.slice(innerStart, endIndex);
  }

  return null;
}

function startTagHasClasses(startTag: string, className: string): boolean {
  const classMatch = startTag.match(/\bclass\s*=\s*(["'])(.*?)\1/i);
  if (!classMatch) {
    return false;
  }

  const actual = new Set(classMatch[2].split(/\s+/).filter(Boolean));
  return className.split(/\s+/).every((classPart) => actual.has(classPart));
}

function findElementCloseIndex(html: string, tagName: string, innerStart: number): number | null {
  const tagPattern = new RegExp(`</?${tagName}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = innerStart;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    if (match[0].startsWith("</")) {
      --depth;
      if (depth === 0) {
        return match.index;
      }
    } else if (!match[0].endsWith("/>")) {
      ++depth;
    }
  }

  return null;
}

/** Returns the outer HTML of each top-level `tagName` element in the fragment. */
function extractTopLevelBlocks(html: string, tagName: string): string[] {
  const startPattern = new RegExp(`^<${tagName}\\b`, "i");
  return topLevelBlockRanges(html)
    .map(([, , blockHTML]) => blockHTML)
    .filter((blockHTML) => startPattern.test(blockHTML));
}

/** Yields `[start, end, blockHTML]` for each top-level element block in the fragment. */
function topLevelBlockRanges(html: string): Array<[number, number, string]> {
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  const blocks: Array<[number, number, string]> = [];
  const stack: string[] = [];
  let blockStart = -1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    if (VOID_ELEMENTS.has(tagName) || match[0].endsWith("/>")) {
      continue;
    }
    if (match[0].startsWith("</")) {
      if (stack.length > 0 && stack.at(-1) === tagName) {
        stack.pop();
        if (stack.length === 0 && blockStart !== -1) {
          blocks.push([
            blockStart,
            tagPattern.lastIndex,
            html.slice(blockStart, tagPattern.lastIndex),
          ]);
          blockStart = -1;
        }
      }
    } else {
      if (stack.length === 0) {
        blockStart = match.index;
      }
      stack.push(tagName);
    }
  }

  return blocks;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/* ---------- word-level diff ---------- */

/** Splits into CJK characters, words, punctuation/symbol characters, and whitespace runs. */
export function tokenize(text: string): string[] {
  return text.match(
    /[　-鿿豈-﫿ｦ-ﾟ]|[^\s　-鿿豈-﫿ｦ-ﾟ\p{P}\p{S}]+|[\p{P}\p{S}]|\s+/gu,
  ) ?? [];
}

export function diffSegments(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; --i) {
    for (let j = m - 1; j >= 0; --j) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (type: DiffSegmentType, text: string) => {
    if (!text) {
      return;
    }
    const last = segments.at(-1);
    if (last && last.type === type) {
      last.text += text;
    } else {
      segments.push({ type, text });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      ++i;
      ++j;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i]);
      ++i;
    } else {
      push("ins", b[j]);
      ++j;
    }
  }
  while (i < n) {
    push("del", a[i]);
    ++i;
  }
  while (j < m) {
    push("ins", b[j]);
    ++j;
  }

  return segments;
}

/** Dice coefficient over token sets; 0 (disjoint) to 1 (identical). */
export function similarity(a: string, b: string): number {
  const setA = new Set(tokenize(a).filter((token) => token.trim()));
  const setB = new Set(tokenize(b).filter((token) => token.trim()));
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }

  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      ++overlap;
    }
  }
  return (2 * overlap) / (setA.size + setB.size);
}

/* ---------- sense alignment ---------- */

const FUZZY_MATCH_THRESHOLD = 0.4;

/**
 * Aligns old senses to new senses: exact text matches first (preferring the same position),
 * then best-first fuzzy pairing, leaving the rest as added/removed.
 */
export function alignSenses(oldSenses: ParsedSense[], newSenses: ParsedSense[]): SenseAlignment {
  const pairs: SensePair[] = [];
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();

  for (const oldSense of oldSenses) {
    const samePosition = newSenses[oldSense.number - 1];
    const exact = samePosition !== undefined && !usedNew.has(samePosition.number) &&
        samePosition.text === oldSense.text
      ? samePosition
      : newSenses.find(
        (candidate) => !usedNew.has(candidate.number) && candidate.text === oldSense.text,
      );
    if (exact) {
      usedOld.add(oldSense.number);
      usedNew.add(exact.number);
      pairs.push({ old: oldSense, new: exact, changed: false });
    }
  }

  const candidates: Array<{ oldSense: ParsedSense; newSense: ParsedSense; score: number }> = [];
  for (const oldSense of oldSenses) {
    if (usedOld.has(oldSense.number)) {
      continue;
    }
    for (const newSense of newSenses) {
      if (usedNew.has(newSense.number)) {
        continue;
      }
      const score = similarity(oldSense.text, newSense.text);
      if (score >= FUZZY_MATCH_THRESHOLD) {
        candidates.push({ oldSense, newSense, score });
      }
    }
  }
  candidates.sort((a, b) =>
    b.score - a.score || Math.abs(a.oldSense.number - a.newSense.number) -
      Math.abs(b.oldSense.number - b.newSense.number)
  );
  for (const { oldSense, newSense } of candidates) {
    if (usedOld.has(oldSense.number) || usedNew.has(newSense.number)) {
      continue;
    }
    usedOld.add(oldSense.number);
    usedNew.add(newSense.number);
    pairs.push({ old: oldSense, new: newSense, changed: true });
  }

  pairs.sort((a, b) => a.old.number - b.old.number);

  return {
    pairs,
    addedSenses: newSenses.filter((sense) => !usedNew.has(sense.number)),
    removedSenses: oldSenses.filter((sense) => !usedOld.has(sense.number)),
  };
}
