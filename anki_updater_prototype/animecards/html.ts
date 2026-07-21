import { unescape } from "@std/html/entities";
import { toHiragana } from "japanese_text";

const PRESENTATIONAL_TAG_PATTERN = /<\/?(?:b|strong|i|em|u|span|font|mark)\b[^>]*>/giu;
const ALL_TAG_PATTERN = /<[^>]+>/gu;
const RUBY_READING_PATTERN = /<rt\b[^>]*>.*?<\/rt>/gisu;
const MEDIA_PATTERN = /\[sound:[^\]]+\]/giu;

function decodeHTML(text: string): string {
  return unescape(text).replace(/[\u00a0\u202f]/gu, " ");
}

/** Converts an Anki HTML field intended to be plain text into normalized text. */
export function normalizePlainText(html: string): string {
  return decodeHTML(
    html
      .replace(RUBY_READING_PATTERN, "")
      .replace(/<br\s*\/?>/giu, " ")
      .replace(ALL_TAG_PATTERN, " ")
      .replace(MEDIA_PATTERN, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Removes Animecards presentation markup while retaining ruby annotations and meaningful line
 * breaks for Miwake Cards' context processor.
 */
export function normalizeContextHTML(html: string): string {
  return html
    .replace(MEDIA_PATTERN, "")
    .replace(/<br\s*\/?>/giu, "<br>")
    .replace(PRESENTATIONAL_TAG_PATTERN, "")
    .replace(/[\u00a0\u202f]/gu, " ")
    .trim();
}

/** Returns searchable Japanese text without ruby readings or HTML markup. */
export function contextPlainText(contextHTML: string): string {
  return decodeHTML(
    contextHTML
      .replace(RUBY_READING_PATTERN, "")
      .replace(/<br\s*\/?>/giu, "")
      .replace(ALL_TAG_PATTERN, ""),
  ).replace(/\s+/gu, "").trim();
}

/** Extracts JMDict IDs from common Jitendex/Takoboto links embedded in a glossary field. */
export function extractJMDictIDs(glossaryHTML: string): string[] {
  const decoded = decodeHTML(glossaryHTML).replaceAll("%3D", "=").replaceAll("%26", "&");
  const ids = [
    ...decoded.matchAll(/(?:[?&](?:q|w)=|\b(?:jmdict|entry)[-_:=/])(\d{7})\b/giu),
  ].map((match) => match[1]);
  return [...new Set(ids)];
}

/** Produces plausible kana values from plain, ruby, or Anki-bracket reading fields. */
export function readingFieldCandidates(readingHTML: string): string[] {
  const candidates = new Set<string>();
  const plain = normalizePlainText(readingHTML);
  if (plain) {
    candidates.add(plain.replace(/\s+/gu, ""));
    // Anki uses spaces to delimit adjacent annotation bases. Parsing each token separately also
    // lets us recover malformed whole-word annotations such as `種つけ[たねつけ]`.
    const bracketReading = plain
      .split(/\s+/gu)
      .map((token) => token.replace(/([^\[\]]+)\[([^\]]+)\]/gv, "$2"))
      .join("");
    candidates.add(bracketReading);
  }

  const rubyReadings = [...readingHTML.matchAll(/<rt\b[^>]*>(.*?)<\/rt>/gisu)]
    .map((match) => normalizePlainText(match[1]))
    .join("");
  if (rubyReadings) {
    candidates.add(rubyReadings);
  }
  return [...candidates].filter(Boolean);
}

/** Separates the target spelling from bracketed Animecards readings or guidance. */
export function parseRecognitionTargetField(
  targetHTML: string,
): { text: string; hasHint: boolean } {
  const plain = normalizePlainText(targetHTML);
  const annotations = [...plain.matchAll(/\[([^\]]+)\]/gu)];
  const hasHint = annotations.some((match) =>
    !/^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/v.test(match[1].replace(/\s+/gu, ""))
  );
  const text = /[^\[\]]+\[[^\]]+\]/u.test(plain)
    ? plain.replace(/([^\[\]]+)\[[^\]]+\]/gu, "$1").replace(/\s+/gu, "")
    : plain;
  return { text, hasHint };
}

export function kanaScriptsMatch(left: string, right: string): boolean {
  return toHiragana(left) === toHiragana(right);
}
