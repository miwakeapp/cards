import { assertEquals, assertThrows } from "@std/assert";
import {
  bunproBuildIdFromHTML,
  bunproGrammarPointFromPageProps,
  bunproGrammarPointURLsFromSitemap,
  stripBunproFurigana,
} from "../src/bunpro.ts";

Deno.test("stripBunproFurigana removes readings but retains ordinary parentheses", () => {
  assertEquals(
    stripBunproFurigana(
      "もう一（ひと）つ、２（に）型とＡ（エー）型の偽薬（プラセボ）を試（ため）す（たぶん）。",
    ),
    "もう一つ、２型とＡ型の偽薬を試す（たぶん）。",
  );
});

Deno.test("bunproBuildIdFromHTML reads the Next.js payload", () => {
  assertEquals(
    bunproBuildIdFromHTML(
      `<script id="__NEXT_DATA__" type="application/json">{"buildId":"build-123"}</script>`,
    ),
    "build-123",
  );
  assertThrows(() => bunproBuildIdFromHTML("<html></html>"), Error, "__NEXT_DATA__");
});

Deno.test("bunproGrammarPointURLsFromSitemap extracts and deduplicates canonical URLs", () => {
  assertEquals(
    bunproGrammarPointURLsFromSitemap(`
      <urlset>
        <url><loc>https://bunpro.jp/grammar_points/てごらん</loc></url>
        <url><loc>https://bunpro.jp/grammar_points/てごらん</loc></url>
        <url><loc>https://bunpro.jp/reading_passages/lesson/1</loc></url>
      </urlset>
    `),
    ["https://bunpro.jp/grammar_points/てごらん"],
  );
});

Deno.test("bunproGrammarPointFromPageProps preserves formal and writeup cloze variants", () => {
  assertEquals(
    bunproGrammarPointFromPageProps(
      {
        reviewable: {
          id: 314,
          slug: "てごらん",
          title: "てごらん",
          level: "JLPT3",
        },
        included: {
          studyQuestions: [
            {
              id: 1151,
              content: "その景色（けしき）を____。",
              answer: "みてごらん",
              kanji_answer: "見（み）てごらん",
              sentence_order: 0,
              sentenceable_type: "GrammarPoint",
              translation: "(<strong>Try to</strong>) take a look.",
            },
            {
              id: 5600,
              // The payload occasionally contains decomposed kana. Corpus text is normalized to
              // NFC so downstream consumers see one stable representation.
              content: "<span data-gp-id='5'>これ</span>を____、もう一度（いちど）____。",
              answer: "ためしてごらん",
              // Bunpro uses an empty `kanji_answer` when this example has no distinct kanji form.
              kanji_answer: "",
              sentence_order: 1,
              sentenceable_type: "GrammarPoint",
              translation: "<strong>Try</strong> this again.",
            },
            {
              id: 180970,
              content: "この本（ほん）を読（よ）ん____。",
              answer: "でごらん",
              kanji_answer: "でごらん",
              sentence_order: 0,
              sentenceable_type: "Writeup",
              translation: "Try reading this book.",
            },
            {
              id: 180971,
              content: "見る（みる） is the dictionary form.",
              answer: "",
              kanji_answer: "",
              sentence_order: 1,
              sentenceable_type: "Writeup",
              translation: "An unclozed comparison.",
            },
            {
              id: 5601,
              content: "まず____。",
              answer: "みてごらん",
              kanji_answer: "みてごらん",
              sentence_order: 2,
              sentenceable_type: "GrammarPoint",
              translation: "Try it first.",
            },
            {
              id: 5602,
              content: "次に____。",
              answer: "みてごらん",
              kanji_answer: null,
              sentence_order: 3,
              sentenceable_type: "GrammarPoint",
              translation: "Try it next.",
            },
          ],
        },
      },
      "https://bunpro.jp/grammar_points/%E3%81%A6%E3%81%94%E3%82%89%E3%82%93",
    ),
    {
      id: 314,
      slug: "てごらん",
      title: "てごらん",
      jlptLevel: "N3",
      url: "https://bunpro.jp/grammar_points/%E3%81%A6%E3%81%94%E3%82%89%E3%82%93",
      examples: [
        {
          id: 1151,
          kind: "grammar-point",
          sentenceOrder: 0,
          answerSentence: {
            withFurigana: "その景色（けしき）をみてごらん。",
            text: "その景色をみてごらん。",
          },
          kanjiAnswerSentence: {
            withFurigana: "その景色（けしき）を見（み）てごらん。",
            text: "その景色を見てごらん。",
          },
          translation: "(Try to) take a look.",
        },
        {
          id: 5600,
          kind: "grammar-point",
          sentenceOrder: 1,
          answerSentence: {
            withFurigana: "これをためしてごらん、もう一度（いちど）ためしてごらん。",
            text: "これをためしてごらん、もう一度ためしてごらん。",
          },
          translation: "Try this again.",
        },
        {
          id: 5601,
          kind: "grammar-point",
          sentenceOrder: 2,
          answerSentence: {
            withFurigana: "まずみてごらん。",
            text: "まずみてごらん。",
          },
          translation: "Try it first.",
        },
        {
          id: 5602,
          kind: "grammar-point",
          sentenceOrder: 3,
          answerSentence: {
            withFurigana: "次にみてごらん。",
            text: "次にみてごらん。",
          },
          translation: "Try it next.",
        },
        {
          id: 180970,
          kind: "writeup",
          sentenceOrder: 0,
          answerSentence: {
            withFurigana: "この本（ほん）を読（よ）んでごらん。",
            text: "この本を読んでごらん。",
          },
          translation: "Try reading this book.",
        },
      ],
    },
  );
});

Deno.test("bunproGrammarPointFromPageProps rejects malformed GrammarPoint clozes", () => {
  assertThrows(
    () =>
      bunproGrammarPointFromPageProps(
        {
          reviewable: { id: 1, slug: "bad", title: "bad", level: "JLPT5" },
          included: {
            studyQuestions: [{
              id: 2,
              content: "No blank.",
              kanji_answer: "answer",
              sentence_order: 0,
              sentenceable_type: "GrammarPoint",
              translation: "Bad.",
            }],
          },
        },
        "https://bunpro.jp/grammar_points/bad",
      ),
    Error,
    "contains no cloze blanks",
  );
});
