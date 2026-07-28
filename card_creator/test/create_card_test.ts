import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertRejects } from "@std/assert";
import { createCard } from "card_creator";
import { preextractedJMDictEntry } from "data";
import { renderEntry } from "jmdict_to_html";

Deno.test("createCard renders complete deterministic fields", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  const card = await createCard({
    jmdictEntry: sizes,
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
    applicableSenseNumbers: [1],
    hint: "サイズの大小",
    minimizedContext: "箱の<mark>大小</mark>で値段が変わる。",
    source: {
      text: "Test Book",
      lang: "en",
    },
  });

  assertEquals(card, {
    key: "大小 | 1414110 | 1",
    recognitionTarget: "大小",
    reading: "大[だい] 小[しょう]",
    hint: "サイズの大小",
    fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
    minimizedContext: "箱の<mark>大小</mark>で値段が変わる。",
    dictionaryEntry: renderEntry(sizes),
    source: '<span lang="en">Test Book</span>',
  });
});

Deno.test("createCard canonicalizes valid sense selections", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      applicableSenseNumbers: [3, 1],
    })).key,
    "大小 | 1414110 | 1,3",
  );
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
    })).key,
    "大小 | 1414110",
  );
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      applicableSenseNumbers: [6, 5, 4, 3, 2, 1],
    })).key,
    "大小 | 1414110",
  );
});

Deno.test("createCard identifies invalid plain-text input fields", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      }),
    Error,
    'recognitionTarget "" must not be empty',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: " 大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      }),
    Error,
    'recognitionTarget " 大小" must not have surrounding whitespace',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大\u00a0小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      }),
    Error,
    'recognitionTarget "大 小" must not contain nonbreaking spaces',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        hint: "",
      }),
    Error,
    'hint "" must not be empty',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        hint: " 大小",
      }),
    Error,
    'hint " 大小" must not have surrounding whitespace',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        hint: "大\u202f小",
      }),
    Error,
    'hint "大 小" must not contain nonbreaking spaces',
  );
});

Deno.test("createCard rejects invalid sense selections", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [],
      }),
    Error,
    'applicableSenseNumbers [] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [0],
      }),
    Error,
    'applicableSenseNumbers [0] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [7],
      }),
    Error,
    'applicableSenseNumbers [7] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [1, 1],
      }),
    Error,
    'applicableSenseNumbers [1, 1] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [1.5],
      }),
    Error,
    'applicableSenseNumbers [1.5] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [NaN],
      }),
    Error,
    'applicableSenseNumbers [NaN] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        applicableSenseNumbers: [Infinity],
      }),
    Error,
    'applicableSenseNumbers [Infinity] must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1414110"',
  );
});

Deno.test("createCard requires JMDict spellings and applicable readings", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "猫",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>猫</mark>によって値段が変わる。",
      }),
    Error,
    'recognitionTarget "猫" is not among the jmdictEntry.kanji spellings or jmdictEntry.kana readings in jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "ダイショウ",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      }),
    Error,
    'kanaReading "ダイショウ" is not among the jmdictEntry.kana readings applicable to recognitionTarget "大小" in jmdictEntry with id "1414110"',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "～大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>～大小</mark>によって値段が変わる。",
      }),
    Error,
    'recognitionTarget "～大小" is not among the jmdictEntry.kanji spellings or jmdictEntry.kana readings in jmdictEntry with id "1414110"',
  );
});

Deno.test("createCard requires a reading for non-kana spellings", async () => {
  const player = await preextractedJMDictEntry("1000110");
  const card = await createCard({
    jmdictEntry: player,
    recognitionTarget: "ＣＤプレイヤー",
    kanaReading: "シーディープレイヤー",
    fullContext: "<mark>ＣＤプレイヤー</mark>を買った。",
  });

  assertEquals(card.reading, "Ｃ[シー] Ｄ[ディー]プレイヤー");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: player,
        recognitionTarget: "ＣＤプレイヤー",
        fullContext: "<mark>ＣＤプレイヤー</mark>を買った。",
      }),
    Error,
    'kanaReading is required because recognitionTarget "ＣＤプレイヤー" is a jmdictEntry.kanji spelling in jmdictEntry with id "1000110"',
  );
});

Deno.test("createCard omits the Reading field for kana spellings", async () => {
  const kanaEntry = await preextractedJMDictEntry("1207650");
  const plainCard = await createCard({
    jmdictEntry: kanaEntry,
    recognitionTarget: "かけがえのない",
    fullContext: "<mark>かけがえのない</mark>ものを知った。",
  });
  assertEquals(plainCard.reading, null);

  const rubyCard = await createCard({
    jmdictEntry: kanaEntry,
    recognitionTarget: "かけがえのない",
    fullContext: "<mark><ruby>かけがえのない<rt>カケガエノナイ</rt></ruby></mark>ものを知った。",
  });
  assertEquals(
    rubyCard.fullContext,
    "<mark>かけがえのない[カケガエノナイ]</mark>ものを知った。",
  );

  await assertRejects(
    () =>
      createCard({
        jmdictEntry: kanaEntry,
        recognitionTarget: "かけがえのない",
        kanaReading: "かけがえのない",
        fullContext: "<mark>かけがえのない</mark>ものを知った。",
      }),
    Error,
    'kanaReading "かけがえのない" must be omitted because recognitionTarget "かけがえのない" is a jmdictEntry.kana reading in jmdictEntry with id "1207650"; kana recognition targets do not use the card\'s Reading field',
  );
});

Deno.test("createCard applies JMDict spelling and reading restrictions to senses", async () => {
  const die = await preextractedJMDictEntry("2013080");
  const dieCard = await createCard({
    jmdictEntry: die,
    recognitionTarget: "歿する",
    kanaReading: "ぼっする",
    fullContext: "その地で<mark>歿した</mark>。",
  });
  assertEquals(dieCard.key, "歿する | 2013080 | 2");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: die,
        recognitionTarget: "歿する",
        kanaReading: "ぼっする",
        fullContext: "その地で<mark>歿した</mark>。",
        applicableSenseNumbers: [1],
      }),
    Error,
    'applicableSenseNumbers [1] includes sense 1, which does not apply to recognitionTarget "歿する" with kanaReading "ぼっする" in jmdictEntry with id "2013080"; applicableSenseNumbers may select only [2]',
  );

  const alias = await preextractedJMDictEntry("1158110");
  const firstAliasCard = await createCard({
    jmdictEntry: alias,
    recognitionTarget: "異名",
    kanaReading: "いみょう",
    fullContext: "<mark>異名</mark>を持つ。",
  });
  assertEquals(firstAliasCard.key, "異名 | 1158110 | 1");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: alias,
        recognitionTarget: "異名",
        kanaReading: "いみょう",
        fullContext: "<mark>異名</mark>を持つ。",
        applicableSenseNumbers: [2],
      }),
    Error,
    'applicableSenseNumbers [2] includes sense 2, which does not apply to recognitionTarget "異名" with kanaReading "いみょう" in jmdictEntry with id "1158110"; applicableSenseNumbers may select only [1]',
  );

  const secondAliasCard = await createCard({
    jmdictEntry: alias,
    recognitionTarget: "異名",
    kanaReading: "いめい",
    fullContext: "<mark>異名</mark>を持つ。",
    applicableSenseNumbers: [2],
  });
  assertEquals(secondAliasCard.key, "異名 | 1158110 | 2");

  const kanaAliasCard = await createCard({
    jmdictEntry: alias,
    recognitionTarget: "いみょう",
    fullContext: "<mark>いみょう</mark>を持つ。",
  });
  assertEquals(kanaAliasCard.key, "いみょう | 1158110 | 1");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: alias,
        recognitionTarget: "いみょう",
        fullContext: "<mark>いみょう</mark>を持つ。",
        applicableSenseNumbers: [2],
      }),
    Error,
    'applicableSenseNumbers [2] includes sense 2, which does not apply to recognitionTarget "いみょう" with kanaReading "いみょう" in jmdictEntry with id "1158110"; applicableSenseNumbers may select only [1]',
  );
});

Deno.test("createCard validates reading-to-spelling restrictions", async () => {
  const torch = await preextractedJMDictEntry("1632080");
  const card = await createCard({
    jmdictEntry: torch,
    recognitionTarget: "炬",
    kanaReading: "たいまつ",
    fullContext: "<mark>炬</mark>を掲げた。",
  });

  assertEquals(card.reading, "炬[たいまつ]");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: torch,
        recognitionTarget: "炬",
        kanaReading: "しょうめい",
        fullContext: "<mark>炬</mark>を掲げた。",
      }),
    Error,
    'kanaReading "しょうめい" is not among the jmdictEntry.kana readings applicable to recognitionTarget "炬" in jmdictEntry with id "1632080"',
  );
});

Deno.test("createCard accepts exact search-only readings", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1311110"),
    recognitionTarget: "私",
    kanaReading: "ワタシ",
    fullContext: "<mark>私</mark>が行く。",
  });

  assertEquals(card.reading, "私[ワタシ]");
});

Deno.test("createCard derives safe prefix and suffix notation from selected senses", async () => {
  const prefix = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1581200"),
    recognitionTarget: "曽",
    kanaReading: "そう",
    fullContext: "<mark>曽祖父</mark>に会う。",
  });
  assertEquals(prefix.key, "曽 | 1581200");
  assertEquals(prefix.recognitionTarget, "曽～");
  assertEquals(prefix.reading, "曽[そう]～");

  const counter = await createCard({
    jmdictEntry: await preextractedJMDictEntry("2077160"),
    recognitionTarget: "艘",
    kanaReading: "そう",
    fullContext: "全部で二<mark>艘</mark>あった。",
  });
  assertEquals(counter.key, "艘 | 2077160");
  assertEquals(counter.recognitionTarget, "～艘");
  assertEquals(counter.reading, "～ 艘[そう]");

  const degree = await preextractedJMDictEntry("1006690");
  const generalDegreeCard = await createCard({
    jmdictEntry: degree,
    recognitionTarget: "そこそこ",
    fullContext: "<mark>そこそこ</mark>の出来だ。",
  });
  assertEquals(generalDegreeCard.recognitionTarget, "そこそこ");

  const suffixDegreeCard = await createCard({
    jmdictEntry: degree,
    recognitionTarget: "そこそこ",
    fullContext: "<mark>そこそこ</mark>の出来だ。",
    applicableSenseNumbers: [3],
  });
  assertEquals(suffixDegreeCard.recognitionTarget, "～そこそこ");

  const imitation = await preextractedJMDictEntry("1225260");
  assertEquals(
    (await createCard({
      jmdictEntry: imitation,
      recognitionTarget: "まがい",
      fullContext: "<mark>まがい</mark>物だ。",
    })).recognitionTarget,
    "まがい",
  );
});

Deno.test("createCard separates suffix notation from multi-kanji furigana", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1855690"),
    recognitionTarget: "等々",
    kanaReading: "とうとう",
    fullContext: "契約条件<mark>等々</mark>を確認する。",
  });

  assertEquals(card.recognitionTarget, "～等々");
  assertEquals(card.reading, "～ 等[とう] 々[とう]");
});

Deno.test("createCard applies a missing gikun placement to the complete spelling", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1576750"),
    recognitionTarget: "黄昏",
    kanaReading: "たそがれ",
    fullContext: "永遠の<mark>黄昏</mark>の中で停止していた。",
  });

  assertEquals(card.reading, "黄昏[たそがれ]");
});

Deno.test("createCard requires precise furigana for multi-kanji spellings", async () => {
  const unattractive = await preextractedJMDictEntry("1205330");
  // The test fixture deliberately omits this known-good upstream placement record.
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: unattractive,
        recognitionTarget: "恰好悪い",
        kanaReading: "かっこわるい",
        fullContext: "<mark>恰好悪い</mark>。",
      }),
    Error,
    'No furigana placement data exists for recognitionTarget "恰好悪い" with kanaReading "かっこわるい" in jmdictEntry with id "1205330"',
  );
});

Deno.test("createCard directly annotates one kanji without furigana data", async () => {
  const shrine = await preextractedJMDictEntry("1322660");
  assertEquals(
    (await createCard({
      jmdictEntry: shrine,
      recognitionTarget: "社",
      kanaReading: "やしろ",
      fullContext: "屋上に<mark>社</mark>を移した。",
    })).reading,
    "社[やしろ]",
  );
});

Deno.test("createCard preserves explicit multiple target marks", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1217700"),
    recognitionTarget: "頑張る",
    kanaReading: "がんばる",
    fullContext: "<mark>頑張った</mark>し、また<mark>頑張れる</mark>。",
  });

  assertEquals(
    card.fullContext,
    "<mark>頑張った</mark>し、また<mark>頑張れる</mark>。",
  );
});

Deno.test("createCard validates resolved context structure", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "文脈だけ。",
      }),
    Error,
    "fullContext: Supplied HTML must contain at least one <mark> element",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "文<mark></mark>",
      }),
    Error,
    "fullContext: Supplied HTML <mark> elements must contain substantive text",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: '<mark class="target">大小</mark>',
      }),
    Error,
    "fullContext: Supplied HTML <mark> elements must not have attributes",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<mark><mark>大小</mark></mark>",
      }),
    Error,
    "fullContext: Supplied HTML must not contain nested <mark> elements",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<ruby><mark>大</mark><rt>だい</rt></ruby>小",
      }),
    Error,
    "fullContext: Supplied HTML must not contain <mark> inside ruby markup",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<rt>だい</rt><mark>大小</mark>",
      }),
    Error,
    "fullContext: Supplied HTML contains <rt> outside <ruby>",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<rb>大</rb><mark>大小</mark>",
      }),
    Error,
    "fullContext: Supplied HTML contains <rb> outside <ruby>",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<rp>（</rp><mark>大小</mark>",
      }),
    Error,
    "fullContext: Supplied HTML contains <rp> outside <ruby>",
  );
});

Deno.test("createCard identifies the invalid context field", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        minimizedContext: "大小だけ。",
      }),
    Error,
    "minimizedContext: Supplied HTML must contain at least one <mark> element",
  );
});

Deno.test("createCard normalizes nonbreaking spaces in text nodes only", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1414110"),
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext:
      '<span title="keep&nbsp;this">この箱の&nbsp;<mark>大小</mark>&#0160;によって\u202f値段が変わる。</span>',
  });

  assertEquals(
    card.fullContext,
    '<span title="keep&nbsp;this">この箱の <mark>大小</mark> によって 値段が変わる。</span>',
  );
});

Deno.test("createCard structurally converts complex source ruby", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1574430"),
    recognitionTarget: "餃子",
    kanaReading: "ギョーザ",
    fullContext:
      '横で<mark><ruby class="word"><rb><span>餃</span></rb><rp>（</rp><rt data-reading="1"><span>ぎよー</span></rt><rp>）</rp><rb>子</rb><rt>ざ</rt></ruby></mark>を食べている。',
  });

  assertEquals(card.fullContext, "横で<mark>餃[ぎょー] 子[ざ]</mark>を食べている。");
  assertEquals(card.reading, "餃[ギョー] 子[ザ]");
});

Deno.test("createCard handles multi-component and adjacent source ruby", async () => {
  const collapse = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1209590"),
    recognitionTarget: "瓦解",
    kanaReading: "がかい",
    fullContext: "ルールが<mark><ruby>瓦<rt>が</rt>解<rt>かい</rt></ruby></mark>していく。",
  });
  assertEquals(collapse.fullContext, "ルールが<mark>瓦[が] 解[かい]</mark>していく。");

  const dust = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1486050"),
    recognitionTarget: "微塵",
    kanaReading: "みじん",
    fullContext:
      "あの男は<mark><ruby>微<rt>み</rt></ruby><ruby>塵<rt>じん</rt></ruby></mark>も疑わなかった。",
  });
  assertEquals(
    dust.fullContext,
    "あの男は<mark>微[み] 塵[じん]</mark>も疑わなかった。",
  );
});

Deno.test("createCard validates partial ruby against only the selected reading", async () => {
  const tokyo = await preextractedJMDictEntry("1447690");
  const card = await createCard({
    jmdictEntry: tokyo,
    recognitionTarget: "東京",
    kanaReading: "とうきょう",
    fullContext: "<mark><ruby>東<rt>とう</rt></ruby>京</mark>に行く。",
  });
  assertEquals(card.fullContext, "<mark>東[とう]京</mark>に行く。");
  assertEquals(card.reading, "東[とう] 京[きょう]");

  await assertRejects(
    () =>
      createCard({
        jmdictEntry: tokyo,
        recognitionTarget: "東京",
        kanaReading: "とうけい",
        fullContext: "<mark><ruby>東<rt>とう</rt>京<rt>きょう</rt></ruby></mark>に行く。",
      }),
    Error,
    'fullContext: Supplied HTML ruby does not agree with kanaReading "とうけい" for recognitionTarget "東京"',
  );
});

Deno.test("createCard handles organic inflected and partial source ruby", async () => {
  const strike = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1416140"),
    recognitionTarget: "叩きつける",
    kanaReading: "たたきつける",
    fullContext:
      "地面に<mark><ruby><rb>叩</rb><rt>たた</rt></ruby>きつけられた</mark>ピナは、青い<ruby><rb>瞳</rb><rt>ひとみ</rt></ruby>で見つめた。",
  });
  assertEquals(
    strike.fullContext,
    "地面に<mark>叩[たた]きつけられた</mark>ピナは、青い 瞳[ひとみ]で見つめた。",
  );

  const bonfire = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1504680"),
    recognitionTarget: "焚き火",
    kanaReading: "たきび",
    fullContext: "<mark><ruby>焚<rt>た</rt></ruby>き火</mark>を囲む。",
  });
  assertEquals(bonfire.fullContext, "<mark>焚[た]き火</mark>を囲む。");

  const fastidious = await createCard({
    jmdictEntry: await preextractedJMDictEntry("2434300"),
    recognitionTarget: "潔癖症",
    kanaReading: "けっぺきしょう",
    fullContext:
      "<mark><ruby>潔<rt>けつ</rt></ruby><ruby>癖<rt>ぺき</rt></ruby>症</mark>ではない。",
  });
  assertEquals(
    fastidious.fullContext,
    "<mark>潔[けっ] 癖[ぺき]症</mark>ではない。",
  );
});

Deno.test("createCard aligns partial ruby using its marked source position", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1580650"),
    recognitionTarget: "人人",
    kanaReading: "ひとびと",
    fullContext: "<mark>人<ruby>人<rt>びと</rt></ruby></mark>が集まった。",
  });

  assertEquals(card.fullContext, "<mark>人 人[びと]</mark>が集まった。");
  assertEquals(card.reading, "人[ひと] 人[びと]");
});

Deno.test("createCard preserves ruby script and corrects full-size source kana", async () => {
  const faces = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1533460"),
    recognitionTarget: "面子",
    kanaReading: "メンツ",
    fullContext: "<mark><ruby>面<rt>めん</rt>子<rt>つ</rt></ruby></mark>を保つ。",
  });
  assertEquals(faces.fullContext, "<mark>面[めん] 子[つ]</mark>を保つ。");
  assertEquals(faces.reading, "面[メン] 子[ツ]");

  const center = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1424660"),
    recognitionTarget: "中枢",
    kanaReading: "ちゅうすう",
    fullContext: "<mark><ruby>中<rt>ちゆう</rt>枢<rt>すう</rt></ruby></mark>から追放された。",
  });
  assertEquals(center.fullContext, "<mark>中[ちゅう] 枢[すう]</mark>から追放された。");
});

Deno.test("createCard ignores unmarked ruby when validating the selected reading", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1447690"),
    recognitionTarget: "東京",
    kanaReading: "とうきょう",
    fullContext:
      "旧称は<ruby>東京<rt>とうけい</rt></ruby>だが、<ruby>赦<rt>しや</rt></ruby>なく<mark>東京</mark>へ行く。",
  });

  assertEquals(
    card.fullContext,
    "旧称は 東京[とうけい]だが、 赦[しゃ]なく<mark>東京</mark>へ行く。",
  );
  assertEquals(card.reading, "東[とう] 京[きょう]");
});

Deno.test("createCard adds Anki separators without adding a space before mark", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1414110"),
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext:
      "<ruby>藁<rt>わら</rt></ruby>と、地面に<ruby>叩<rt>たた</rt></ruby>きつけ、青い <ruby>瞳<rt>ひとみ</rt></ruby>で<mark>大小</mark>を見る。",
  });

  assertEquals(
    card.fullContext,
    "藁[わら]と、地面に 叩[たた]きつけ、青い 瞳[ひとみ]で<mark>大小</mark>を見る。",
  );
});

Deno.test("createCard preserves paragraphs and harmless inline target markup", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1414110"),
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext: "<p>前の段落。</p>\n\n<p><mark><em>大小</em></mark>を見る。</p>",
  });

  assertEquals(
    card.fullContext,
    "<p>前の段落。</p>\n\n<p><mark><em>大小</em></mark>を見る。</p>",
  );
});

Deno.test("createCard unwraps ruby without readings and rejects malformed ruby", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  const card = await createCard({
    jmdictEntry: sizes,
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext: "<ruby>俺</ruby>は<ruby></ruby><mark>大小</mark>を見た。",
  });
  assertEquals(card.fullContext, "俺は<mark>大小</mark>を見た。");

  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<mark><ruby><rt>だい</rt></ruby>小</mark>",
      }),
    Error,
    "fullContext: Supplied HTML contains ruby with an empty base or reading",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<mark><ruby>大<rt></rt></ruby>小</mark>",
      }),
    Error,
    "fullContext: Supplied HTML contains ruby with an empty base or reading",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext:
          "<mark><ruby>大<span><ruby>小<rt>しょう</rt></ruby></span><rt>だい</rt></ruby></mark>",
      }),
    Error,
    "fullContext: Supplied HTML must not contain nested <ruby> elements",
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "<mark><ruby>猫<rt>ねこ</rt></ruby></mark>",
      }),
    Error,
    'fullContext: Supplied HTML ruby base "猫" does not occur in the JMDict spelling "大小"',
  );
});

Deno.test("createCard rejects marked ruby that conflicts with the selected reading", async () => {
  await assertRejects(
    async () =>
      createCard({
        jmdictEntry: await preextractedJMDictEntry("1209590"),
        recognitionTarget: "瓦解",
        kanaReading: "がかい",
        fullContext: "<mark><ruby>瓦<rt>かわら</rt>解<rt>とけ</rt></ruby></mark>する。",
      }),
    Error,
    'fullContext: Supplied HTML ruby does not agree with kanaReading "がかい" for recognitionTarget "瓦解"',
  );
});

Deno.test("createCard renders and validates explicit source metadata", async () => {
  const sizes = await preextractedJMDictEntry("1414110");
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      source: { text: "『テスト本』", lang: "ja" },
    })).source,
    '<span lang="ja">『テスト本』</span>',
  );
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      source: {
        text: "「NHKニュース」",
        lang: "ja",
        url: "https://www3.nhk.or.jp/news/article?a=1&b=2",
      },
    })).source,
    '<a lang="ja" href="https://www3.nhk.or.jp/news/article?a=1&amp;b=2">「NHKニュース」</a>',
  );
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      source: { text: "News & Notes", lang: "en-us", url: "https://example.com" },
    })).source,
    '<a lang="en-US" href="https://example.com/">News &amp; Notes</a>',
  );

  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        source: { text: "Test", lang: "x-private" },
      }),
    Error,
    'source.lang "x-private" must be accepted by Intl.getCanonicalLocales()',
  );
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      source: { text: "Deep link", lang: "en", url: " miwake://cards/大小 " },
    })).source,
    '<a lang="en" href="miwake://cards/%E5%A4%A7%E5%B0%8F">Deep link</a>',
  );
  assertEquals(
    (await createCard({
      jmdictEntry: sizes,
      recognitionTarget: "大小",
      kanaReading: "だいしょう",
      fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
      source: { text: "File", lang: "en", url: "ftp://example.com/file" },
    })).source,
    '<a lang="en" href="ftp://example.com/file">File</a>',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        source: { text: "Test", lang: "en", url: "/relative" },
      }),
    TypeError,
    'source.url "/relative" must be an absolute URL',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        source: { text: "", lang: "en" },
      }),
    Error,
    'source.text "" must be nonempty and have no surrounding whitespace',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        source: { text: " Test", lang: "en" },
      }),
    Error,
    'source.text " Test" must be nonempty and have no surrounding whitespace',
  );
  await assertRejects(
    () =>
      createCard({
        jmdictEntry: sizes,
        recognitionTarget: "大小",
        kanaReading: "だいしょう",
        fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
        source: { text: "Test ", lang: "en" },
      }),
    Error,
    'source.text "Test " must be nonempty and have no surrounding whitespace',
  );
});

Deno.test("createCard renders trusted source HTML verbatim", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1414110"),
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
    source: {
      html:
        '<span lang="JA-jp">てごらん</span> <em onclick="alert(\'trusted HTML\')">(JLPT N3)</em> | Bunpro',
      lang: "en",
      url: "https://bunpro.jp/grammar_points/てごらん",
    },
  });
  assertEquals(
    card.source,
    '<a lang="en" href="https://bunpro.jp/grammar_points/%E3%81%A6%E3%81%94%E3%82%89%E3%82%93"><span lang="JA-jp">てごらん</span> <em onclick="alert(\'trusted HTML\')">(JLPT N3)</em> | Bunpro</a>',
  );
});

Deno.test("createCard escapes caller-owned plain-text fields", async () => {
  const card = await createCard({
    jmdictEntry: await preextractedJMDictEntry("1414110"),
    recognitionTarget: "大小",
    kanaReading: "だいしょう",
    fullContext: "この箱の<mark>大小</mark>によって値段が変わる。",
    hint: "<b>large & small</b>",
  });
  assertEquals(card.hint, "&lt;b&gt;large &amp; small&lt;/b&gt;");
});
