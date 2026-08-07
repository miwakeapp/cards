import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertRejects } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { preextractedJMDictEntry } from "data";
import type {
  GenerationResult,
  HintGenerationInput,
  SenseSelectionInput,
} from "card_field_generation";
import { generateJLPTCard } from "./generate_card.ts";

function entry({
  id = "1000000",
  kanji = [],
  kana,
  senses = 2,
}: {
  id?: string;
  kanji?: string[];
  kana: Array<{ text: string; common?: boolean; tags?: string[] }>;
  senses?: number;
}): JMdictWord {
  return {
    id,
    kanji: kanji.map((text) => ({ common: true, text, tags: [] })),
    kana: kana.map(({ text, common = false, tags = [] }) => ({
      common,
      text,
      tags,
      appliesToKanji: ["*"],
    })),
    sense: Array.from({ length: senses }, (_, index) => ({
      partOfSpeech: ["n"],
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [{ lang: "eng", gender: null, type: null, text: `sense ${index + 1}` }],
    })),
  };
}

function generated<T>(value: T): GenerationResult<T> {
  const usage = {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  return {
    value,
    metadata: {
      operation: "test",
      cacheKey: "test",
      cacheStatus: "miss",
      modelConfigurationId: "test",
      attempts: [],
      latencyMilliseconds: 0,
      usage,
      sourceUsage: usage,
      fingerprints: {
        basePrompt: "test",
        stablePrompt: "test",
        schema: "test",
        configuration: "test",
      },
    },
  };
}

Deno.test("generateJLPTCard marks every occurrence and uses focused sense and hint operations", async () => {
  const word = entry({ kana: [{ text: "かな", common: true }] });
  let senseInput: SenseSelectionInput | undefined;
  let hintInput: HintGenerationInput | undefined;
  let senseModelId: string | undefined;
  let hintModelId: string | undefined;
  const card = await generateJLPTCard(
    {
      sentence: "かなとかなを比べる。",
      source: "テスト",
      recognitionTarget: "かな",
      entry: word,
      sameSpellingEntries: [word],
    },
    {},
    {
      selectSenses: (input, options) => {
        senseInput = input;
        senseModelId = options?.modelId;
        return Promise.resolve(
          generated({ outcome: "selected" as const, senseNumbers: [2] }),
        );
      },
      generateHint: (input, options) => {
        hintInput = input;
        hintModelId = options?.modelId;
        return Promise.resolve(generated({
          outcome: "generated" as const,
          semanticEvidenceSpan: "かなを比べる",
          hintSourceSpan: "かなを比べる",
          hint: "かなを比べる",
        }));
      },
    },
  );

  assertEquals(senseInput?.context, "<mark>かな</mark>と<mark>かな</mark>を比べる。");
  assertEquals(senseModelId, undefined);
  assertEquals(hintModelId, undefined);
  assertEquals(hintInput?.selectedUsage, { entry: word, senseNumbers: [2] });
  assertEquals(hintInput?.contrastingUsages, [{ entry: word, senseNumbers: [1] }]);
  assertEquals(card.key, "かな | 1000000:2");
  assertEquals(card.hint, "かなを比べる");
  assertEquals(card.source, '<span lang="ja">テスト</span>');
});

Deno.test("generateJLPTCard hints a same-spelling entry even when every selected-entry sense applies", async () => {
  const selectedEntry = entry({
    id: "1000000",
    kana: [{ text: "かな", common: true }],
    senses: 1,
  });
  const contrastingEntry = entry({
    id: "2000000",
    kana: [{ text: "かな", common: true }],
    senses: 1,
  });
  let hintInput: HintGenerationInput | undefined;

  const card = await generateJLPTCard(
    {
      sentence: "かなを比べる。",
      source: "",
      recognitionTarget: "かな",
      entry: selectedEntry,
      sameSpellingEntries: [selectedEntry, contrastingEntry],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
      generateHint: (input) => {
        hintInput = input;
        return Promise.resolve(generated({
          outcome: "generated" as const,
          semanticEvidenceSpan: "かなを比べる",
          hintSourceSpan: "かなを比べる",
          hint: "かなを比べる",
        }));
      },
    },
  );

  assertEquals(hintInput?.selectedUsage, { entry: selectedEntry, senseNumbers: [1] });
  assertEquals(hintInput?.contrastingUsages, [{ entry: contrastingEntry, senseNumbers: [1] }]);
  assertEquals(card.key, "かな | 1000000");
  assertEquals(card.hint, "かなを比べる");
});

Deno.test("generateJLPTCard treats a unique suffix marker as sufficient disambiguation", async () => {
  const selectedSuffix = entry({
    id: "1000000",
    kana: [{ text: "ヅラ", common: true }],
    senses: 1,
  });
  selectedSuffix.sense[0].partOfSpeech = ["n-suf"];
  const noun = entry({
    id: "2000000",
    kana: [{ text: "ヅラ", common: true }],
    senses: 1,
  });
  let hintCalls = 0;

  const card = await generateJLPTCard(
    {
      sentence: "野武士ヅラをする。",
      source: "",
      recognitionTarget: "ヅラ",
      entry: selectedSuffix,
      sameSpellingEntries: [selectedSuffix, noun],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
      generateHint: () => {
        ++hintCalls;
        throw new Error("Unexpected hint generation");
      },
    },
  );

  assertEquals(hintCalls, 0);
  assertEquals(card.recognitionTarget, "～ヅラ");
  assertEquals(card.hint, null);
});

Deno.test("generateJLPTCard hints another suffix despite the shared suffix marker", async () => {
  const selectedSuffix = entry({
    id: "1000000",
    kana: [{ text: "ヅラ", common: true }],
    senses: 1,
  });
  selectedSuffix.sense[0].partOfSpeech = ["n-suf"];
  const otherSuffix = entry({
    id: "2000000",
    kana: [{ text: "ヅラ", common: true }],
    senses: 1,
  });
  otherSuffix.sense[0].partOfSpeech = ["suf"];
  let hintInput: HintGenerationInput | undefined;

  const card = await generateJLPTCard(
    {
      sentence: "野武士ヅラをする。",
      source: "",
      recognitionTarget: "ヅラ",
      entry: selectedSuffix,
      sameSpellingEntries: [selectedSuffix, otherSuffix],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
      generateHint: (input) => {
        hintInput = input;
        return Promise.resolve(generated({
          outcome: "generated" as const,
          semanticEvidenceSpan: "野武士ヅラ",
          hintSourceSpan: "野武士ヅラ",
          hint: "野武士ヅラ",
        }));
      },
    },
  );

  assertEquals(hintInput?.contrastingUsages, [{ entry: otherSuffix, senseNumbers: [1] }]);
  assertEquals(card.recognitionTarget, "～ヅラ");
  assertEquals(card.hint, "野武士ヅラ");
});

Deno.test("generateJLPTCard uses source ruby to select an otherwise ambiguous reading", async () => {
  const word = entry({
    kanji: ["猫"],
    kana: [{ text: "ねこ" }, { text: "びょう" }],
    senses: 1,
  });
  const card = await generateJLPTCard(
    {
      sentence: "<ruby>猫<rt>ねこ</rt></ruby>だ。",
      source: "",
      recognitionTarget: "猫",
      entry: word,
      sameSpellingEntries: [word],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
    },
  );

  assertEquals(card.reading, "猫[ねこ]");
  assertEquals(card.fullContext, "<mark>猫[ねこ]</mark>だ。");
});

Deno.test("generateJLPTCard lets source ruby select a nokanji reading", async () => {
  const word = entry({
    kanji: ["糞"],
    kana: [{ text: "フン" }],
    senses: 1,
  });
  word.kana[0].appliesToKanji = [];
  const card = await generateJLPTCard(
    {
      sentence: "犬の<ruby>糞<rt>フン</rt></ruby>を片づける。",
      source: "",
      recognitionTarget: "糞",
      entry: word,
      sameSpellingEntries: [word],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
    },
  );

  assertEquals(card.reading, "糞[フン]");
});

Deno.test("generateJLPTCard fails closed on an ambiguous unannotated reading", async () => {
  const word = entry({
    kanji: ["猫"],
    kana: [{ text: "ねこ" }, { text: "びょう" }],
    senses: 1,
  });
  await assertRejects(
    () =>
      generateJLPTCard(
        {
          sentence: "猫だ。",
          source: "",
          recognitionTarget: "猫",
          entry: word,
          sameSpellingEntries: [word],
        },
        {},
        {
          selectSenses: () =>
            Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
        },
      ),
    Error,
    'does not uniquely determine kanaReading for recognitionTarget "猫"',
  );
});

Deno.test("generateJLPTCard minimizes only long contexts", async () => {
  let minimizeCalls = 0;
  const word = entry({
    kanji: ["猫"],
    kana: [{ text: "ねこ", common: true }],
    senses: 1,
  });
  const card = await generateJLPTCard(
    {
      sentence: `これは${"とても".repeat(20)}長い<ruby>猫<rt>ねこ</rt></ruby>の文だ。`,
      source: "",
      recognitionTarget: "猫",
      entry: word,
      sameSpellingEntries: [word],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
      minimize: (input) => {
        ++minimizeCalls;
        assertEquals(input.fullContext.includes("<mark>"), true);
        return Promise.resolve(
          generated("<mark><ruby>猫<rt>ねこ</rt></ruby></mark>の文だ。"),
        );
      },
    },
  );

  assertEquals(minimizeCalls, 1);
  assertEquals(card.minimizedContext, "<mark>猫[ねこ]</mark>の文だ。");
});

Deno.test("generateJLPTCard rejects an alternate kana-script surface", async () => {
  const word = entry({ kana: [{ text: "かな", common: true }], senses: 1 });
  await assertRejects(
    () =>
      generateJLPTCard(
        {
          sentence: "カナを比べる。",
          source: "",
          recognitionTarget: "かな",
          entry: word,
          sameSpellingEntries: [word],
        },
        {},
        {
          selectSenses: () =>
            Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
        },
      ),
    Error,
    `changed the kana script of recognitionTarget "かな" to source surface "カナ"`,
  );
});

Deno.test("generateJLPTCard does not guess a common reading without source ruby", async () => {
  const cotton = await preextractedJMDictEntry("1534870");
  await assertRejects(
    () =>
      generateJLPTCard(
        {
          sentence: "木綿を育てる。",
          source: "",
          recognitionTarget: "木綿",
          entry: cotton,
          sameSpellingEntries: [cotton],
        },
        {},
        {
          selectSenses: () =>
            Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
        },
      ),
    Error,
    `does not uniquely determine kanaReading for recognitionTarget "木綿"`,
  );
});

Deno.test("generateJLPTCard creates an unhinted proper sense subset", async () => {
  const word = entry({ kana: [{ text: "かな", common: true }] });
  const card = await generateJLPTCard(
    {
      sentence: "かなを比べる。",
      source: "",
      recognitionTarget: "かな",
      entry: word,
      sameSpellingEntries: [word],
    },
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1] })),
      generateHint: () => Promise.resolve(generated({ outcome: "not-needed" as const })),
    },
  );
  assertEquals(card.key, "かな | 1000000:1");
  assertEquals(card.hint, null);
});

Deno.test("generateJLPTCard distinguishes semantic ambiguity from no matching sense", async (t) => {
  const word = entry({ kana: [{ text: "かな", common: true }] });
  const input = {
    sentence: "かなを比べる。",
    source: "",
    recognitionTarget: "かな",
    entry: word,
    sameSpellingEntries: [word],
  };

  await t.step("ambiguous", async () => {
    await assertRejects(
      () =>
        generateJLPTCard(input, {}, {
          selectSenses: () =>
            Promise.resolve(generated({
              outcome: "ambiguous" as const,
              possibleSenseNumbers: [1, 2],
            })),
        }),
      Error,
      'does not distinguish possible senses [1,2] for recognitionTarget "かな"',
    );
  });

  await t.step("no-match", async () => {
    await assertRejects(
      () =>
        generateJLPTCard(input, {}, {
          selectSenses: () => Promise.resolve(generated({ outcome: "no-match" as const })),
        }),
      Error,
      'No sense in jmdictEntry with id "1000000" applies',
    );
  });
});
