import { assertEquals } from "@std/assert";
import {
  analyzeEPUBContext,
  cleanSourceName,
  elideLongQuotedEPUBContext,
  expandEPUBContextToBalancedParagraphEnd,
  extractEPUBHTMLSubstring,
  extractSourceURL,
  findUniqueEPUBContext,
  findUniqueEPUBSource,
  formatRelevantQuotedEPUBContext,
  formatResolvedSourceHTML,
  isPublicSourceURL,
  quotedEPUBContextNeedsRelevanceSelection,
  resolveSource,
} from "./source.ts";

Deno.test("source cleanup removes known reader suffixes", () => {
  assertEquals(cleanSourceName("舟を編む | Miwake Reader"), "舟を編む");
  assertEquals(cleanSourceName("Test Book | ッツ Ebook Reader"), "Test Book");
  assertEquals(
    cleanSourceName("虐殺器官 (ハヤカワ文庫JA) | Miwake Reader"),
    "虐殺器官",
  );
});

Deno.test("source URL extraction decodes Anki HTML", () => {
  assertEquals(
    extractSourceURL('<a href="https://reader.miwake.app/b?id&#x3D;15">book</a>'),
    "https://reader.miwake.app/b?id=15",
  );
  assertEquals(extractSourceURL("not a URL"), null);
});

Deno.test("public source URL classification is conservative", () => {
  assertEquals(isPublicSourceURL("https://www3.nhk.or.jp/news/article"), true);
  assertEquals(isPublicSourceURL("https://reader.miwake.app/b?id=15"), false);
  assertEquals(isPublicSourceURL("https://example.com/file?token=secret"), false);
});

Deno.test("Animecards sources use Miwake Source markup", () => {
  assertEquals(
    formatResolvedSourceHTML({
      name: "舟を編む",
      method: "source-field",
      url: "https://reader.miwake.app/b?id=15",
      urlIsPublic: false,
    }),
    '<span lang="ja">『舟を編む』</span>',
  );
  assertEquals(
    formatResolvedSourceHTML({
      name: "NHKニュース",
      method: "source-field",
      url: "https://www3.nhk.or.jp/news/article?a=1&b=2",
      urlIsPublic: true,
    }),
    '<a lang="ja" href="https://www3.nhk.or.jp/news/article?a=1&amp;b=2">「NHKニュース」</a>',
  );
  assertEquals(
    formatResolvedSourceHTML({
      name: "News & Notes",
      method: "source-field",
      url: "https://example.com/article?a=1&b=2",
      urlIsPublic: true,
    }),
    '<a lang="en" href="https://example.com/article?a=1&amp;b=2">News &amp; Notes</a>',
  );
  assertEquals(
    formatResolvedSourceHTML({
      name: null,
      method: "none",
      url: null,
      urlIsPublic: false,
    }),
    "",
  );
});

Deno.test("EPUB source lookup requires a unique containing book", () => {
  const corpus = {
    sources: [
      { name: "Book A", documents: ["前文これは固有の文章です。後文"] },
      { name: "Book B", documents: ["別の文章です。"] },
    ],
  };
  assertEquals(findUniqueEPUBSource(corpus, "これは固有の文章です。"), "Book A");
  corpus.sources[1].documents.push("これは固有の文章です。");
  assertEquals(findUniqueEPUBSource(corpus, "これは固有の文章です。"), null);
});

Deno.test("EPUB context lookup returns ruby HTML and a same-document window", () => {
  const paragraphs = [
    { html: "前段。", plainText: "前段。", document: "chapter.xhtml", index: 0 },
    {
      html: "完全な<ruby>文<rt>ぶん</rt></ruby>です。",
      plainText: "完全な文です。",
      document: "chapter.xhtml",
      index: 1,
    },
    { html: "後段。", plainText: "後段。", document: "chapter.xhtml", index: 2 },
  ];
  const match = findUniqueEPUBContext(
    {
      sources: [{ name: "Book", documents: ["前段。完全な文です。後段。"], paragraphs }],
    },
    "文です",
    "Book",
  );

  assertEquals(match?.paragraph.html, "完全な<ruby>文<rt>ぶん</rt></ruby>です。");
  assertEquals(match?.window.length, 3);
});

Deno.test("EPUB substring extraction restores ruby without including neighboring text", () => {
  assertEquals(
    extractEPUBHTMLSubstring(
      "前は<ruby>潤<rt>うるお</rt></ruby>って、後ろ。",
      "潤って",
    ),
    "<ruby>潤<rt>うるお</rt></ruby>って",
  );
});

Deno.test("EPUB context analysis distinguishes complete excerpts from cutoffs", () => {
  const paragraph = {
    html: "前文。<ruby>完全<rt>かんぜん</rt></ruby>な文です。後文。",
    plainText: "前文。完全な文です。後文。",
    document: "chapter.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{ name: "Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
  };
  assertEquals(analyzeEPUBContext(corpus, "完全な文です。", "Book"), {
    status: "complete",
    match: { source: "Book", paragraph, window: [paragraph] },
    contextHTML: "<ruby>完全<rt>かんぜん</rt></ruby>な文です。",
  });
  assertEquals(analyzeEPUBContext(corpus, "完全な文", "Book").status, "cut-off");
});

Deno.test("EPUB context expansion can recover a balanced quote-final paragraph", () => {
  const paragraph = {
    html: "「前の文。<ruby>最後<rt>さいご</rt></ruby>の文」<br>",
    plainText: "「前の文。最後の文」",
    document: "chapter.xhtml",
    index: 0,
  };
  assertEquals(
    expandEPUBContextToBalancedParagraphEnd(paragraph, "最後の文"),
    "「前の文。<ruby>最後<rt>さいご</rt></ruby>の文」",
  );
  assertEquals(
    expandEPUBContextToBalancedParagraphEnd(paragraph, "前の文"),
    null,
  );
});

Deno.test("long quoted context elides distant dialogue and preserves source ruby", () => {
  const restored = `「前の長い文。さらに長い文。<ruby>最後<rt>さいご</rt></ruby>の文」`;
  assertEquals(
    elideLongQuotedEPUBContext(restored, "最後の文", 8),
    `「……<ruby>最後<rt>さいご</rt></ruby>の文」`,
  );
});

Deno.test("long quoted context marks omissions on both sides", () => {
  const restored = "「前の長い文。対象の文。後ろの長い文。」";
  assertEquals(
    elideLongQuotedEPUBContext(restored, "対象の文。", 8),
    "「……対象の文。……」",
  );
});

Deno.test("long quoted context does not repeat an existing trailing ellipsis", () => {
  const restored = "「前の長い文。対象の文……。後ろの長い文。」";
  assertEquals(
    elideLongQuotedEPUBContext(restored, "対象の文……。", 8),
    "「……対象の文……。」",
  );
});

Deno.test("long quoted context does not manufacture a balanced sentence fragment", () => {
  const restored = `「${"前".repeat(20)}対象${"後".repeat(20)}」`;
  assertEquals(elideLongQuotedEPUBContext(restored, "対象", 8), restored);
});

Deno.test("long multi-sentence quotations request relevance selection", () => {
  const restored = `「${"関係のない文。".repeat(15)}対象の文。」`;
  assertEquals(quotedEPUBContextNeedsRelevanceSelection(restored, "対象の文"), true);
  assertEquals(quotedEPUBContextNeedsRelevanceSelection("「前文。対象の文。」", "対象の文"), false);
});

Deno.test("relevant quoted context keeps adjacent brackets and elides omitted dialogue", () => {
  const restored =
    `「あいつらは<ruby>色目<rt>いろめ</rt></ruby>をつかって、僕とは目を合わせない。大体、縄文時代から女はそうなんだ。」`;
  assertEquals(
    formatRelevantQuotedEPUBContext(
      restored,
      `あいつらは<ruby>色目<rt>いろめ</rt></ruby>をつかって、僕とは目を合わせない。`,
      "色目をつかって、",
    ),
    `「あいつらは<ruby>色目<rt>いろめ</rt></ruby>をつかって、僕とは目を合わせない。……」`,
  );
});

Deno.test("relevant quoted context does not repeat an existing trailing ellipsis", () => {
  const restored = "「前文。対象の文……。後文。」";
  assertEquals(
    formatRelevantQuotedEPUBContext(restored, "対象の文……。", "対象の文"),
    "「……対象の文……。」",
  );
});

Deno.test("relevant quoted context rejects rewrites and sentence fragments", () => {
  const restored = "「前文。対象の文です。後文。」";
  assertEquals(
    formatRelevantQuotedEPUBContext(restored, "対象文です。", "対象の文"),
    null,
  );
  assertEquals(
    formatRelevantQuotedEPUBContext(restored, "対象の文", "対象の文"),
    null,
  );
});

Deno.test("explicit source fields take priority over EPUB recovery", () => {
  assertEquals(
    resolveSource("Explicit | Miwake Reader", "", "固有の文章", {
      sources: [{ name: "Book A", documents: ["固有の文章"] }],
    }),
    {
      name: "Explicit",
      method: "source-field",
      url: null,
      urlIsPublic: false,
    },
  );
});
