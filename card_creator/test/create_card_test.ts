import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { preextractedJMDictEntry } from "data";
import { createCard } from "../src/create_card.ts";
import type { ModelId } from "../src/ai_provider.ts";
import type { AIGeneratedFields, CardCreationInput } from "../src/types.ts";

// Mock AI generator that returns a fixed response
function createMockGenerator(response: AIGeneratedFields) {
  return (_input: unknown, _modelId: ModelId): Promise<AIGeneratedFields> => {
    return Promise.resolve(response);
  };
}

const TEST_MODEL_ID: ModelId = "claude-opus-4-5";

Deno.test("createCard: generates correct key with specific senses", async () => {
  // 大小 has 6 senses - we'll pretend only sense 1 (size) applies
  const jmdictEntry = await preextractedJMDictEntry("1414110");

  const mockAIFields: AIGeneratedFields = {
    applicableSenses: [1],
    reading: "だいしょう",
    hint: null,
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
    modelId: TEST_MODEL_ID,
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
    modelId: TEST_MODEL_ID,
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
    modelId: TEST_MODEL_ID,
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
    modelId: TEST_MODEL_ID,
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
    modelId: TEST_MODEL_ID,
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
    modelId: TEST_MODEL_ID,
    generateFields: createMockGenerator(mockAIFields),
  });

  // Snapshot everything except the dictionary entry (which is tested separately in jmdict_to_html)
  const { dictionaryEntry: _, ...cardWithoutDict } = card;
  await assertSnapshot(t, cardWithoutDict);
});
