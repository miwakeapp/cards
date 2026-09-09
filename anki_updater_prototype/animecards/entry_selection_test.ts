import "../../data/test/use_jmdict_fixtures.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { buildSpellingIndex } from "card_resolution";
import { assertReadingSelectionInput } from "card_field_generation/eval-metadata";
import { convertAnimecardsNote } from "./convert.ts";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import type {
  GenerationResult,
  HintGenerationInput,
  HintGenerationOutcome,
  ModelId,
  SenseSelectionInput,
  SenseSelectionOutcome,
} from "card_field_generation";
import {
  type EntrySelectionDependencies,
  entrySelectionOverride,
  type JMDictEntrySelectionOverride,
  selectJMDictEntry,
  type UnresolvedJMDictEntry,
} from "./entry_selection.ts";

async function renderSelection(
  input: UnresolvedJMDictEntry,
  selection: JMDictEntrySelectionOverride,
) {
  const values = {
    Word: input.recognitionTarget,
    Reading: input.kanaReading,
    Sentence: input.fullContext,
    Glossary: `<a href="https://jitendex.org/?q=${selection.jmdictId}">definition</a>`,
    Source: "Test Book",
  };
  const entries = new Map(input.candidateEntries.map((entry) => [entry.id, entry]));
  const result = await convertAnimecardsNote({
    noteId: 42,
    modelName: "Animecards",
    tags: [],
    cards: [99],
    fields: Object.fromEntries(
      Object.entries(values).map(([name, value], order) => [name, { value, order }]),
    ),
  }, {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {
      word: "Word",
      sentence: "Sentence",
      glossary: "Glossary",
      reading: "Reading",
      source: "Source",
      sourceURL: null,
    },
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
    jmdictEntrySelectionOverride: selection,
  });
  assert(result.candidate, JSON.stringify(result.skipped));
  return result.candidate;
}

const MODEL_OPTIONS = { modelId: "gemini-3.6-flash" as const };

function generated<T>(value: T, modelConfigurationId = "test"): GenerationResult<T> {
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
      modelConfigurationId,
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

function generatedHint(hint: string): HintGenerationOutcome {
  return { outcome: "generated", semanticEvidenceSpan: hint, hintSourceSpan: hint, hint };
}

function dependencies(
  select: (input: SenseSelectionInput) => SenseSelectionOutcome,
  hint: (input: HintGenerationInput) => HintGenerationOutcome = () => generatedHint("前世の業"),
): EntrySelectionDependencies {
  return {
    selectSenses: (input) => Promise.resolve(generated(select(input))),
    generateHint: (input) => Promise.resolve(generated(hint(input))),
    selectReadings: (input) =>
      Promise.resolve(
        generated({
          decisions: input.alternatives.map(({ kanaReading }) => ({
            kanaReading,
            decision: "include" as const,
            rationale: "Suitable alternative.",
          })),
        }),
      ),
    getReadingEvidence: (_spelling, kanaReading) =>
      Promise.resolve({ kanaReading, bccwjFrequencyPerMillion: null }),
  };
}

function entry(id: string, glosses: string[]): JMdictWord {
  return {
    id,
    kanji: [{ common: true, text: "業", tags: [] }],
    kana: [{
      common: true,
      text: id === "1111111" ? "ごう" : "わざ",
      tags: [],
      appliesToKanji: ["*"],
    }],
    sense: glosses.map((text) => ({
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
  } as JMdictWord;
}

function request(
  {
    allowedJMDictIds = ["1111111", "2222222"],
    kanaReading = "ごう",
    kanaReadingEvidence = "animecard",
    candidateEntries = [
      entry("2222222", ["work", "performance"]),
      entry("1111111", ["karma"]),
    ],
  }: {
    allowedJMDictIds?: string[];
    kanaReading?: string;
    kanaReadingEvidence?: UnresolvedJMDictEntry["kanaReadingEvidence"];
    candidateEntries?: JMdictWord[];
  } = {},
): UnresolvedJMDictEntry {
  return {
    context: "それは前世の業だ。",
    fullContext: "それは前世の業だ。",
    recognitionTarget: "業",
    kanaReading,
    kanaReadingEvidence,
    // Deliberately reversed: combined sense numbering must be stable by entry ID.
    candidateEntries,
    allowedJMDictIds,
  };
}

Deno.test("selectJMDictEntry maps combined senses back to one entry", async () => {
  const result = await selectJMDictEntry(
    request(),
    MODEL_OPTIONS,
    dependencies((input) => {
      assertEquals(input.context, "それは前世の<mark>業</mark>だ。");
      assertEquals(input.jmdictEntry.id, "entry-selection:1111111,2222222");
      assertEquals(input.jmdictEntry.sense.length, 3);
      assertEquals(input.compatibleSenseNumbers, [1, 2, 3]);
      // Combined sense 1 is entry 1111111 sense 1.
      return { outcome: "selected", senseNumbers: [1] };
    }),
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111", "2222222"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry filters spelling-restricted senses from selection and hints", async () => {
  const selectedEntry = entry("1111111", ["karma", "skill", "fate"]);
  selectedEntry.kanji.push({ common: false, text: "技", tags: [] });
  selectedEntry.sense[0].appliesToKanji = ["業"];
  selectedEntry.sense[1].appliesToKanji = ["技"];
  const contrastingEntry = entry("2222222", ["work", "technique"]);
  contrastingEntry.kanji.push({ common: false, text: "技", tags: [] });
  contrastingEntry.sense[0].appliesToKanji = ["業"];
  contrastingEntry.sense[1].appliesToKanji = ["技"];

  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [contrastingEntry, selectedEntry],
    }),
    MODEL_OPTIONS,
    dependencies(
      (input) => {
        assertEquals(
          input.jmdictEntry.sense.map(({ gloss }) => gloss[0].text),
          ["karma", "fate"],
        );
        assertEquals(input.compatibleSenseNumbers, [1, 2]);
        // Combined sense 2 maps back to selected-entry sense 3, not filtered-out sense 2.
        return { outcome: "selected", senseNumbers: [2] };
      },
      (input) => {
        assertEquals(input.selectedUsage, { entry: selectedEntry, senseNumbers: [3] });
        assertEquals(input.contrastingUsages, [
          { entry: selectedEntry, senseNumbers: [1] },
          { entry: contrastingEntry, senseNumbers: [1] },
        ]);
        return generatedHint("前世の業");
      },
    ),
  );

  assertEquals(result.status, "selected");
  if (result.status === "selected") {
    assertEquals(result.applicableSenseNumbers, [3]);
  }
});

Deno.test("selectJMDictEntry contrasts alternate readings hidden on the card back", async () => {
  const selectedEntry = entry("1111111", ["karma", "deed"]);
  selectedEntry.kana.push({
    common: false,
    text: "わざ",
    tags: [],
    appliesToKanji: ["*"],
  });
  selectedEntry.sense[0].appliesToKana = ["ごう"];
  selectedEntry.sense[1].appliesToKana = ["わざ"];
  const contrastingEntry = entry("2222222", ["work"]);

  await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [contrastingEntry, selectedEntry],
    }),
    MODEL_OPTIONS,
    dependencies(
      (input) => {
        assertEquals(
          input.jmdictEntry.sense.map(({ gloss }) => gloss[0].text),
          ["karma"],
        );
        return { outcome: "selected", senseNumbers: [1] };
      },
      (input) => {
        assertEquals(input.selectedUsage, { entry: selectedEntry, senseNumbers: [1] });
        assertEquals(input.contrastingUsages, [
          { entry: selectedEntry, senseNumbers: [2] },
          { entry: contrastingEntry, senseNumbers: [1] },
        ]);
        return generatedHint("前世の業");
      },
    ),
  );
});

Deno.test("selectJMDictEntry keeps all target-applicable readings in the broad pass", async () => {
  const candidate = entry("1111111", ["karma", "deed"]);
  candidate.kana.push({
    common: false,
    text: "わざ",
    tags: [],
    appliesToKanji: ["*"],
  });
  candidate.sense[0].appliesToKana = ["ごう"];
  candidate.sense[1].appliesToKana = ["わざ"];

  const result = await selectJMDictEntry(
    request({ candidateEntries: [candidate] }),
    MODEL_OPTIONS,
    dependencies((input) => {
      assertEquals(
        input.jmdictEntry.sense.map(({ gloss }) => gloss[0].text),
        ["karma", "deed"],
      );
      assertEquals(input.compatibleSenseNumbers, [1, 2]);
      return { outcome: "no-match" };
    }),
  );

  assertEquals(result, { status: "no-match", modelConfigurationIds: ["test"] });
});

Deno.test("selectJMDictEntry reports no match when restrictions eliminate every sense", async () => {
  const candidate = entry("1111111", ["skill"]);
  candidate.kanji.push({ common: false, text: "技", tags: [] });
  candidate.sense[0].appliesToKanji = ["技"];
  let selectionCalls = 0;

  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [candidate],
    }),
    MODEL_OPTIONS,
    dependencies(() => {
      ++selectionCalls;
      return { outcome: "no-match" };
    }),
  );

  assertEquals(result, { status: "no-match", modelConfigurationIds: [] });
  assertEquals(selectionCalls, 0);
});

Deno.test("selectJMDictEntry preserves focused defaults and actual operation provenance", async () => {
  let senseModelId: ModelId | undefined;
  let hintModelId: ModelId | undefined;
  const result = await selectJMDictEntry(request(), {}, {
    selectSenses: (_input, options) => {
      senseModelId = options?.modelId;
      return Promise.resolve(generated(
        { outcome: "selected" as const, senseNumbers: [1] },
        "sense-production@medium",
      ));
    },
    generateHint: (_input, options) => {
      hintModelId = options?.modelId;
      return Promise.resolve(generated(
        generatedHint("前世の業"),
        "hint-production@low",
      ));
    },
  });

  assertEquals(senseModelId, undefined);
  assertEquals(hintModelId, undefined);
  assertEquals(result.modelConfigurationIds, [
    "sense-production@medium",
    "hint-production@low",
  ]);
  if (result.status !== "selected") throw new Error(`Expected selected, got ${result.status}`);
  assertEquals(result.model, "sense-production@medium, hint-production@low");
});

Deno.test("selectJMDictEntry reports no semantic match", async () => {
  const result = await selectJMDictEntry(
    request(),
    MODEL_OPTIONS,
    dependencies(() => ({ outcome: "no-match" })),
  );
  assertEquals(result, { status: "no-match", modelConfigurationIds: ["test"] });
});

Deno.test("selectJMDictEntry defers senses spanning several entries", async () => {
  const second = entry("2222222", ["work", "performance"]);
  second.kana[0].text = "ごう";
  const result = await selectJMDictEntry(
    request({
      candidateEntries: [second, entry("1111111", ["karma"])],
    }),
    MODEL_OPTIONS,
    dependencies((input) => ({
      outcome: "selected",
      senseNumbers: [...input.compatibleSenseNumbers],
    })),
  );
  assertEquals(result, {
    status: "ambiguous",
    possibleJMDictIds: ["1111111", "2222222"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry accepts equivalent senses with a unique reading anchor", async () => {
  const result = await selectJMDictEntry(
    request(),
    MODEL_OPTIONS,
    dependencies((input) => ({
      outcome: "selected",
      senseNumbers: [...input.compatibleSenseNumbers],
    })),
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: null,
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111", "2222222"],
    additionalAcceptedReadings: [{
      jmdictId: "2222222",
      kanaReading: "わざ",
      applicableSenseNumbers: [1, 2],
    }],
    readingDecisions: [{
      jmdictId: "2222222",
      kanaReading: "わざ",
      decision: "include",
      rationale: "Suitable alternative.",
    }],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("後継 can omit an unsuitable cross-entry reading from all rendered fields", async () => {
  const input: UnresolvedJMDictEntry = {
    context:
      "桂太郎が組織を準備していた立憲同志会、その後継政党である憲政会、そのまた後継である民政党に属して、政党を支えた政治家でもあった。",
    fullContext:
      "桂太郎が組織を準備していた立憲同志会、その後継政党である憲政会、そのまた後継である民政党に属して、政党を支えた政治家でもあった。",
    recognitionTarget: "後継",
    kanaReading: "こうけい",
    kanaReadingEvidence: "animecard",
    candidateEntries: [
      await preextractedJMDictEntry("1269590"),
      await preextractedJMDictEntry("1383690"),
    ],
    allowedJMDictIds: ["1269590"],
  };
  const result = await selectJMDictEntry(input, {}, {
    ...dependencies(() => ({ outcome: "selected", senseNumbers: [1, 2, 3, 4] }), () => {
      throw new Error("Equivalent meanings do not require a fabricated hint");
    }),
    selectReadings: (readingInput, options) => {
      assertEquals(options, {});
      assertEquals(readingInput.jmdictEntry.id, "1269590");
      assertEquals(readingInput.encountered.kanaReading, "こうけい");
      assertEquals(readingInput.alternativeUsage?.entry.id, "1383690");
      assertEquals(readingInput.alternativeUsage?.senseNumbers, [1, 2]);
      assertEquals(readingInput.alternatives, [{
        kanaReading: "あとつぎ",
        bccwjFrequencyPerMillion: null,
      }]);
      return Promise.resolve(
        generated({
          decisions: [{
            kanaReading: "あとつぎ",
            decision: "omit",
            rationale: "Not suitable for 後継政党.",
          }],
        }, "reading-model@medium"),
      );
    },
  });
  assert(result.status === "selected");
  assertEquals(result.additionalAcceptedReadings, undefined);
  assertEquals(result.modelConfigurationIds, ["test", "reading-model@medium"]);
  const card = await renderSelection(input, result);
  assertEquals(card.target.fields.Key, "後継 | 1269590");
  assertEquals(card.target.fields.Reading, "後[こう] 継[けい]");
  assertEquals((card.target.fields.Dictionary.match(/miwake-dictionary-entry/g) ?? []).length, 1);
  assertEquals(card.target.fields.Dictionary.includes("inheritor"), false);
  assertEquals(entrySelectionOverride(card)?.readingDecisions, result.readingDecisions);
});

Deno.test("後々 retains useful cross-entry readings and both dictionaries", async () => {
  const input: UnresolvedJMDictEntry = {
    context: "後々困ることになる。",
    fullContext: "後々困ることになる。",
    recognitionTarget: "後々",
    kanaReading: "あとあと",
    kanaReadingEvidence: "animecard",
    candidateEntries: [
      await preextractedJMDictEntry("1578610"),
      await preextractedJMDictEntry("2841372"),
    ],
    allowedJMDictIds: ["1578610"],
  };
  const result = await selectJMDictEntry(input, {}, {
    ...dependencies(() => ({ outcome: "selected", senseNumbers: [1, 2] })),
    selectReadings: (readingInput) => {
      assertEquals(readingInput.alternativeUsage?.entry.id, "2841372");
      assertEquals(readingInput.alternatives[0].kanaReading, "のちのち");
      return Promise.resolve(
        generated({
          decisions: [{
            kanaReading: "のちのち",
            decision: "include",
            rationale: "Ordinary equivalent pronunciation.",
          }],
        }),
      );
    },
  });
  assert(result.status === "selected");
  const card = await renderSelection(input, result);
  assertEquals(card.target.fields.Key, "後々 | 1578610;2841372");
  assertEquals(
    card.target.fields.Reading,
    "<ul><li>後[あと] 々[あと]</li><li>後[のち] 々[のち]</li></ul>",
  );
  assertEquals((card.target.fields.Dictionary.match(/miwake-dictionary-entry/g) ?? []).length, 2);
});

Deno.test("樺 sends かば/カバ to reading selection as one pronunciation", async () => {
  const entry = await preextractedJMDictEntry("1208890");
  let calls = 0;
  const result = await selectJMDictEntry(
    {
      context: "樺の木。",
      fullContext: "樺の木。",
      recognitionTarget: "樺",
      kanaReading: "かんば",
      kanaReadingEvidence: "animecard",
      candidateEntries: [entry],
      allowedJMDictIds: [entry.id],
    },
    {},
    {
      ...dependencies(() => ({ outcome: "selected", senseNumbers: [1] })),
      selectReadings: async (input) => {
        ++calls;
        // The dictionary entry is unmodified: both かば and カバ are eligible for 樺.
        // Exercise the real validator, which rejects script-equivalent duplicate alternatives.
        await assertReadingSelectionInput(input);
        assertEquals(input.encountered.kanaReading, "かんば");
        assertEquals(input.alternatives, [{ kanaReading: "かば", bccwjFrequencyPerMillion: null }]);
        return generated({
          decisions: [{
            kanaReading: "かば",
            decision: "include",
            rationale: "Useful alternative.",
          }],
        });
      },
    },
  );
  assertEquals(calls, 1);
  assert(result.status === "selected");
  assertEquals(result.additionalAcceptedReadings, [{
    jmdictId: "1208890",
    kanaReading: "かば",
    applicableSenseNumbers: [1],
  }]);
});

Deno.test("entry selection fails closed when reading selection fails", async () => {
  await assertRejects(
    () =>
      selectJMDictEntry(request(), {}, {
        ...dependencies(() => ({ outcome: "selected", senseNumbers: [1, 2, 3] })),
        selectReadings: () => Promise.reject(new Error("reading judgment failed")),
      }),
    Error,
    "reading judgment failed",
  );
});

Deno.test("an omitted same-entry reading is not rescheduled during conversion replay", async () => {
  const first = entry("1111111", ["karma"]);
  first.kana.push({ common: false, text: "ぎょう", tags: [], appliesToKanji: ["*"] });
  const input = request({ candidateEntries: [first, entry("2222222", ["work"])] });
  const result = await selectJMDictEntry(input, {}, {
    ...dependencies(() => ({ outcome: "selected", senseNumbers: [1] })),
    selectReadings: () =>
      Promise.resolve(
        generated({
          decisions: [{ kanaReading: "ぎょう", decision: "omit", rationale: "Not useful here." }],
        }),
      ),
  });
  assert(result.status === "selected");
  const card = await renderSelection(input, result);
  assertEquals(card.readingResolution, { status: "not-needed" });
  assertEquals(card.target.fields.Reading, "業[ごう]");
  const replay = entrySelectionOverride(card);
  assert(replay);
  const replayedCard = await renderSelection(input, replay);
  assertEquals(replayedCard.readingResolution, { status: "not-needed" });
  assertEquals(replayedCard.target.fields.Reading, "業[ごう]");
});

Deno.test("rare cross-entry alternatives are rejected before paid reading selection", async () => {
  const second = entry("2222222", ["karma"]);
  second.kana[0].tags = ["rk"];
  const result = await selectJMDictEntry(
    request({ candidateEntries: [entry("1111111", ["karma"]), second] }),
    {},
    {
      ...dependencies(() => ({ outcome: "selected", senseNumbers: [1, 2] })),
      selectReadings: () => {
        throw new Error("Rare alternatives must be filtered first");
      },
    },
  );
  assert(result.status === "selected");
  assertEquals(result.additionalAcceptedReadings, undefined);
  assertEquals(result.readingDecisions, [{
    jmdictId: "2222222",
    kanaReading: "わざ",
    decision: "omit",
    rationale: "JMDict reading tags: rk.",
  }]);
});

Deno.test("source-supported rare readings survive in every equivalent entry", async () => {
  const first = entry("1111111", ["karma"]);
  const second = entry("2222222", ["karma"]);
  first.kana[0].tags = ["rk"];
  second.kana[0].text = "ごう";
  second.kana[0].tags = ["rk"];
  const result = await selectJMDictEntry(
    request({
      candidateEntries: [first, second],
      allowedJMDictIds: [first.id],
      kanaReadingEvidence: "source-ruby",
    }),
    {},
    {
      ...dependencies(() => ({ outcome: "selected", senseNumbers: [1, 2] })),
      selectReadings: () => {
        throw new Error("The source-supported pronunciation must not be judged");
      },
    },
  );
  assert(result.status === "selected");
  assertEquals(result.additionalAcceptedReadings, [{
    jmdictId: second.id,
    kanaReading: "ごう",
    applicableSenseNumbers: [1],
  }]);
});

Deno.test("selectJMDictEntry does not override a same-reading unlinked choice", async () => {
  let calls = 0;
  const unlinked = entry("1111111", ["karma"]);
  unlinked.kana[0].text = "わざ";
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["2222222"],
      kanaReading: "わざ",
      candidateEntries: [
        entry("2222222", ["work", "performance"]),
        unlinked,
      ],
    }),
    MODEL_OPTIONS,
    dependencies((input) => {
      ++calls;
      if (calls === 1) {
        // Both entries have the same reading, but the broad comparison still overcalls the
        // semantically related unlinked entry.
        return { outcome: "selected", senseNumbers: [1] };
      }
      throw new Error(`Unexpected retry with ${input.jmdictEntry.id}`);
    }),
  );
  assertEquals(result, {
    status: "disallowed",
    selectedJMDictId: "1111111",
    modelConfigurationIds: ["test"],
  });
  assertEquals(calls, 1);
});

Deno.test("selectJMDictEntry rejects a selected entry incompatible with the Animecard reading", async () => {
  const result = await selectJMDictEntry(
    request({ allowedJMDictIds: ["2222222"] }),
    MODEL_OPTIONS,
    dependencies(
      () => ({ outcome: "selected", senseNumbers: [2, 3] }),
      () => generatedHint("職人の業"),
    ),
  );
  assertEquals(result, {
    status: "reading-conflict",
    selectedJMDictId: "2222222",
    compatibleReadings: ["わざ"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry does not treat nokanji as a reading conflict", async () => {
  const candidate = entry("1111111", ["karma"]);
  candidate.kana[0].appliesToKanji = [];
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      candidateEntries: [candidate],
    }),
    MODEL_OPTIONS,
    dependencies(() => ({ outcome: "selected", senseNumbers: [1] })),
  );

  assertEquals(result.status, "selected");
  if (result.status === "selected") {
    assertEquals(result.jmdictId, "1111111");
    assertEquals(result.applicableSenseNumbers, [1]);
  }
});

Deno.test("selectJMDictEntry rechecks a linked entry after a reading-incompatible choice", async () => {
  let calls = 0;
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["2222222"],
      kanaReading: "わざ",
    }),
    MODEL_OPTIONS,
    dependencies((input) => {
      ++calls;
      if (calls === 1) {
        // Combined sense 1 belongs to the unlinked entry with reading ごう.
        return { outcome: "selected", senseNumbers: [1] };
      }
      assertEquals(input.jmdictEntry.id, "entry-selection:2222222");
      return { outcome: "selected", senseNumbers: [1] };
    }, (input) => {
      return generatedHint(
        input.selectedUsage.entry.id === "2222222" ? "職人の業" : "前世の業",
      );
    }),
  );
  assertEquals(result, {
    status: "selected",
    jmdictId: "2222222",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "職人の業",
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["2222222"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry applies source ruby before semantic selection", async () => {
  const selectedEntry = entry("1111111", ["karma", "fate"]);
  const contrastingEntry = entry("2222222", ["work", "performance"]);
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [
        contrastingEntry,
        selectedEntry,
      ],
    }),
    MODEL_OPTIONS,
    dependencies(
      (input) => {
        assertEquals(input.jmdictEntry.id, "entry-selection:1111111");
        assertEquals(input.jmdictEntry.sense.length, 2);
        return { outcome: "selected", senseNumbers: [1] };
      },
      (input) => {
        assertEquals(input.selectedUsage, { entry: selectedEntry, senseNumbers: [1] });
        assertEquals(input.contrastingUsages, [
          { entry: selectedEntry, senseNumbers: [2] },
          {
            entry: contrastingEntry,
            senseNumbers: [1, 2],
          },
        ]);
        return generatedHint("前世の業");
      },
    ),
  );
  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry creates an unhinted card when no useful hint exists", async () => {
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
    }),
    MODEL_OPTIONS,
    dependencies(
      (input) => ({
        outcome: "selected",
        senseNumbers: [...input.compatibleSenseNumbers],
      }),
      () => ({ outcome: "not-needed" }),
    ),
  );
  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: null,
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry needs no hint when affix notation distinguishes the entry", async () => {
  const selectedSuffix = entry("1111111", ["suffix"]);
  selectedSuffix.sense[0].partOfSpeech = ["n-suf"];
  const competingNoun = entry("2222222", ["noun"]);
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [competingNoun, selectedSuffix],
    }),
    MODEL_OPTIONS,
    dependencies(
      () => ({ outcome: "selected", senseNumbers: [1] }),
      () => {
        throw new Error(
          "Hint generation should not run after affix notation removes the contrast.",
        );
      },
    ),
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: null,
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry asks for a contrastive hint after reading selects the entry", async () => {
  const selectedEntry = entry("1111111", ["karma"]);
  const contrastingEntry = entry("2222222", ["work"]);
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [contrastingEntry, selectedEntry],
    }),
    MODEL_OPTIONS,
    dependencies((input) => ({
      outcome: "selected",
      senseNumbers: [...input.compatibleSenseNumbers],
    }), (input) => {
      assertEquals(input.selectedUsage, { entry: selectedEntry, senseNumbers: [1] });
      assertEquals(input.contrastingUsages, [{ entry: contrastingEntry, senseNumbers: [1] }]);
      return generatedHint("前世の業");
    }),
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry delegates overlapping gloss distinctions to hint generation", async () => {
  const selectedEntry = entry("1111111", ["karma", "fate"]);
  const contrastingEntry = entry("2222222", ["karma", "destiny"]);
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [contrastingEntry, selectedEntry],
    }),
    MODEL_OPTIONS,
    dependencies((input) => ({
      outcome: "selected",
      senseNumbers: [...input.compatibleSenseNumbers],
    }), (input) => {
      assertEquals(input.selectedUsage, { entry: selectedEntry, senseNumbers: [1, 2] });
      assertEquals(input.contrastingUsages, [{
        entry: contrastingEntry,
        senseNumbers: [1, 2],
      }]);
      return generatedHint("前世からの業");
    }),
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1, 2],
    hint: "前世からの業",
    model: "test",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
    modelConfigurationIds: ["test"],
  });
});

Deno.test("selectJMDictEntry sorts cross-entry contrasts for stable cache keys", async () => {
  const selectedEntry = entry("1111111", ["karma"]);
  const secondEntry = entry("2222222", ["work"]);
  const thirdEntry = entry("3333333", ["performance"]);
  await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [thirdEntry, selectedEntry, secondEntry],
    }),
    MODEL_OPTIONS,
    dependencies((input) => ({
      outcome: "selected",
      senseNumbers: [...input.compatibleSenseNumbers],
    }), (input) => {
      assertEquals(
        input.contrastingUsages.map(({ entry }) => entry.id),
        ["2222222", "3333333"],
      );
      return generatedHint("前世の業");
    }),
  );
});

Deno.test("selectJMDictEntry marks only the accepted Full-context occurrence", async () => {
  const value = request({
    allowedJMDictIds: ["1111111"],
    kanaReadingEvidence: "source-ruby",
  });
  value.context = "別の業について話した。\n\nそれは前世の業だ。";
  value.fullContext = "それは前世の業だ。";

  await selectJMDictEntry(
    value,
    MODEL_OPTIONS,
    dependencies((input) => {
      assertEquals(input.context, "別の業について話した。\n\nそれは前世の<mark>業</mark>だ。");
      return {
        outcome: "selected",
        senseNumbers: [...input.compatibleSenseNumbers],
      };
    }),
  );
});

Deno.test("selectJMDictEntry preserves semantic ambiguity within one possible entry", async () => {
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [entry("1111111", ["karma", "fate"])],
    }),
    MODEL_OPTIONS,
    dependencies(() => ({ outcome: "ambiguous", possibleSenseNumbers: [1, 2] })),
  );

  assertEquals(result, {
    status: "sense-ambiguous",
    possibleJMDictId: "1111111",
    possibleSenseNumbers: [1, 2],
    modelConfigurationIds: ["test"],
  });
});
