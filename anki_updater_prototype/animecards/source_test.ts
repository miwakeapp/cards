import { assertEquals } from "@std/assert";
import {
  analyzeEPUBContext,
  cardSourceFromResolution,
  cleanSourceName,
  epubSenseSelectionContext,
  expandEPUBContextToBalancedParagraphEnd,
  expandEPUBContextToFullDialogue,
  expandEPUBContextToIncludeTarget,
  expandEPUBContextToSentence,
  extractEPUBHTMLSubstring,
  extractSourceURL,
  findUniqueEPUBContext,
  findUniqueEPUBSource,
  isPublicSourceURL,
  requiredEPUBContext,
  resolveSource,
  validateEPUBContextSelection,
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
  assertEquals(
    match === null ? null : epubSenseSelectionContext(match),
    "前段。\n\n完全な文です。\n\n後段。",
  );
});

Deno.test("EPUB lookup ignores Anki-style readings and restores source ruby", () => {
  const paragraph = {
    html: "別れの<ruby>弾丸<rt>メール</rt></ruby>だ。",
    plainText: "別れの弾丸だ。",
    document: "chapter.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{ name: "Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
  };

  assertEquals(findUniqueEPUBSource(corpus, "別れの 弾丸[メール]だ。"), "Book");
  const analysis = analyzeEPUBContext(corpus, "別れの 弾丸[メール]だ。", "Book");
  assertEquals(analysis.status, "complete");
  assertEquals(
    analysis.status === "complete" ? analysis.contextHTML : null,
    "別れの<ruby>弾丸<rt>メール</rt></ruby>だ。",
  );
});

Deno.test("EPUB sense-selection context includes only the nearest neighboring paragraphs", () => {
  const paragraphs = [
    { html: "遠い前段。", plainText: "遠い前段。", document: "chapter.xhtml", index: 0 },
    { html: "直前。", plainText: "直前。", document: "chapter.xhtml", index: 1 },
    { html: "対象。", plainText: "対象。", document: "chapter.xhtml", index: 2 },
    { html: "直後。", plainText: "直後。", document: "chapter.xhtml", index: 3 },
    { html: "遠い後段。", plainText: "遠い後段。", document: "chapter.xhtml", index: 4 },
  ];

  assertEquals(
    epubSenseSelectionContext({
      source: "Book",
      paragraphs: [paragraphs[2]],
      window: paragraphs,
    }),
    "直前。\n\n対象。\n\n直後。",
  );
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

Deno.test("EPUB substring extraction can select one repeated occurrence by position", () => {
  const html = "<ruby>生<rt>なま</rt></ruby>もの、<ruby>生<rt>い</rt></ruby>もの";
  const secondStart = "生もの、".length;

  assertEquals(extractEPUBHTMLSubstring(html, "生もの"), null);
  assertEquals(
    extractEPUBHTMLSubstring(html, "生もの", secondStart),
    "<ruby>生<rt>い</rt></ruby>もの",
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

Deno.test("EPUB context analysis derives the required complete sentence", () => {
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
    match: { source: "Book", paragraphs: [paragraph], window: [paragraph], contextStart: 3 },
    contextHTML: "<ruby>完全<rt>かんぜん</rt></ruby>な文です。",
  });
  assertEquals(analyzeEPUBContext(corpus, "完全な文", "Book"), {
    status: "complete",
    match: { source: "Book", paragraphs: [paragraph], window: [paragraph], contextStart: 3 },
    contextHTML: "<ruby>完全<rt>かんぜん</rt></ruby>な文です。",
  });
});

Deno.test("EPUB context analysis locates repeated excerpts within one source sentence", () => {
  const paragraph = {
    html:
      "前文。男は<ruby>匂<rt>にお</rt></ruby>いをかぎ、それからもう一度匂いをかぎ、首をかしげた。後文。",
    plainText: "前文。男は匂いをかぎ、それからもう一度匂いをかぎ、首をかしげた。後文。",
    document: "chapter.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{ name: "Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
  };

  const analysis = analyzeEPUBContext(corpus, "匂いをかぎ", "Book");
  assertEquals(analysis.status, "complete");
  assertEquals(
    analysis.status === "complete" ? analysis.contextHTML : null,
    "男は<ruby>匂<rt>にお</rt></ruby>いをかぎ、それからもう一度匂いをかぎ、首をかしげた。",
  );
});

Deno.test("EPUB context analysis retains positions through identical sentence expansion", () => {
  const sentence = "男は匂いをかぎ、首をかしげた。";
  const paragraph = {
    html: `前文。${sentence}間の文。${sentence}後文。`,
    plainText: `前文。${sentence}間の文。${sentence}後文。`,
    document: "chapter.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{ name: "Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
  };

  const analysis = analyzeEPUBContext(corpus, "匂いをかぎ", "Book");
  assertEquals(analysis.status, "complete");
  assertEquals(
    analysis.status === "complete" ? analysis.contextHTML : null,
    sentence,
  );
  assertEquals(
    analysis.status === "complete"
      ? validateEPUBContextSelection(analysis.match, sentence, sentence)
      : null,
    sentence,
  );
});

Deno.test("EPUB context analysis expands a good sentence to its full dialogue", () => {
  const paragraph = {
    html:
      "「前文。<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。『さらに内側です』と続けます。」",
    plainText: "「前文。対象の文です。後文。『さらに内側です』と続けます。」",
    document: "quoted.xhtml",
    index: 0,
  };
  const corpus = {
    sources: [{ name: "Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
  };

  assertEquals(analyzeEPUBContext(corpus, "対象の文です。", "Book"), {
    status: "complete",
    match: { source: "Book", paragraphs: [paragraph], window: [paragraph], contextStart: 4 },
    contextHTML:
      "「前文。<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。『さらに内側です』と続けます。」",
  });
  assertEquals(analyzeEPUBContext(corpus, "さらに内側です", "Book"), {
    status: "complete",
    match: {
      source: "Book",
      paragraphs: [paragraph],
      window: [paragraph],
      contextStart: paragraph.plainText.indexOf("さらに内側です"),
    },
    contextHTML:
      "「前文。<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。『さらに内側です』と続けます。」",
  });
});

Deno.test("EPUB context selection accepts an unchanged standalone sentence", () => {
  const paragraph = {
    html: "前文。<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。",
    plainText: "前文。対象の文です。後文。",
    document: "standalone.xhtml",
    index: 0,
  };
  const match = { source: "Book", paragraphs: [paragraph], window: [paragraph] };

  assertEquals(
    requiredEPUBContext(match, "対象の文です。"),
    "<ruby>対象<rt>たいしょう</rt></ruby>の文です。",
  );
  assertEquals(validateEPUBContextSelection(match, "対象の文", "対象の文"), null);
});

Deno.test("required EPUB context is only a structural lower bound", () => {
  const paragraph = {
    html: "前文が指示対象を説明する。だから、<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。",
    plainText: "前文が指示対象を説明する。だから、対象の文です。後文。",
    document: "standalone.xhtml",
    index: 0,
  };
  const match = { source: "Book", paragraphs: [paragraph], window: [paragraph] };

  assertEquals(
    requiredEPUBContext(match, "対象の文です。"),
    "だから、<ruby>対象<rt>たいしょう</rt></ruby>の文です。",
  );
  assertEquals(
    validateEPUBContextSelection(
      match,
      "前文が指示対象を説明する。だから、対象の文です。",
      "だから、<ruby>対象<rt>たいしょう</rt></ruby>の文です。",
    ),
    "前文が指示対象を説明する。だから、<ruby>対象<rt>たいしょう</rt></ruby>の文です。",
  );
});

Deno.test("EPUB context validation enforces the required span", () => {
  const paragraph = {
    html: "前文。「<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。」さらに別の文。",
    plainText: "前文。「対象の文です。後文。」さらに別の文。",
    document: "quoted.xhtml",
    index: 0,
  };
  const match = { source: "Book", paragraphs: [paragraph], window: [paragraph] };
  const required = "「<ruby>対象<rt>たいしょう</rt></ruby>の文です。後文。」";

  assertEquals(
    validateEPUBContextSelection(match, "対象の文です。", required),
    null,
  );
  assertEquals(
    validateEPUBContextSelection(match, "「対象の文です。後文。」", required),
    required,
  );
  assertEquals(
    validateEPUBContextSelection(match, "対象の文です。後文。」さらに別の文。", required),
    null,
  );
});

Deno.test("EPUB context validation treats paragraph edges as natural boundaries", () => {
  const heading = {
    html: "１",
    plainText: "１",
    document: "chapter.xhtml",
    index: 0,
  };
  const sentence = {
    html: "<ruby>対象<rt>たいしょう</rt></ruby>の文です。",
    plainText: "対象の文です。",
    document: "chapter.xhtml",
    index: 1,
  };
  const following = {
    html: "続く段落",
    plainText: "続く段落",
    document: "chapter.xhtml",
    index: 2,
  };
  const match = {
    source: "Book",
    paragraphs: [sentence],
    window: [heading, sentence, following],
  };

  assertEquals(
    validateEPUBContextSelection(match, "<p>対象の文です。</p>", "対象の文です。"),
    "<ruby>対象<rt>たいしょう</rt></ruby>の文です。",
  );
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
    match: { source: "Book", paragraphs: [first], window: [first], contextStart: 0 },
    contextHTML: "<ruby>同一<rt>どういつ</rt></ruby>の文です。",
  });
});

Deno.test("EPUB context analysis accepts identical complete dialogue with different narration", () => {
  const letter = "『あなたの<ruby>素性<rt>すじょう</rt></ruby>を知っています。お返事ください。』";
  const first = {
    html: `最初の場面。${letter}彼は便箋を畳んだ。`,
    plainText: "最初の場面。『あなたの素性を知っています。お返事ください。』彼は便箋を畳んだ。",
    document: "first.xhtml",
    index: 0,
  };
  const second = {
    html: `別の場面。${letter}彼女は封筒に戻した。`,
    plainText: "別の場面。『あなたの素性を知っています。お返事ください。』彼女は封筒に戻した。",
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

  const analysis = analyzeEPUBContext(corpus, "あなたの素性を知っています。", "Book");
  assertEquals(analysis.status, "complete");
  assertEquals(
    analysis.status === "complete" ? analysis.contextHTML : null,
    letter,
  );
});

Deno.test("EPUB context analysis rejects repeated excerpts with different evidence windows", () => {
  const first = {
    html: "最初の前提。対象の文です。",
    plainText: "最初の前提。対象の文です。",
    document: "first.xhtml",
    index: 0,
  };
  const second = {
    html: "別の前提。対象の文です。",
    plainText: "別の前提。対象の文です。",
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

  assertEquals(analyzeEPUBContext(corpus, "対象の文です。", "Book"), {
    status: "not-found",
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

Deno.test("EPUB context analysis rejects ambiguous quoted and standalone occurrences", () => {
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

Deno.test("EPUB context analysis does not treat angle brackets as dialogue", () => {
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
  assertEquals(analyzeEPUBContext(corpus, "〈対象の文です", "Book").status, "cut-off");
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

Deno.test("EPUB sentence expansion does not include the following sentence", () => {
  const paragraph = {
    html: "彼女は<ruby>中年<rt>ちゅうねん</rt></ruby>の領域に着実に歩を進めつつあった。次の文。",
    plainText: "彼女は中年の領域に着実に歩を進めつつあった。次の文。",
    document: "chapter.xhtml",
    index: 0,
  };

  assertEquals(
    expandEPUBContextToSentence([paragraph], "中年の領域に着実に歩を進めつつあった。"),
    "彼女は<ruby>中年<rt>ちゅうねん</rt></ruby>の領域に着実に歩を進めつつあった。",
  );
});

Deno.test("EPUB sentence expansion does not split at an inline title quotation", () => {
  const paragraph = {
    html:
      "「《ソードアート・オンライン》という名のこの世界は、ひとつの巨大なシステムによって<ruby>制御<rt>せいぎょ</rt></ruby>されています。次の文。」",
    plainText:
      "「《ソードアート・オンライン》という名のこの世界は、ひとつの巨大なシステムによって制御されています。次の文。」",
    document: "chapter.xhtml",
    index: 0,
  };
  const match = { source: "Book", paragraphs: [paragraph], window: [paragraph] };
  const original = "ひとつの巨大なシステムによって制御されています。";
  const expanded = expandEPUBContextToSentence([paragraph], original);

  assertEquals(
    expanded,
    "「《ソードアート・オンライン》という名のこの世界は、ひとつの巨大なシステムによって<ruby>制御<rt>せいぎょ</rt></ruby>されています。",
  );
  assertEquals(
    requiredEPUBContext(match, original),
    "「《ソードアート・オンライン》という名のこの世界は、ひとつの巨大なシステムによって<ruby>制御<rt>せいぎょ</rt></ruby>されています。次の文。」",
  );
});

Deno.test("EPUB dialogue expansion elides long cross-paragraph speech", () => {
  const paragraphs = [
    {
      html: "「最初の文。",
      plainText: "「最初の文。",
      document: "chapter.xhtml",
      index: 0,
    },
    {
      html: "二番目の文。",
      plainText: "二番目の文。",
      document: "chapter.xhtml",
      index: 1,
    },
    {
      html: "三番目の文。",
      plainText: "三番目の文。",
      document: "chapter.xhtml",
      index: 2,
    },
    {
      html: "四番目の文。",
      plainText: "四番目の文。",
      document: "chapter.xhtml",
      index: 3,
    },
    {
      html: "<ruby>対象<rt>たいしょう</rt></ruby>の文。",
      plainText: "対象の文。",
      document: "chapter.xhtml",
      index: 4,
    },
    {
      html: "最後の文。」",
      plainText: "最後の文。」",
      document: "chapter.xhtml",
      index: 5,
    },
  ];
  const corpus = {
    sources: [{
      name: "Book",
      documents: [paragraphs.map((paragraph) => paragraph.plainText).join("")],
      paragraphs,
    }],
  };
  const match = findUniqueEPUBContext(corpus, "対象の文。", "Book")!;

  assertEquals(match.window, paragraphs);
  assertEquals(
    expandEPUBContextToFullDialogue(match, "対象の文。"),
    [
      "<p>「……四番目の文。</p>",
      "<p><ruby>対象<rt>たいしょう</rt></ruby>の文。……」</p>",
    ].join("\n\n"),
  );
  const analysis = analyzeEPUBContext(corpus, "対象の文。", "Book");
  assertEquals(analysis.status, "complete");
  assertEquals(
    analysis.status === "complete"
      ? { contextHTML: analysis.contextHTML, dialogueElided: analysis.dialogueElided }
      : null,
    {
      contextHTML: [
        "<p>「……四番目の文。</p>",
        "<p><ruby>対象<rt>たいしょう</rt></ruby>の文。……」</p>",
      ].join("\n\n"),
      dialogueElided: true,
    },
  );
});

Deno.test("EPUB dialogue expansion keeps only a sufficiently substantial target paragraph", () => {
  const targetText =
    "この段落だけで対象の状況が十分にわかるだけの長さがあり、前後の段落がなくても意味を理解できる対象の文です。";
  const paragraphs = [
    {
      html: "「最初の文。",
      plainText: "「最初の文。",
      document: "chapter.xhtml",
      index: 0,
    },
    {
      html: targetText,
      plainText: targetText,
      document: "chapter.xhtml",
      index: 1,
    },
    {
      html: "最後の文。」",
      plainText: "最後の文。」",
      document: "chapter.xhtml",
      index: 2,
    },
  ];
  const match = {
    source: "Book",
    paragraphs: [paragraphs[1]],
    window: paragraphs,
    contextStart: paragraphs[0].plainText.length,
  };

  assertEquals(
    expandEPUBContextToFullDialogue(match, "対象の文です。"),
    `「……${targetText}……」`,
  );
});

Deno.test("EPUB dialogue expansion preserves complete two-paragraph speech", () => {
  const paragraphs = [
    {
      html: "「最初の文。",
      plainText: "「最初の文。",
      document: "chapter.xhtml",
      index: 0,
    },
    {
      html: "<ruby>対象<rt>たいしょう</rt></ruby>の文。」",
      plainText: "対象の文。」",
      document: "chapter.xhtml",
      index: 1,
    },
  ];
  const match = {
    source: "Book",
    paragraphs: [paragraphs[1]],
    window: paragraphs,
    contextStart: paragraphs[0].plainText.length,
  };

  assertEquals(
    expandEPUBContextToFullDialogue(match, "対象の文。"),
    [
      "<p>「最初の文。</p>",
      "<p><ruby>対象<rt>たいしょう</rt></ruby>の文。」</p>",
    ].join("\n\n"),
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
