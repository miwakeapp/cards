import { DOMParser } from "@b-fuze/deno-dom";

/** Reference page used to verify that logged-out Bunpro payloads still expose every example. */
export const BUNPRO_SAMPLE_GRAMMAR_POINT_URL =
  "https://bunpro.jp/grammar_points/%E3%81%A6%E3%81%94%E3%82%89%E3%82%93";
/** Public sitemap used to discover Bunpro grammar-point pages. */
export const BUNPRO_SITEMAP_URL = "https://bunpro.jp/sitemap.xml";

/** One example sentence extracted from a Bunpro grammar point. */
export interface BunproExample {
  /** Bunpro's stable study-question identifier. */
  id: number;
  /** Display order within the grammar point. */
  sentenceOrder: number;
  /** Complete Japanese sentence with Bunpro's `漢字（かんじ）` reading notation retained. */
  sentenceWithFurigana: string;
  /** Complete Japanese sentence with Bunpro's parenthesized readings removed. */
  sentence: string;
  /** Bunpro's English translation with presentation HTML removed. */
  translation: string;
}

/** One Bunpro grammar point and all of its logged-out grammar-point examples. */
export interface BunproGrammarPoint {
  /** Bunpro's stable grammar-point identifier. */
  id: number;
  /** Bunpro's URL slug. */
  slug: string;
  /** Japanese grammar-point label. */
  title: string;
  /** `N1` through `N5` when Bunpro associates the grammar point with a JLPT level. */
  jlptLevel?: string;
  /** Canonical public grammar-point URL. */
  url: string;
  /** Grammar-point example sentences in Bunpro's display order. */
  examples: BunproExample[];
}

/** Versioned generated artifact containing Bunpro's public grammar examples. */
export interface BunproExampleCorpus {
  /** Artifact schema version. */
  schemaVersion: 1;
  /** ISO timestamp at which the complete artifact was assembled. */
  fetchedAt: string;
  /** Next.js build identifier from which every page payload was read. */
  buildId: string;
  /** Discovery source for the included grammar points. */
  sourceURL: string;
  /** Grammar points sorted by Bunpro ID. */
  grammarPoints: BunproGrammarPoint[];
}

type JSONObject = Record<string, unknown>;

function object(value: unknown, description: string): JSONObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${description} must be an object`);
  }
  return value as JSONObject;
}

function string(value: unknown, description: string): string {
  if (typeof value !== "string") throw new TypeError(`${description} must be a string`);
  return value;
}

function number(value: unknown, description: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${description} must be an integer`);
  }
  return value;
}

function textFromHTML(html: string): string {
  const document = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  if (document === null) throw new Error("Bunpro sentence HTML could not be parsed");
  return document.body.textContent.replace(/\s+/gu, " ").trim().normalize("NFC");
}

/**
 * Removes Bunpro's reading annotations while retaining the exact Japanese sentence otherwise.
 *
 * Bunpro writes furigana as `景色（けしき）`, including inside cloze answers. Readings also annotate
 * numerals and Latin letters, such as `２（に）` and `Ａ（エー）`. Restricting removal to kana-only
 * parentheses after those base scripts avoids treating parentheticals after ordinary kana as ruby.
 */
export function stripBunproFurigana(text: string): string {
  return text.replace(
    /(?<=[\p{Script=Han}\p{Script=Latin}\p{Number}々〆ヶヵ])（[\p{Script=Hiragana}\p{Script=Katakana}ー]+）/gv,
    "",
  );
}

/** Extracts the Next.js build identifier needed for Bunpro's compact page-data endpoints. */
export function bunproBuildIdFromHTML(html: string): string {
  const match = html.match(
    /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/iu,
  );
  if (match === null) throw new Error("Bunpro page contains no __NEXT_DATA__ payload");
  const payload = object(JSON.parse(match[1]), "Bunpro __NEXT_DATA__");
  return string(payload.buildId, "Bunpro buildId");
}

/** Extracts every canonical grammar-point URL from Bunpro's public sitemap. */
export function bunproGrammarPointURLsFromSitemap(sitemap: string): string[] {
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/bunpro\.jp\/grammar_points\/[^<]+)<\/loc>/gu)]
    .map((match) => match[1].replaceAll("&amp;", "&"));
  if (urls.length === 0) throw new Error("Bunpro sitemap contains no grammar-point URLs");
  return [...new Set(urls)];
}

/** Parses the useful source and example-sentence fields from one Bunpro page-data payload. */
export function bunproGrammarPointFromPageProps(
  value: unknown,
  canonicalURL: string,
): BunproGrammarPoint {
  const pageProps = object(value, "Bunpro pageProps");
  const reviewable = object(pageProps.reviewable, "Bunpro reviewable");
  const included = object(pageProps.included, "Bunpro included data");
  if (!Array.isArray(included.studyQuestions)) {
    throw new TypeError("Bunpro included.studyQuestions must be an array");
  }

  const slug = string(reviewable.slug, "Bunpro grammar-point slug");
  const level = string(reviewable.level, "Bunpro grammar-point level");
  const jlptMatch = /^JLPT([1-5])$/u.exec(level);
  const examples = included.studyQuestions
    .map((rawQuestion, index) => {
      const question = object(rawQuestion, `Bunpro study question ${index}`);
      if (question.sentenceable_type !== "GrammarPoint") return undefined;

      const content = string(question.content, `Bunpro study question ${index} content`);
      const blankCount = content.match(/____/gu)?.length ?? 0;
      if (blankCount === 0) {
        throw new Error(
          `Bunpro GrammarPoint study question ${
            JSON.stringify(question.id)
          } contains no cloze blanks`,
        );
      }
      const answer = typeof question.kanji_answer === "string" && question.kanji_answer !== ""
        ? question.kanji_answer
        : string(question.answer, `Bunpro study question ${index} answer`);
      const sentenceWithFurigana = textFromHTML(content.replaceAll("____", answer));
      return {
        id: number(question.id, `Bunpro study question ${index} id`),
        sentenceOrder: number(
          question.sentence_order,
          `Bunpro study question ${index} sentence_order`,
        ),
        sentenceWithFurigana,
        sentence: stripBunproFurigana(sentenceWithFurigana),
        translation: textFromHTML(
          string(question.translation, `Bunpro study question ${index} translation`),
        ),
      };
    })
    .filter((example): example is BunproExample => example !== undefined)
    .toSorted((left, right) => left.sentenceOrder - right.sentenceOrder);

  return {
    id: number(reviewable.id, "Bunpro grammar-point id"),
    slug,
    title: string(reviewable.title, "Bunpro grammar-point title"),
    ...(jlptMatch === null ? {} : { jlptLevel: `N${jlptMatch[1]}` }),
    url: new URL(canonicalURL).href,
    examples,
  };
}
