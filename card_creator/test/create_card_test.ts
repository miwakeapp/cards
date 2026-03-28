import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { preextractedJMDictEntry } from "data";
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

Deno.test("createCard: reading has furigana for kanji words", async () => {
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
    context: "大小の違い",
    jmdictId: "1414110",
    recognitionTarget: "大小",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  assertEquals(card.reading, "大[だい] 小[しょう]");
});

Deno.test("createCard: sourceURL excluded when not public", async () => {
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
    sourceURL: "https://reader.ttsu.app/private",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  assertEquals(card.sourceURL, null);
});

Deno.test("createCard: sourceURL included when public", async () => {
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
    sourceURL: "https://www3.nhk.or.jp/news/article",
  };

  const card = await createCard({
    input,
    jmdictEntry,
    generateFields: createMockGenerator(mockAIFields),
  });

  assertEquals(card.sourceURL, "https://www3.nhk.or.jp/news/article");
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

Deno.test("createCard: converts single-reading ruby to bracket format with mark", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const card = await createCard({
    input: {
      context: "この箱の<ruby>大小<rt>だいしょう</rt></ruby>によって値段が変わる。",
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

  assertEquals(
    card.fullContext,
    "いろいろな人間のルールが自分のなかで<mark>瓦[が] 解[かい]</mark>していく。",
  );
});

Deno.test("createCard: extracts reading from per-kanji ruby", async () => {
  const jmdictEntry = await preextractedJMDictEntry("1209590");

  const card = await createCard({
    input: {
      context: "<ruby>瓦<rt>が</rt>解<rt>かい</rt></ruby>する。",
      jmdictId: "1209590",
      recognitionTarget: "瓦解",
    },
    jmdictEntry,
    generateFields: createMockGenerator({
      applicableSenses: [],
      reading: "wrong",
      targetInContext: "瓦解",
      hint: null,
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    }),
  });

  // Context reading (がかい) should override AI reading ("wrong")
  assertEquals(card.reading, "瓦[が] 解[かい]");
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
