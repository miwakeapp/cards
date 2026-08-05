import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  GenerationResult,
  HintGenerationInput,
  ModelId,
  SenseSelectionInput,
  SenseSelectionOutcome,
} from "card_field_generation";
import { renderDictionaryField } from "card_model/dictionary";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { preextractedJMDictEntry } from "data";
import { analyzeCard, type AnalyzedCard } from "../src/analyze.ts";
import { contextForPrompt, suggestedKey, suggestForCard } from "../src/suggest.ts";
import { entriesById, makeNote, makeWord } from "./fixtures.ts";

function renderDictionary(word: JMdictWord): string {
  return renderDictionaryField([word]);
}

function generated<T>(
  value: T,
  cacheStatus: GenerationResult<T>["metadata"]["cacheStatus"] = "miss",
  modelConfigurationId = "test",
): GenerationResult<T> {
  return {
    value,
    metadata: {
      operation: "test",
      cacheKey: "test",
      cacheStatus,
      modelConfigurationId,
      attempts: [],
      latencyMilliseconds: 0,
      usage: {
        inputTokens: 0,
        noCacheInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      sourceUsage: {
        inputTokens: 0,
        noCacheInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      fingerprints: {
        basePrompt: "test-prompt",
        stablePrompt: "test-stable-prompt",
        schema: "test-schema",
        configuration: "test-configuration",
      },
    },
  };
}

function selected(senseNumbers: readonly number[]): SenseSelectionOutcome {
  return { outcome: "selected", senseNumbers };
}

function suggestForTest(
  card: AnalyzedCard,
  options: Parameters<typeof suggestForCard>[1],
) {
  return suggestForCard(card, {
    verifyContext: () => Promise.resolve(),
    ...options,
  });
}

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
    key: "言葉 | 1000000:1",
    dictionary: renderDictionary(previousEntry),
    reading: "言[こと] 葉[ば]",
    fullContext: "これは<mark>言[こと] 葉[ば]</mark><br>のテストです。",
  });
  return await analyzeCard(note, entriesById(currentEntry));
}

Deno.test("suggestForCard considers every accepted reading for the anchor entry", async () => {
  const previousAnchor = await preextractedJMDictEntry("1158110");
  const currentAnchor = structuredClone(previousAnchor);
  currentAnchor.sense[0].gloss[0].text = "an alternative name";
  const card = await analyzeCard(
    makeNote({
      key: "異名 | 1158110:1",
      dictionary: renderDictionary(previousAnchor),
      reading: "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
      fullContext: "《閃光》の<mark>異名</mark>で知られている。",
    }),
    entriesById(currentAnchor),
  );
  assertEquals(card.verdict, "retarget");

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [currentAnchor],
    selectSenses: (input) => {
      assertEquals(input.compatibleSenseNumbers, [1, 2]);
      return Promise.resolve(generated(selected([1])));
    },
    generateHint: () => Promise.resolve(generated({ outcome: "not-needed" as const })),
  });

  assertEquals(suggestion.senses, [1]);
});

Deno.test("suggestForCard projects a custom Recognition target onto the Key spelling", async () => {
  const previousAnchor = await preextractedJMDictEntry("1158110");
  const currentAnchor = structuredClone(previousAnchor);
  currentAnchor.sense[0].gloss[0].text = "an alternative name";
  const card = await analyzeCard(
    makeNote({
      key: "異名 | 1158110:1",
      recognitionTarget: "その異名",
      reading: "その 異[い] 名[みょう]",
      dictionary: renderDictionary(previousAnchor),
      fullContext: "その<mark>異名</mark>で知られている。",
    }),
    entriesById(currentAnchor),
  );
  assertEquals(card.verdict, "retarget");

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [currentAnchor],
    selectSenses: (input) => {
      assertEquals(input.compatibleSenseNumbers, [1]);
      return Promise.resolve(generated(selected([1])));
    },
    generateHint: () => Promise.resolve(generated({ outcome: "not-needed" as const })),
  });

  assertEquals(suggestion.senses, [1]);
});

Deno.test("suggestForCard supplies marked context to focused sense and hint operations", async () => {
  const card = await retargetingCard();
  let senseInput: SenseSelectionInput | undefined;
  let hintInput: HintGenerationInput | undefined;
  let receivedModelId: ModelId | undefined;
  let verifiedContext: unknown;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    modelId: "gpt-5.6-sol",
    verifyContext: (context, lookupSpelling, options) => {
      verifiedContext = { context, lookupSpelling, options };
      return Promise.resolve();
    },
    selectSenses: (input, options) => {
      senseInput = input;
      receivedModelId = options?.modelId;
      return Promise.resolve(generated(selected([2]), "miss", "gpt-5.6-sol@low"));
    },
    generateHint: (input) => {
      hintInput = input;
      return Promise.resolve(generated(
        {
          outcome: "generated" as const,
          semanticEvidenceSpan: "言葉\nのテスト",
          hintSourceSpan: "言葉のテスト",
          hint: "言葉のテスト",
        },
        "miss",
        "gpt-5.6-sol@medium",
      ));
    },
  });

  assertEquals(senseInput, {
    context: "これは<mark>言葉</mark><br>のテストです。",
    recognitionTarget: "言葉",
    jmdictEntry: card.latestWord!,
    compatibleSenseNumbers: [1, 2],
  });
  assertEquals(hintInput, {
    context: "これは<mark>言葉</mark><br>のテストです。",
    recognitionTarget: "言葉",
    selectedUsage: { entry: card.latestWord!, senseNumbers: [2] },
    contrastingUsages: [{ entry: card.latestWord!, senseNumbers: [1] }],
  });
  assertEquals(receivedModelId, "gpt-5.6-sol");
  assertEquals(verifiedContext, {
    context: "これは<mark>言葉</mark><br>のテストです。",
    lookupSpelling: "言葉",
    options: { partOfSpeech: ["n"] },
  });
  assertEquals(suggestion.senses, [2]);
  assertEquals(suggestion.aiHint, "言葉のテスト");
  assertEquals(suggestion.defaultHint, "言葉のテスト");
  assertEquals(suggestion.modelConfigurationIds, [
    "gpt-5.6-sol@low",
    "gpt-5.6-sol@medium",
  ]);
  assertEquals(suggestion.fromCache, false);
});

Deno.test("suggestForCard rejects stale target marks before invoking AI", async () => {
  const card = await retargetingCard();
  let senseSelectionWasRequested = false;

  await assertRejects(
    () =>
      suggestForTest(card, {
        sameSpellingEntries: [card.latestWord!],
        verifyContext: () => Promise.reject(new Error("unsupported marked occurrence")),
        selectSenses: () => {
          senseSelectionWasRequested = true;
          return Promise.resolve(generated(selected([1])));
        },
      }),
    Error,
    'Card 1601969325935 Full context does not mark a supported occurrence of key spelling "言葉" in latest JMDict entry "1000000"',
  );
  assertEquals(senseSelectionWasRequested, false);
});

Deno.test("suggestForCard reports focused operation cache hits", async () => {
  const card = await retargetingCard();
  let receivedModelId: ModelId | undefined;
  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    selectSenses: (input, options) => {
      receivedModelId = options?.modelId;
      return Promise.resolve(generated(selected(input.compatibleSenseNumbers), "hit"));
    },
  });

  assertEquals(receivedModelId, undefined);
  assertEquals(suggestion.senses, []);
  assertEquals(suggestion.aiHint, null);
  assertEquals(suggestion.modelConfigurationIds, ["test"]);
  assertEquals(suggestion.fromCache, true);
});

Deno.test("suggestForCard skips hint generation without a competitor and preserves a hint", async () => {
  const card = await retargetingCard();
  card.note.fields.hint = "同じ綴りの別項目と区別する言葉";
  let hintWasRequested = false;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    selectSenses: (input) => Promise.resolve(generated(selected(input.compatibleSenseNumbers))),
    generateHint: () => {
      hintWasRequested = true;
      return Promise.resolve(generated({ outcome: "not-needed" as const }));
    },
  });

  assertEquals(hintWasRequested, false);
  assertEquals(suggestion.senses, []);
  assertEquals(suggestion.aiHint, null);
  assertEquals(suggestion.defaultHint, "同じ綴りの別項目と区別する言葉");
});

Deno.test("suggestForCard requests a hint when another entry has the same spelling", async () => {
  const card = await retargetingCard();
  const competitor = makeWord({
    id: "2000000",
    senses: [{ glosses: ["a distinct same-spelling word"] }],
  });
  let hintInput: HintGenerationInput | undefined;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!, competitor],
    selectSenses: (input) => Promise.resolve(generated(selected(input.compatibleSenseNumbers))),
    generateHint: (input) => {
      hintInput = input;
      return Promise.resolve(generated({
        outcome: "generated" as const,
        semanticEvidenceSpan: "言葉のテスト",
        hintSourceSpan: "言葉のテスト",
        hint: "言葉のテスト",
      }));
    },
  });

  assertEquals(hintInput, {
    context: "これは<mark>言葉</mark><br>のテストです。",
    recognitionTarget: "言葉",
    selectedUsage: { entry: card.latestWord!, senseNumbers: [1, 2] },
    contrastingUsages: [{ entry: competitor, senseNumbers: [1] }],
  });
  assertEquals(suggestion.senses, []);
  assertEquals(suggestion.aiHint, "言葉のテスト");
});

Deno.test("suggestForCard does not assume suffix notation absent from the stored front", async () => {
  const card = await retargetingCard();
  for (const sense of card.latestWord!.sense) sense.partOfSpeech = ["n-suf"];
  const noun = makeWord({
    id: "2000000",
    senses: [{ glosses: ["a distinct noun"], partOfSpeech: ["n"] }],
  });
  let hintInput: HintGenerationInput | undefined;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!, noun],
    selectSenses: (input) => Promise.resolve(generated(selected(input.compatibleSenseNumbers))),
    generateHint: (input) => {
      hintInput = input;
      return Promise.resolve(generated({
        outcome: "generated" as const,
        semanticEvidenceSpan: "言葉のテスト",
        hintSourceSpan: "言葉のテスト",
        hint: "言葉のテスト",
      }));
    },
  });

  assertEquals(hintInput?.contrastingUsages, [{ entry: noun, senseNumbers: [1] }]);
  assertEquals(suggestion.aiHint, "言葉のテスト");
});

Deno.test("suggestForCard uses half-width suffix notation already present on the stored front", async () => {
  const card = await retargetingCard();
  card.note.fields.recognitionTarget = "~言葉";
  card.note.fields.reading = "~ 言[こと] 葉[ば]";
  for (const sense of card.latestWord!.sense) sense.partOfSpeech = ["n-suf"];
  const noun = makeWord({
    id: "2000000",
    senses: [{ glosses: ["a distinct noun"], partOfSpeech: ["n"] }],
  });
  let hintCalls = 0;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!, noun],
    selectSenses: (input) => Promise.resolve(generated(selected(input.compatibleSenseNumbers))),
    generateHint: () => {
      ++hintCalls;
      throw new Error("Unexpected hint generation");
    },
  });

  assertEquals(hintCalls, 0);
  assertEquals(suggestion.aiHint, null);
});

Deno.test("suggestForCard requests a hint for another same-spelling suffix", async () => {
  const card = await retargetingCard();
  for (const sense of card.latestWord!.sense) sense.partOfSpeech = ["n-suf"];
  const otherSuffix = makeWord({
    id: "2000000",
    senses: [{ glosses: ["a distinct suffix"], partOfSpeech: ["suf"] }],
  });
  let hintInput: HintGenerationInput | undefined;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!, otherSuffix],
    selectSenses: (input) => Promise.resolve(generated(selected(input.compatibleSenseNumbers))),
    generateHint: (input) => {
      hintInput = input;
      return Promise.resolve(generated({
        outcome: "generated" as const,
        semanticEvidenceSpan: "言葉のテスト",
        hintSourceSpan: "言葉のテスト",
        hint: "言葉のテスト",
      }));
    },
  });

  assertEquals(hintInput?.contrastingUsages, [{ entry: otherSuffix, senseNumbers: [1] }]);
  assertEquals(suggestion.aiHint, "言葉のテスト");
});

Deno.test("suggestForCard contrasts senses excluded only by the selected reading", async () => {
  const currentEntry = makeWord({
    kanji: ["言葉"],
    kana: ["ことば", "ことのは"],
    senses: [
      { glosses: ["term"] },
      { glosses: ["poetic language"] },
    ],
  });
  currentEntry.sense[1].appliesToKana = ["ことのは"];
  const previousEntry = structuredClone(currentEntry);
  previousEntry.sense[0].gloss[0].text = "word";
  const card = await analyzeCard(
    makeNote({
      key: "言葉 | 1000000:1",
      dictionary: renderDictionary(previousEntry),
      reading: "言[こと] 葉[ば]",
    }),
    entriesById(currentEntry),
  );
  let hintInput: HintGenerationInput | undefined;

  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [currentEntry],
    selectSenses: (input) => {
      assertEquals(input.compatibleSenseNumbers, [1]);
      return Promise.resolve(generated(selected(input.compatibleSenseNumbers)));
    },
    generateHint: (input) => {
      hintInput = input;
      return Promise.resolve(generated({
        outcome: "generated" as const,
        semanticEvidenceSpan: "言葉のテスト",
        hintSourceSpan: "言葉のテスト",
        hint: "言葉のテスト",
      }));
    },
  });

  assertEquals(hintInput, {
    context: "これは<mark>言葉</mark>のテストです。",
    recognitionTarget: "言葉",
    selectedUsage: { entry: currentEntry, senseNumbers: [1] },
    contrastingUsages: [{ entry: currentEntry, senseNumbers: [2] }],
  });
  assertEquals(suggestion.senses, [1]);
});

Deno.test("suggestForCard refreshes focused caches when explicitly forced", async () => {
  const card = await retargetingCard();
  let cacheMode: string | undefined;
  await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    force: true,
    selectSenses: (input, options) => {
      cacheMode = options?.cacheMode;
      return Promise.resolve(generated(selected(input.compatibleSenseNumbers)));
    },
  });
  assertEquals(cacheMode, "refresh");
});

Deno.test("suggestForCard rejects contextless cards before invoking AI", async () => {
  const card = await retargetingCard();
  card.note.fields.fullContext = "";
  let senseWasRequested = false;

  await assertRejects(
    () =>
      suggestForTest(card, {
        sameSpellingEntries: [card.latestWord!],
        selectSenses: (input) => {
          senseWasRequested = true;
          return Promise.resolve(generated(selected(input.compatibleSenseNumbers)));
        },
      }),
    Error,
    `Card ${card.note.noteId} has no Full context, so a source-grounded suggestion cannot be generated.`,
  );
  assertEquals(senseWasRequested, false);
});

Deno.test("suggestForCard rejects a usage matching no sense in the latest entry", async () => {
  const card = await retargetingCard();
  let hintWasRequested = false;

  await assertRejects(
    () =>
      suggestForTest(card, {
        sameSpellingEntries: [card.latestWord!],
        selectSenses: () => Promise.resolve(generated({ outcome: "no-match" as const })),
        generateHint: () => {
          hintWasRequested = true;
          return Promise.resolve(generated({ outcome: "not-needed" as const }));
        },
      }),
    Error,
    'Focused sense selection found no sense in latest JMDict entry "1000000" that matches recognition target "言葉"',
  );
  assertEquals(hintWasRequested, false);
});

Deno.test("suggestForCard rejects an ambiguous usage without generating a hint", async () => {
  const card = await retargetingCard();
  let hintWasRequested = false;

  await assertRejects(
    () =>
      suggestForTest(card, {
        sameSpellingEntries: [card.latestWord!],
        selectSenses: () =>
          Promise.resolve(generated({
            outcome: "ambiguous" as const,
            possibleSenseNumbers: [1, 2],
          })),
        generateHint: () => {
          hintWasRequested = true;
          return Promise.resolve(generated({ outcome: "not-needed" as const }));
        },
      }),
    Error,
    'Focused sense selection could not distinguish between possible senses [1,2] in latest JMDict entry "1000000" for recognition target "言葉"',
  );
  assertEquals(hintWasRequested, false);
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
      key: "言葉 | 1000000:1",
      dictionary: renderDictionary(previousEntry),
      reading: "言[こと] 葉[ば]",
    }),
    entriesById(currentEntry),
  );

  let hintWasRequested = false;
  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    selectSenses: (input) => {
      assertEquals(input.compatibleSenseNumbers, [1]);
      return Promise.resolve(generated(selected(input.compatibleSenseNumbers)));
    },
    generateHint: () => {
      hintWasRequested = true;
      return Promise.resolve(generated({ outcome: "not-needed" as const }));
    },
  });

  assertEquals(hintWasRequested, false);
  assertEquals(suggestion.senses, [1]);
  assertEquals(suggestedKey(card, suggestion.senses), "言葉 | 1000000:1");
});

Deno.test("suggestedKey rejects AI retargeting for multi-entry cards", async () => {
  const card = await retargetingCard();
  card.note.fields.key = "言葉 | 1000000:1;2000000:2";
  card.parsedKey = {
    spelling: "言葉",
    usages: [
      { jmdictId: "1000000", senseNumbers: [1] },
      { jmdictId: "2000000", senseNumbers: [2] },
    ],
  };

  assertThrows(
    () => suggestedKey(card, [2]),
    Error,
    "Multi-entry recognition cards require manual semantic review.",
  );
});

Deno.test("contextForPrompt preserves target markup and stored line breaks", () => {
  assertEquals(
    contextForPrompt("  一つ<mark>言[こと] 葉[ば]</mark><br><mark>言葉</mark>二つ  "),
    "一つ<mark>言葉</mark><br><mark>言葉</mark>二つ",
  );
});

Deno.test("suggestForCard proposes an unhinted card when source evidence cannot support a hint", async () => {
  const card = await retargetingCard();
  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    selectSenses: () => Promise.resolve(generated(selected([2]))),
    generateHint: () => Promise.resolve(generated({ outcome: "source-insufficient" as const })),
  });
  assertEquals(suggestion.senses, [2]);
  assertEquals(suggestion.aiHint, null);
  assertEquals(suggestion.defaultHint, null);
});

Deno.test("suggestForCard preserves an existing hint when focused generation needs no new one", async () => {
  const card = await retargetingCard();
  card.note.fields.hint = "既存の言葉";
  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    selectSenses: () => Promise.resolve(generated(selected([2]))),
    generateHint: () => Promise.resolve(generated({ outcome: "not-needed" as const })),
  });

  assertEquals(suggestion.aiHint, null);
  assertEquals(suggestion.defaultHint, "既存の言葉");
});

Deno.test("suggestForCard proposes an unhinted proper sense subset", async () => {
  const card = await retargetingCard();
  const suggestion = await suggestForTest(card, {
    sameSpellingEntries: [card.latestWord!],
    selectSenses: () => Promise.resolve(generated(selected([2]))),
    generateHint: () => Promise.resolve(generated({ outcome: "not-needed" as const })),
  });
  assertEquals(suggestion.senses, [2]);
  assertEquals(suggestion.aiHint, null);
  assertEquals(suggestion.defaultHint, null);
});
