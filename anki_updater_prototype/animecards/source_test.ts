import { assertEquals } from "@std/assert";
import {
  analyzeEPUBContext,
  cardSourceFromResolution,
  cleanSourceName,
  elideLongQuotedEPUBContext,
  expandEPUBContextToBalancedParagraphEnd,
  expandEPUBContextToIncludeTarget,
  extractEPUBHTMLSubstring,
  extractSourceURL,
  findUniqueEPUBContext,
  findUniqueEPUBSource,
  formatRelevantQuotedEPUBContext,
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

Deno.test("Animecards source resolutions include explicit card language and public URLs", () => {
  assertEquals(
    cardSourceFromResolution({
      name: "舟を編む",
      method: "source-field",
      url: "https://reader.miwake.app/b?id=15",
      urlIsPublic: false,
    }),
    { text: "『舟を編む』", lang: "ja" },
  );
  assertEquals(
    cardSourceFromResolution({
      name: "舟を編む",
      method: "source-field",
      url: "https://example.com/books/舟を編む",
      urlIsPublic: true,
    }),
    {
      text: "『舟を編む』",
      lang: "ja",
      url: "https://example.com/books/舟を編む",
    },
  );
  assertEquals(
    cardSourceFromResolution({
      name: "News & Notes",
      method: "source-field",
      url: "https://example.com/article?a=1&b=2",
      urlIsPublic: true,
    }),
    {
      text: "News & Notes",
      lang: "en",
      url: "https://example.com/article?a=1&b=2",
    },
  );
  assertEquals(
    cardSourceFromResolution({
      name: "Nineteen Eighty-Four",
      method: "epub",
      url: null,
      urlIsPublic: false,
    }),
    {
      text: "『Nineteen Eighty-Four』",
      lang: "ja",
    },
  );
  assertEquals(
    cardSourceFromResolution({
      name: "『舟を編む』",
      method: "source-field",
      url: null,
      urlIsPublic: false,
    }),
    {
      text: "『舟を編む』",
      lang: "ja",
    },
  );
  assertEquals(
    cardSourceFromResolution({
      name: null,
      method: "none",
      url: null,
      urlIsPublic: false,
    }),
    undefined,
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

  assertEquals(match?.paragraphs, [paragraphs[1]]);
  assertEquals(match?.window.length, 3);
});

Deno.test("EPUB context lookup and extraction span adjacent semantic paragraphs", () => {
  const paragraphs = [
    {
      html: "「婚活ですよ」",
      plainText: "「婚活ですよ」",
      document: "chapter.xhtml",
      index: 0,
    },
    {
      html: "と<ruby>事<rt>こと</rt></ruby>もなげに答えた。",
      plainText: "と事もなげに答えた。",
      document: "chapter.xhtml",
      index: 1,
    },
  ];
  const context = "「婚活ですよ」<br><br>と事もなげに答えた。";
  const match = findUniqueEPUBContext(
    {
      sources: [{ name: "Book", documents: ["「婚活ですよ」と事もなげに答えた。"], paragraphs }],
    },
    context,
    "Book",
  );

  assertEquals(match?.paragraphs, paragraphs);
  const analysis = analyzeEPUBContext(
    {
      sources: [{ name: "Book", documents: ["「婚活ですよ」と事もなげに答えた。"], paragraphs }],
    },
    context,
    "Book",
  );
  assertEquals(analysis.status, "complete");
  assertEquals(
    analysis.status === "complete" ? analysis.contextHTML : null,
    [
      "<p>「婚活ですよ」</p>",
      "",
      "<p>と<ruby>事<rt>こと</rt></ruby>もなげに答えた。</p>",
    ].join("\n"),
  );
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

Deno.test("EPUB substring extraction strips source paragraph attributes", () => {
  assertEquals(
    extractEPUBHTMLSubstring(
      '<p class="calibre">前の段落。</p><p class="calibre2" id="next">次の段落。</p>',
      "前の段落。次の段落。",
    ),
    "<p>前の段落。</p>\n\n<p>次の段落。</p>",
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
    match: { source: "Book", paragraphs: [paragraph], window: [paragraph] },
    contextHTML: "<ruby>完全<rt>かんぜん</rt></ruby>な文です。",
  });
  assertEquals(analyzeEPUBContext(corpus, "完全な文", "Book").status, "cut-off");
});

Deno.test("EPUB context analysis accepts repeated equivalent complete excerpts", () => {
  const first = {
    html: "<ruby>同一<rt>どういつ</rt></ruby>の文です。",
    plainText: "同一の文です。",
    document: "first.xhtml",
    index: 0,
  };
  const second = { ...first, document: "second.xhtml" };
  const corpus = {
    sources: [{
      name: "Book",
      documents: [first.plainText, second.plainText],
      paragraphs: [first, second],
    }],
  };

  assertEquals(analyzeEPUBContext(corpus, "同一の文です。", "Book"), {
    status: "complete",
    match: { source: "Book", paragraphs: [first], window: [first] },
    contextHTML: "<ruby>同一<rt>どういつ</rt></ruby>の文です。",
  });
});

Deno.test("EPUB context analysis rejects repeated excerpts with different source ruby", () => {
  const first = {
    html: "<ruby>同一<rt>どういつ</rt></ruby>の文です。",
    plainText: "同一の文です。",
    document: "first.xhtml",
    index: 0,
  };
  const second = {
    html: "<ruby>同一<rt>おなじ</rt></ruby>の文です。",
    plainText: "同一の文です。",
    document: "second.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{
      name: "Book",
      documents: [first.plainText, second.plainText],
      paragraphs: [first, second],
    }],
  };

  assertEquals(analyzeEPUBContext(corpus, "同一の文です。", "Book"), {
    status: "not-found",
  });
});

Deno.test("EPUB context analysis rejects a complete sentence inside a longer quotation", () => {
  const quoted = {
    html: "「前文。対象の文です。後文。」",
    plainText: "「前文。対象の文です。後文。」",
    document: "quoted.xhtml",
    index: 0,
  };
  const standalone = {
    html: "対象の文です。",
    plainText: "対象の文です。",
    document: "standalone.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{
      name: "Book",
      documents: [quoted.plainText, standalone.plainText],
      paragraphs: [quoted, standalone],
    }],
  };

  assertEquals(analyzeEPUBContext(corpus, "対象の文です。", "Book"), {
    status: "not-found",
  });
});

Deno.test("EPUB context analysis rejects an unclosed angle-bracket quotation", () => {
  const paragraph = {
    html: "〈前文です〉説明して、〈対象の文です。続きです〉",
    plainText: "〈前文です〉説明して、〈対象の文です。続きです〉",
    document: "chapter.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{ name: "Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
  };

  assertEquals(
    analyzeEPUBContext(corpus, "〈前文です〉説明して、〈対象の文です。", "Book").status,
    "cut-off",
  );
  assertEquals(
    analyzeEPUBContext(corpus, "〈対象の文です。続きです〉", "Book").status,
    "complete",
  );
});

Deno.test("EPUB context expansion includes a target after a truncated excerpt", () => {
  const paragraph = {
    html:
      "前文。だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか<ruby>見当<rt>けんとう</rt></ruby>もつかないが）使用されることは、お勧めしかねる。後文。",
    plainText:
      "前文。だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか見当もつかないが）使用されることは、お勧めしかねる。後文。",
    document: "chapter.xhtml",
    index: 0,
  };
  assertEquals(
    expandEPUBContextToIncludeTarget(
      [paragraph],
      "だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、",
      "見当もつかない",
    ),
    "だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか<ruby>見当<rt>けんとう</rt></ruby>もつかないが）使用されることは、お勧めしかねる。",
  );
});

Deno.test("EPUB context expansion includes an adjacent target sentence", () => {
  const paragraph = {
    html:
      "前文。その間、俺は文字通り一睡もしなかった。<ruby><rb>鉄</rb><rt>てつ</rt><rb>釘</rb><rt>くぎ</rt></ruby>を打たれるような頭痛に襲われた。後文。",
    plainText:
      "前文。その間、俺は文字通り一睡もしなかった。鉄釘を打たれるような頭痛に襲われた。後文。",
    document: "chapter.xhtml",
    index: 0,
  };
  assertEquals(
    expandEPUBContextToIncludeTarget(
      [paragraph],
      "その間、俺は文字通り一睡もしなかった。",
      "釘",
    ),
    "その間、俺は文字通り一睡もしなかった。<ruby><rb>鉄</rb><rt>てつ</rt><rb>釘</rb><rt>くぎ</rt></ruby>を打たれるような頭痛に襲われた。",
  );
});

Deno.test("EPUB context expansion omits a distant unrelated excerpt", () => {
  const interveningText = "関係のない文。".repeat(30);
  const paragraph = {
    html:
      `元の抜粋。${interveningText}その<ruby>生温<rt>なまあたた</rt></ruby>かさが身体に馴染んでいた。`,
    plainText: `元の抜粋。${interveningText}その生温かさが身体に馴染んでいた。`,
    document: "chapter.xhtml",
    index: 0,
  };

  assertEquals(
    expandEPUBContextToIncludeTarget([paragraph], "元の抜粋。", "生温かさ"),
    "その<ruby>生温<rt>なまあたた</rt></ruby>かさが身体に馴染んでいた。",
  );
});

Deno.test("EPUB context expansion can recover a balanced quote-final paragraph", () => {
  const paragraph = {
    html: "「前の文。<ruby>最後<rt>さいご</rt></ruby>の文」<br>",
    plainText: "「前の文。最後の文」",
    document: "chapter.xhtml",
    index: 0,
  };
  assertEquals(
    expandEPUBContextToBalancedParagraphEnd([paragraph], "最後の文"),
    "「前の文。<ruby>最後<rt>さいご</rt></ruby>の文」",
  );
  assertEquals(
    expandEPUBContextToBalancedParagraphEnd([paragraph], "前の文"),
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
