import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import type { ModelId, SenseAndHintGenerationInput } from "card_field_generation";
import { renderEntry } from "jmdict_to_html";
import { analyzeCard, type AnalyzedCard } from "../src/analyze.ts";
import {
  contextForPrompt,
  suggestedKey,
  suggestForCard,
  suggestionInputHash,
} from "../src/suggest.ts";
import { makeNote, makeWord } from "./fixtures.ts";

async function retargetingCard(): Promise<AnalyzedCard> {
  const previousEntry = makeWord({
    senses: [
      { glosses: ["word"] },
      { glosses: ["language"] },
    ],
  });
  const currentEntry = makeWord({
    senses: [
      { glosses: ["term"] },
      { glosses: ["language"] },
    ],
  });
  const note = makeNote({
    key: "言葉 | 1000000 | 1",
    dictionaryEntry: renderEntry(previousEntry),
    reading: "言[こと] 葉[ば]",
    fullContext: "これは<mark>言葉</mark><br>のテストです。",
  });
  return await analyzeCard(note, currentEntry);
}

Deno.test("suggestForCard supplies the shared sense-and-hint generator input", async () => {
  const card = await retargetingCard();
  let received:
    | { input: SenseAndHintGenerationInput; modelId: ModelId }
    | undefined;

  const { suggestion, cacheEntry } = await suggestForCard(card, {
    modelId: "gpt-5.5",
    generate: (input, modelId) => {
      received = { input, modelId };
      return Promise.resolve({
        applicableSenses: [2],
        hint: "言葉遣い",
      });
    },
  });

  assertEquals(received, {
    input: {
      context: "これは言葉\nのテストです。",
      recognitionTarget: "言葉",
      jmdictEntry: card.latestWord!,
      kanaReading: "ことば",
      compatibleSenseNumbers: [1, 2],
    },
    modelId: "gpt-5.5",
  });
  assertEquals(suggestion.senses, [2]);
  assertEquals(suggestion.aiHint, "言葉遣い");
  assertEquals(suggestion.defaultHint, "言葉遣い");
  assertEquals(suggestion.modelId, "gpt-5.5");
  assertEquals(suggestion.fromCache, false);
  assertEquals(cacheEntry.applicableSenses, [2]);
  assertEquals(cacheEntry.hint, "言葉遣い");
});

Deno.test("suggestForCard reuses an input-matched cache entry", async () => {
  const card = await retargetingCard();
  const modelId = "claude-opus-4-8";
  const inputHash = await suggestionInputHash(card, modelId);
  let generationCalls = 0;

  const { suggestion } = await suggestForCard(card, {
    modelId,
    cache: {
      [String(card.note.noteId)]: {
        inputHash,
        modelId,
        generatedAt: "2026-07-25T00:00:00.000Z",
        applicableSenses: [1],
        hint: "対象言葉",
      },
    },
    generate: () => {
      ++generationCalls;
      return Promise.resolve({
        applicableSenses: [],
        hint: null,
      });
    },
  });

  assertEquals(generationCalls, 0);
  assertEquals(suggestion.senses, [1]);
  assertEquals(suggestion.aiHint, "対象言葉");
  assertEquals(suggestion.fromCache, true);
});

Deno.test("suggestionInputHash covers fields used as deterministic sense evidence", async () => {
  const card = await retargetingCard();
  const originalHash = await suggestionInputHash(card, "claude-opus-4-8");

  card.note.fields.reading = "言葉[ことば]";
  const editedReadingHash = await suggestionInputHash(card, "claude-opus-4-8");
  assertNotEquals(editedReadingHash, originalHash);

  card.note.fields.recognitionTarget = "～言葉";
  const editedTargetHash = await suggestionInputHash(card, "claude-opus-4-8");
  assertNotEquals(editedTargetHash, editedReadingHash);
});

Deno.test("suggestForCard rejects a usage matching no sense in the latest entry", async () => {
  const card = await retargetingCard();

  await assertRejects(
    () =>
      suggestForCard(card, {
        generate: () =>
          Promise.resolve({
            applicableSenses: null,
            hint: null,
          }),
      }),
    Error,
    'No sense in the latest JMDict entry "1000000" applies to recognition target "言葉"',
  );
});

Deno.test("suggestForCard preserves a restricted all-compatible selection in the key", async () => {
  const previousEntry = makeWord({
    kanji: ["言葉", "詞"],
    senses: [
      { glosses: ["word"] },
      { glosses: ["language"] },
    ],
  });
  const currentEntry = makeWord({
    kanji: ["言葉", "詞"],
    senses: [
      { glosses: ["term"] },
      { glosses: ["language"] },
    ],
  });
  currentEntry.sense[1].appliesToKanji = ["詞"];
  const card = await analyzeCard(
    makeNote({
      key: "言葉 | 1000000 | 1",
      dictionaryEntry: renderEntry(previousEntry),
      reading: "言[こと] 葉[ば]",
    }),
    currentEntry,
  );

  const { suggestion } = await suggestForCard(card, {
    generate: (input) => {
      assertEquals(input.compatibleSenseNumbers, [1]);
      return Promise.resolve({
        applicableSenses: [],
        hint: null,
      });
    },
  });

  assertEquals(suggestion.senses, [1]);
  assertEquals(suggestedKey(card, suggestion.senses), "言葉 | 1000000 | 1");
});

Deno.test("contextForPrompt removes target markup and converts legacy line breaks", () => {
  assertEquals(
    contextForPrompt("  一つ<mark>言葉</mark><br><mark>言葉</mark>二つ  "),
    "一つ言葉\n言葉二つ",
  );
});
