import { assertEquals, assertRejects } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import type {
  GenerationResult,
  HintGenerationInput,
  SenseSelectionInput,
} from "card_field_generation";
import type { JMDictSpellingUsage } from "card_creator";
import { selectSensesAndMaybeGenerateHint } from "./focused_card_generation.ts";

function entry(): JMdictWord {
  return {
    id: "test",
    kanji: [{ common: true, text: "語", tags: [] }],
    kana: [{ common: true, text: "ご", tags: [], appliesToKanji: ["*"] }],
    sense: ["language", "word", "speech"].map((text) => ({
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
      gloss: [{ lang: "eng", gender: null, type: null, text }],
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

function input(): SenseSelectionInput {
  return {
    context: "言葉の<mark>語</mark>だ。",
    recognitionTarget: "語",
    jmdictEntry: entry(),
    compatibleSenseNumbers: [1, 2, 3],
  };
}

function focusedInput(
  senseSelection: SenseSelectionInput = input(),
  frontSideUsages: readonly JMDictSpellingUsage[] = [{
    entry: senseSelection.jmdictEntry,
    senseNumbers: [1, 2, 3],
  }],
) {
  return { senseSelection, frontSideUsages };
}

Deno.test("selectSensesAndMaybeGenerateHint validates card-front usages before generation", async (t) => {
  await t.step("missing selected entry", async () => {
    const senseSelection = input();
    const otherEntry = entry();
    otherEntry.id = "other";
    let selectionCalls = 0;
    await assertRejects(
      () =>
        selectSensesAndMaybeGenerateHint(
          {
            senseSelection,
            frontSideUsages: [{ entry: otherEntry, senseNumbers: [1, 2, 3] }],
          },
          {},
          {
            selectSenses: () => {
              ++selectionCalls;
              return Promise.resolve(generated({ outcome: "no-match" as const }));
            },
          },
        ),
      Error,
      'frontSideUsages does not contain selectedUsage.entry with id "test"',
    );
    assertEquals(selectionCalls, 0);
  });

  await t.step("duplicate selected entry", async () => {
    const senseSelection = input();
    let selectionCalls = 0;
    await assertRejects(
      () =>
        selectSensesAndMaybeGenerateHint(
          {
            senseSelection,
            frontSideUsages: [
              { entry: senseSelection.jmdictEntry, senseNumbers: [1, 2] },
              { entry: senseSelection.jmdictEntry, senseNumbers: [3] },
            ],
          },
          {},
          {
            selectSenses: () => {
              ++selectionCalls;
              return Promise.resolve(generated({ outcome: "no-match" as const }));
            },
          },
        ),
      Error,
      'frontSideUsages contains more than one usage for jmdictEntry with id "test"',
    );
    assertEquals(selectionCalls, 0);
  });

  await t.step("omitted compatible sense", async () => {
    const senseSelection = input();
    let selectionCalls = 0;
    await assertRejects(
      () =>
        selectSensesAndMaybeGenerateHint(
          {
            senseSelection,
            frontSideUsages: [{ entry: senseSelection.jmdictEntry, senseNumbers: [1, 2] }],
          },
          {},
          {
            selectSenses: () => {
              ++selectionCalls;
              return Promise.resolve(generated({ outcome: "no-match" as const }));
            },
          },
        ),
      Error,
      "selectedUsage.senseNumbers [1, 2, 3] includes sense(s) 3 not present",
    );
    assertEquals(selectionCalls, 0);
  });

  await t.step("invalid front-side sense", async () => {
    const senseSelection = input();
    let selectionCalls = 0;
    await assertRejects(
      () =>
        selectSensesAndMaybeGenerateHint(
          {
            senseSelection,
            frontSideUsages: [{ entry: senseSelection.jmdictEntry, senseNumbers: [1, 2, 4] }],
          },
          {},
          {
            selectSenses: () => {
              ++selectionCalls;
              return Promise.resolve(generated({ outcome: "no-match" as const }));
            },
          },
        ),
      Error,
      "frontSideUsages[0].senseNumbers [1, 2, 4] must contain one or more unique integers between 1 and 3",
    );
    assertEquals(selectionCalls, 0);
  });
});

Deno.test("selectSensesAndMaybeGenerateHint skips hint generation when all senses belong", async () => {
  let hintCalls = 0;
  let receivedModelId: string | undefined;
  const result = await selectSensesAndMaybeGenerateHint(focusedInput(), {}, {
    selectSenses: (_input, options) => {
      receivedModelId = options?.modelId;
      return Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1, 2, 3] }));
    },
    generateHint: () => {
      ++hintCalls;
      throw new Error("Unexpected hint generation");
    },
  });

  assertEquals(result.senseSelection, { outcome: "selected", senseNumbers: [1, 2, 3] });
  assertEquals(receivedModelId, undefined);
  assertEquals(result.hintOutcome, null);
  assertEquals(result.modelConfigurationIds, ["test"]);
  assertEquals(hintCalls, 0);
});

Deno.test("selectSensesAndMaybeGenerateHint contrasts the unselected compatible senses", async () => {
  let hintInput: HintGenerationInput | undefined;
  const generationInput = input();
  const result = await selectSensesAndMaybeGenerateHint(focusedInput(generationInput), {}, {
    selectSenses: () =>
      Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1, 3] })),
    generateHint: (input) => {
      hintInput = input;
      return Promise.resolve(generated({
        outcome: "generated" as const,
        semanticEvidenceSpan: "言葉の語",
        hintSourceSpan: "言葉の語",
        hint: "言葉の語",
      }));
    },
  });

  assertEquals(hintInput, {
    context: generationInput.context,
    recognitionTarget: "語",
    selectedUsage: { entry: generationInput.jmdictEntry, senseNumbers: [1, 3] },
    contrastingUsages: [{ entry: generationInput.jmdictEntry, senseNumbers: [2] }],
  });
  assertEquals(result.senseSelection, { outcome: "selected", senseNumbers: [1, 3] });
  assertEquals(result.hintOutcome, {
    outcome: "generated",
    semanticEvidenceSpan: "言葉の語",
    hintSourceSpan: "言葉の語",
    hint: "言葉の語",
  });
  assertEquals(result.modelConfigurationIds, ["test"]);
});

Deno.test("selectSensesAndMaybeGenerateHint preserves terminal outcomes without asking for a hint", async (t) => {
  for (
    const outcome of [
      { outcome: "no-match" as const },
      { outcome: "ambiguous" as const, possibleSenseNumbers: [1, 2] },
    ]
  ) {
    await t.step(outcome.outcome, async () => {
      let hintCalls = 0;
      const result = await selectSensesAndMaybeGenerateHint(focusedInput(), {}, {
        selectSenses: () => Promise.resolve(generated(outcome)),
        generateHint: () => {
          ++hintCalls;
          throw new Error("Unexpected hint generation");
        },
      });

      assertEquals(result.senseSelection, outcome);
      assertEquals(result.hintOutcome, null);
      assertEquals(result.modelConfigurationIds, ["test"]);
      assertEquals(hintCalls, 0);
    });
  }
});

Deno.test("selectSensesAndMaybeGenerateHint contrasts usages available only through the front", async () => {
  const senseSelection = input();
  const otherEntry = entry();
  otherEntry.id = "other";
  otherEntry.sense = [otherEntry.sense[1]];
  let hintInput: HintGenerationInput | undefined;

  const result = await selectSensesAndMaybeGenerateHint(
    focusedInput(senseSelection, [
      { entry: senseSelection.jmdictEntry, senseNumbers: [1, 2, 3] },
      { entry: otherEntry, senseNumbers: [1] },
    ]),
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1, 2, 3] })),
      generateHint: (input) => {
        hintInput = input;
        return Promise.resolve(generated({ outcome: "not-needed" as const }));
      },
    },
  );

  assertEquals(hintInput, {
    context: senseSelection.context,
    recognitionTarget: "語",
    selectedUsage: { entry: senseSelection.jmdictEntry, senseNumbers: [1, 2, 3] },
    contrastingUsages: [{ entry: otherEntry, senseNumbers: [1] }],
  });
  assertEquals(result.senseSelection, { outcome: "selected", senseNumbers: [1, 2, 3] });
  assertEquals(result.hintOutcome, { outcome: "not-needed" });
});

Deno.test("selectSensesAndMaybeGenerateHint contrasts selected-entry senses from another reading", async () => {
  const senseSelection = input();
  senseSelection.compatibleSenseNumbers = [1, 2];
  let hintInput: HintGenerationInput | undefined;

  await selectSensesAndMaybeGenerateHint(
    focusedInput(senseSelection, [{
      entry: senseSelection.jmdictEntry,
      senseNumbers: [1, 2, 3],
    }]),
    {},
    {
      selectSenses: () =>
        Promise.resolve(generated({ outcome: "selected" as const, senseNumbers: [1, 2] })),
      generateHint: (input) => {
        hintInput = input;
        return Promise.resolve(
          generated({
            outcome: "generated" as const,
            semanticEvidenceSpan: "語",
            hintSourceSpan: "語",
            hint: "言葉の語",
          }),
        );
      },
    },
  );

  assertEquals(hintInput?.selectedUsage.senseNumbers, [1, 2]);
  assertEquals(hintInput?.contrastingUsages, [{
    entry: senseSelection.jmdictEntry,
    senseNumbers: [3],
  }]);
});
