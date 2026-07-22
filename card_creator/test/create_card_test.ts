import "../../data/test/use_furigana_fixture.ts";

import { assertEquals, assertRejects } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { preextractedJMDictEntry } from "data";
// Ensure every few-shot example's checked JMDict entry remains available.
import "../src/few_shot_examples.ts";
import { createCard } from "../src/create_card.ts";
import type { AIGeneratedFields, CardCreationInput } from "../src/types.ts";

// Mock AI generator that returns a fixed response
function createMockGenerator(response: AIGeneratedFields) {
  return (): Promise<AIGeneratedFields> => {
    return Promise.resolve(response);
  };
}

Deno.test("createCard: generates correct key with specific senses", async () => {
  // 大小 has 6 senses - we'll pretend only sense 1 (size) applies
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: null,
    targetInContext: "大小",
    minimizedContext: null,
    cleanedSource: "Test Book",
    sourceURLIsPublic: false,
  };

  const input: CardCreationInput = {
    context: "この箱の大小によって値段が変わる。",
    jmdictId: "1414110",
    recognitionTarget: "大小",
    source: "Test Book | Reader",
    sourceURL: "https://reader.ttsu.app/something",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  // Key should include sense number since not all senses apply
  assertEquals(card.key, "大小 | 1414110 | 1");
  assertEquals(card.recognitionTarget, "大小");
});

Deno.test("createCard: key omits senses when all apply", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [], // Empty means all senses apply
    reading: "だいしょう",
    hint: null,
    targetInContext: "大小",
    minimizedContext: null,
    cleanedSource: null,
    sourceURLIsPublic: false,
  };

  const input: CardCreationInput = {
    context: "テスト文",
    jmdictId: "1414110",
    recognitionTarget: "大小",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  // Key should NOT include senses
  assertEquals(card.key, "大小 | 1414110");
});

Deno.test("createCard: rejects non-plain recognition targets", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");
  const aiFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: null,
    targetInContext: "大小",
    minimizedContext: null,
    cleanedSource: null,
    sourceURLIsPublic: false,
  };

  for (
    const [recognitionTarget, expectedMessage] of [
      ["", "must not be empty"],
      [" 大小", "must not have surrounding whitespace"],
      ["大小 ", "must not have surrounding whitespace"],
      ["大\u00a0小", "must not contain nonbreaking spaces"],
      ["<b>大小</b>", "must not contain HTML markup"],
      ["大小&NonBreakingSpace;", "must not contain HTML character references"],
    ]
  ) {
    await assertRejects(
      () =>
        createCard({
          input: {
            context: "この箱の大小によって値段が変わる。",
            jmdictId: "1414110",
            recognitionTarget,
          },
          jmdictEntry,
          generateFields: createMockGenerator(aiFields),
        }),
      Error,
      expectedMessage,
    );
  }
});

Deno.test("createCard: rejects non-plain targetInContext", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  await assertRejects(
    () =>
      createCard({
        input: {
          context: "この箱の大小によって値段が変わる。",
          jmdictId: "1414110",
          recognitionTarget: "大小",
        },
        jmdictEntry,
        generateFields: createMockGenerator({
          applicableSenses: [1],
          reading: "だいしょう",
          hint: null,
          targetInContext: "大小 ",
          minimizedContext: null,
          cleanedSource: null,
          sourceURLIsPublic: false,
        }),
      }),
    Error,
    "targetInContext must not have surrounding whitespace",
  );
});

Deno.test("createCard: normalizes nonbreaking spaces in HTML context", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const card = await createCard({
    input: {
      context: "この箱の&nbsp;大小&#0160;によって\u00a0値段が変わる。",
      jmdictId: "1414110",
      recognitionTarget: "大小",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.context, "この箱の 大小 によって 値段が変わる。");
      return Promise.resolve({
        applicableSenses: [1],
        reading: "だいしょう",
        hint: null,
        targetInContext: "大小",
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.fullContext, "この箱の <mark>大小</mark> によって 値段が変わる。");
});

Deno.test("createCard: reading has furigana for kanji words", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const input: CardCreationInput = {
    context: "大小の違い",
    jmdictId: "1414110",
    recognitionTarget: "大小",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, undefined);
      return Promise.resolve({
        applicableSenses: [1],
        reading: "だいしょう",
        hint: null,
        targetInContext: "大小",
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.reading, "大[だい] 小[しょう]");
});

Deno.test("createCard: source uses span when URL is not public", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: null,
    targetInContext: "大小",
    minimizedContext: null,
    cleanedSource: null,
    sourceURLIsPublic: false,
  };

  const input: CardCreationInput = {
    context: "テスト",
    jmdictId: "1414110",
    recognitionTarget: "大小",
    source: "テスト本",
    sourceURL: "https://reader.ttsu.app/private",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  assertEquals(card.source, `<span lang="ja">『テスト本』</span>`);
});

Deno.test("createCard: source uses link when URL is public", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: null,
    targetInContext: "大小",
    minimizedContext: null,
    cleanedSource: null,
    sourceURLIsPublic: true,
  };

  const input: CardCreationInput = {
    context: "テスト",
    jmdictId: "1414110",
    recognitionTarget: "大小",
    source: "NHKニュース",
    sourceURL: "https://www3.nhk.or.jp/news/article",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  assertEquals(
    card.source,
    `<a lang="ja" href="https://www3.nhk.or.jp/news/article">「NHKニュース」</a>`,
  );
});

Deno.test("createCard: English source is marked with lang=en", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: null,
    targetInContext: "大小",
    minimizedContext: null,
    cleanedSource: null,
    sourceURLIsPublic: false,
  };

  const input: CardCreationInput = {
    context: "テスト",
    jmdictId: "1414110",
    recognitionTarget: "大小",
    source: "Tatoeba",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  assertEquals(card.source, `<span lang="en">Tatoeba</span>`);
});

Deno.test("createCard: English public source is linked without quotation marks", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const input: CardCreationInput = {
    context: "テスト",
    jmdictId: "1414110",
    recognitionTarget: "大小",
    source: "Tatoeba",
    sourceURL: "https://tatoeba.org/en/sentences/show/76039",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator({
      applicableSenses: [1],
      reading: "だいしょう",
      hint: null,
      targetInContext: "大小",
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: true,
    }),
  });

  assertEquals(
    card.source,
    `<a lang="en" href="https://tatoeba.org/en/sentences/show/76039">Tatoeba</a>`,
  );
});

// Snapshot test for full card structure
Deno.test("createCard: full card structure snapshot", async (t) => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: "サイズの大小",
    targetInContext: "大小",
    minimizedContext: "箱の大小で値段が変わる。",
    cleanedSource: "Test Book",
    sourceURLIsPublic: false,
  };

  const input: CardCreationInput = {
    context: "この箱の大小によって値段が変わるのは当然のことだ。",
    jmdictId: "1414110",
    recognitionTarget: "大小",
    source: "Test Book | ッツ Ebook Reader",
    sourceURL: "https://reader.ttsu.app/something",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  // Snapshot everything except the dictionary entry (which is tested separately in jmdict_to_html)
  const { dictionaryEntry: _, ...cardWithoutDict } = card;
  await assertSnapshot(t, cardWithoutDict);
});

Deno.test("createCard: marks conjugated form using targetInContext", async () => {
  // Use any pre-extracted entry; AI fields are mocked so the specific entry doesn't matter
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [],
    reading: "うしろめたい",
    targetInContext: "後ろめたさ",
    hint: null,
    minimizedContext: null,
    cleanedSource: null,
    sourceURLIsPublic: false,
  };

  const input: CardCreationInput = {
    context: "父に対する多少の後ろめたさ以外には、なんの痛みも苦悩もない。",
    jmdictId: "1414110",
    recognitionTarget: "後ろめたい",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  // The conjugated form should be marked, not the dictionary form
  assertEquals(card.fullContext.includes("<mark>後ろめたさ</mark>"), true);
  assertEquals(card.fullContext.includes("後ろめたい"), false);
});

Deno.test("createCard: marks a conjugated form containing source ruby", async () => {
  // ソードアート・オンライン2 annotates only the inflected verb's kanji stem.
  const jmdictEntry = await preextractedJMDictEntry("1416140");
  const card = await createCard({
    input: {
      context:
        "地面に<ruby><rb>叩</rb><rt>たた</rt></ruby>きつけられたピナは、首を上げ、つぶらな青い<ruby><rb>瞳</rb><rt>ひとみ</rt></ruby>でシリカを見つめた。",
      jmdictId: "1416140",
      recognitionTarget: "叩きつける",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "たたきつける");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "叩きつけられた",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(
    card.fullContext,
    "地面に<mark>叩[たた]きつけられた</mark>ピナは、首を上げ、つぶらな青い 瞳[ひとみ]でシリカを見つめた。",
  );
  assertEquals(card.reading, "叩[たた]きつける");
});

Deno.test("createCard: converts single-reading ruby to bracket format with mark", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const card = await createCard({
    input: {
      context: "この箱の<ruby>大小<rt>だいしょう</rt></ruby>によって値段が変わる。",
      jmdictId: "1414110",
      recognitionTarget: "大小",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "だいしょう");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "大小",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.fullContext, "この箱の<mark>大小[だいしょう]</mark>によって値段が変わる。");
  assertEquals(card.reading, "大[だい] 小[しょう]");
});

Deno.test("createCard: converts per-kanji ruby to bracket format with mark", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1209590");

  const card = await createCard({
    input: {
      context:
        "いろいろな人間のルールが自分のなかで<ruby>瓦<rt>が</rt>解<rt>かい</rt></ruby>していく。",
      jmdictId: "1209590",
      recognitionTarget: "瓦解",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "がかい");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "瓦解",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(
    card.fullContext,
    "いろいろな人間のルールが自分のなかで<mark>瓦[が] 解[かい]</mark>していく。",
  );
  assertEquals(card.reading, "瓦[が] 解[かい]");
});

Deno.test("createCard: converts adjacent source ruby for one word", async () => {
  // 容疑者Xの献身 represents 微塵 using two adjacent `<ruby>` elements.
  const jmdictEntry = await preextractedJMDictEntry("1486050");

  const card = await createCard({
    input: {
      context:
        "あの男は<ruby>微<rt>み</rt></ruby><ruby>塵<rt>じん</rt></ruby>も疑っちゃいなかった。",
      jmdictId: "1486050",
      recognitionTarget: "微塵",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "みじん");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "微塵",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(
    card.fullContext,
    "あの男は<mark>微[み] 塵[じん]</mark>も疑っちゃいなかった。",
  );
  assertEquals(card.reading, "微[み] 塵[じん]");
});

Deno.test("createCard: validates a partially annotated source reading", async () => {
  // 舟を編む annotates 焚 but leaves the second kanji in 焚き火 unannotated.
  const jmdictEntry = await preextractedJMDictEntry("1504680");

  const card = await createCard({
    input: {
      context: "<ruby>焚<rt>た</rt></ruby>き火を囲む。",
      jmdictId: "1504680",
      recognitionTarget: "焚き火",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "たきび");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "焚き火",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.fullContext, "<mark>焚[た]き火</mark>を囲む。");
  assertEquals(card.reading, "焚[た]き 火[び]");
});

Deno.test("createCard: corrects full-size kana in partial source ruby", async () => {
  // 容疑者Xの献身 leaves 症 unannotated and spells small っ as full-sized つ.
  const jmdictEntry = await preextractedJMDictEntry("2434300");

  const card = await createCard({
    input: {
      context: "<ruby>潔<rt>けつ</rt></ruby><ruby>癖<rt>ぺき</rt></ruby>症ではない。",
      jmdictId: "2434300",
      recognitionTarget: "潔癖症",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "けっぺきしょう");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "潔癖症",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.fullContext, "<mark>潔[けっ] 癖[ぺき]症</mark>ではない。");
  assertEquals(card.reading, "潔[けっ] 癖[ぺき] 症[しょう]");
});

Deno.test("createCard: uses hiragana ruby to identify a katakana JMDict reading", async () => {
  // 舟を編む follows the usual publisher convention of hiragana ruby. JMDict intentionally uses
  // katakana for this Chinese loanword's canonical kana form, as do Japanese dictionaries.
  const jmdictEntry = await preextractedJMDictEntry("1533460");

  const card = await createCard({
    input: {
      context: "<ruby>面<rt>めん</rt>子<rt>つ</rt></ruby>を保つ。",
      jmdictId: "1533460",
      recognitionTarget: "面子",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "メンツ");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "面子",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.fullContext, "<mark>面[めん] 子[つ]</mark>を保つ。");
  // Keep the source's ruby in context, but use JMDict's canonical script for the card reading.
  assertEquals(card.reading, "面[メン] 子[ツ]");
});

Deno.test("createCard: corrects full-size kana in context ruby", async () => {
  // 羊をめぐる冒険 annotates 中枢 as ちゆうすう in the source ebook.
  const jmdictEntry = await preextractedJMDictEntry("1424660");

  const card = await createCard({
    input: {
      context:
        "要するに彼は東亜の農政の<ruby>中<rt>ちゆう</rt>枢<rt>すう</rt></ruby>から追放されたのだ。",
      jmdictId: "1424660",
      recognitionTarget: "中枢",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "ちゅうすう");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "中枢",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(
    card.fullContext,
    "要するに彼は東亜の農政の<mark>中[ちゅう] 枢[すう]</mark>から追放されたのだ。",
  );
  assertEquals(card.reading, "中[ちゅう] 枢[すう]");
});

Deno.test("createCard: accepts a search-only JMDict reading from context ruby", async () => {
  // わたし、定時で帰ります。 uses JMDict's search-only ぎょうざ reading.
  const jmdictEntry = await preextractedJMDictEntry("1574430");

  const card = await createCard({
    input: {
      context:
        "結衣は画面をじっと見つめると、横で<ruby><rb>餃</rb><rt>ぎょう</rt><rb>子</rb><rt>ざ</rt></ruby>を食べている常連のおじさんに尋ねた。",
      jmdictId: "1574430",
      recognitionTarget: "餃子",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, "ぎょうざ");
      return Promise.resolve({
        applicableSenses: [],
        targetInContext: "餃子",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(
    card.fullContext,
    "結衣は画面をじっと見つめると、横で<mark>餃[ぎょう] 子[ざ]</mark>を食べている常連のおじさんに尋ねた。",
  );
  assertEquals(card.reading, "餃[ぎょう] 子[ざ]");
});

Deno.test("createCard: requests a reading when source ruby could belong to another occurrence", async () => {
  // 阪急電車 contains both the compound 神社 and the ruby-annotated noun お社.
  const jmdictEntry = await preextractedJMDictEntry("1322660");

  const card = await createCard({
    input: {
      context: "もともと神社だった土地を買ってお<ruby>社<rt>やしろ</rt></ruby>を屋上に移した。",
      jmdictId: "1322660",
      recognitionTarget: "社",
    },
    jmdictEntry,
    generateFields: (input) => {
      assertEquals(input.readingFromContext, undefined);
      return Promise.resolve({
        applicableSenses: [],
        reading: "やしろ",
        targetInContext: "社",
        hint: null,
        minimizedContext: null,
        cleanedSource: null,
        sourceURLIsPublic: false,
      });
    },
  });

  assertEquals(card.reading, "社[やしろ]");
});

Deno.test("createCard: adds missing separators before inline ruby annotations", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const card = await createCard({
    input: {
      context:
        "<ruby>藁<rt>わら</rt></ruby>と、地面に<ruby>叩<rt>たた</rt></ruby>きつけ、青い <ruby>瞳<rt>ひとみ</rt></ruby>で大小を見る。",
      jmdictId: "1414110",
      recognitionTarget: "大小",
    },
    jmdictEntry,
    generateFields: createMockGenerator({
      applicableSenses: [],
      reading: "だいしょう",
      targetInContext: "大小",
      hint: null,
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    }),
  });

  assertEquals(
    card.fullContext,
    "藁[わら]と、地面に 叩[たた]きつけ、青い 瞳[ひとみ]で<mark>大小</mark>を見る。",
  );
});

Deno.test("createCard: rejects context ruby absent from JMDict", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1209590");

  await assertRejects(
    () =>
      createCard({
        input: {
          context: "<ruby>瓦<rt>かわら</rt>解<rt>とけ</rt></ruby>する。",
          jmdictId: "1209590",
          recognitionTarget: "瓦解",
        },
        jmdictEntry,
        generateFields: createMockGenerator({
          applicableSenses: [],
          reading: "がかい",
          targetInContext: "瓦解",
          hint: null,
          minimizedContext: null,
          cleanedSource: null,
          sourceURLIsPublic: false,
        }),
      }),
    Error,
    'Context ruby "瓦[かわら] 解[とけ]" does not match a JMDict reading',
  );
});

Deno.test("createCard: marks plain target when no ruby present", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1209590");

  const card = await createCard({
    input: {
      context: "瓦解していく。",
      jmdictId: "1209590",
      recognitionTarget: "瓦解",
    },
    jmdictEntry,
    generateFields: createMockGenerator({
      applicableSenses: [],
      reading: "がかい",
      targetInContext: "瓦解",
      hint: null,
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    }),
  });

  assertEquals(card.fullContext, "<mark>瓦解</mark>していく。");
});

Deno.test("createCard: uses kana-swapped context spelling as recognition target", async () => {
  const jmdictEntry = await preextractedJMDictEntry("2643730");

  const card = await createCard({
    input: {
      context: "埃をかぶった段ボール箱の中には、エンジ色のアルバムがあった。",
      jmdictId: "2643730",
      recognitionTarget: "えんじ色",
    },
    jmdictEntry,
    generateFields: createMockGenerator({
      applicableSenses: [],
      reading: "えんじいろ",
      targetInContext: "エンジ色",
      hint: null,
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    }),
  });

  assertEquals(card.key, "エンジ色 | 2643730");
  assertEquals(card.recognitionTarget, "エンジ色");
  assertEquals(card.reading, "エンジ 色[いろ]");
  assertEquals(
    card.fullContext,
    "埃をかぶった段ボール箱の中には、<mark>エンジ色</mark>のアルバムがあった。",
  );
});

Deno.test("createCard: drops minimized context equivalent to full context without furigana", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1209590");

  const card = await createCard({
    input: {
      context:
        "いろいろな人間のルールが自分のなかで<ruby>瓦<rt>が</rt>解<rt>かい</rt></ruby>していくように思えて、何度考えても同じ結論に戻ってしまった。",
      jmdictId: "1209590",
      recognitionTarget: "瓦解",
    },
    jmdictEntry,
    generateFields: createMockGenerator({
      applicableSenses: [],
      reading: "がかい",
      targetInContext: "瓦解",
      hint: null,
      minimizedContext:
        "いろいろな人間のルールが自分のなかで<mark>瓦解</mark>していくように思えて、何度考えても同じ結論に戻ってしまった。",
      cleanedSource: null,
      sourceURLIsPublic: false,
    }),
  });

  assertEquals(card.minimizedContext, null);
});
