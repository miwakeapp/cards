import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertRejects } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { isAIQuotaError } from "./enrich.ts";
import { applyGeneratedCardFields, needsCardFieldEnrichment } from "./enrichment.ts";
import {
  type ConversionCandidate,
  deferredReason,
  minimizedContextNeedsGeneration,
} from "./types.ts";

function candidate(): ConversionCandidate {
  return {
    noteId: 42,
    approved: true,
    jmdictId: "1414110",
    recognitionTarget: "大小",
    keyRecognitionTarget: "大小",
    readingKana: "だいしょう",
    senseSelectionContext: "前段。\n\n物の大小を比べた後も、話は長く続いた。\n\n後段。",
    sourceResolution: { name: "Test", method: "source-field", url: null, urlIsPublic: false },
    targetInContextResolution: { method: "deterministic", surface: "大小" },
    fullContextResolution: { status: "restored", method: "exact" },
    minimizedContextResolution: { status: "pending" },
    senseResolution: { status: "pending", compatibleSenses: [1, 2, 3, 4, 5, 6] },
    original: { modelName: "Animecards", tags: [], cards: [99], fields: {}, fingerprint: "abc" },
    target: {
      modelName: "Miwake",
      fields: {
        Key: "大小 | 1414110",
        "Recognition target": "大小",
        Reading: "大[だい] 小[しょう]",
        Hint: "",
        "Full context": "物の<mark>大小</mark>を比べた後も、話は長く続いた。",
        "Minimized context": "",
        "Dictionary entry": "entry",
        Source: '<span lang="en">Test</span>',
      },
    },
  };
}

const entry = await preextractedJMDictEntry("1414110");

Deno.test("minimizedContextNeedsGeneration excludes completed results", () => {
  assertEquals(minimizedContextNeedsGeneration({ status: "not-needed" }), false);
  assertEquals(
    minimizedContextNeedsGeneration({
      status: "generated",
      model: "gpt-5.6",
      generatedAt: "2026-07-26T00:00:00.000Z",
    }),
    false,
  );
  assertEquals(minimizedContextNeedsGeneration({ status: "pending" }), true);
  assertEquals(
    minimizedContextNeedsGeneration({
      status: "failed",
      model: "gpt-5.6",
      attemptedAt: "2026-07-26T00:00:00.000Z",
      error: "quota",
    }),
    true,
  );
});

Deno.test("isAIQuotaError recognizes provider quota failures", () => {
  assertEquals(isAIQuotaError("You exceeded your current quota."), true);
  assertEquals(isAIQuotaError("code: insufficient_quota"), true);
  assertEquals(isAIQuotaError("Spend-based rate limit reached"), true);
  assertEquals(isAIQuotaError("Invalid JSON response"), false);
});

Deno.test("applyGeneratedCardFields applies selected senses, hint, and minimized context", async () => {
  const value = candidate();
  await applyGeneratedCardFields(
    value,
    entry,
    {
      applicableSenses: [2],
      targetInContext: "大小",
      hint: "規模大小",
      minimizedContext: "物の<mark>大小</mark>を比べた。",
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
    "gemini-3.5-flash",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110 | 2");
  assertEquals(value.target.fields.Hint, "規模大小");
  assertEquals(value.target.fields["Minimized context"], "物の<mark>大小</mark>を比べた。");
  assertEquals<ConversionCandidate["senseResolution"]>(value.senseResolution, {
    status: "generated",
    model: "gemini-3.5-flash",
    generatedAt: "2026-07-18T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  });
  assertEquals(needsCardFieldEnrichment(value), false);
});

Deno.test("applyGeneratedCardFields rejects invalid sense numbers atomically", async () => {
  const value = candidate();
  await assertRejects(
    () =>
      applyGeneratedCardFields(
        value,
        entry,
        {
          applicableSenses: [7],
          targetInContext: "大小",
          hint: "規模大小",
          minimizedContext: "物の<mark>大小</mark>を比べた。",
          cleanedSource: null,
          sourceURLIsPublic: false,
        },
        "gemini-3.5-flash",
        "2026-07-18T00:00:00.000Z",
      ),
    Error,
    "expected unique integers from the JMDict-compatible senses",
  );
  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(value.senseResolution, {
    status: "pending",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
  });
  assertEquals(value.minimizedContextResolution, { status: "pending" });
});

Deno.test("applyGeneratedCardFields canonicalizes an explicit all-compatible selection", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };

  await applyGeneratedCardFields(
    value,
    entry,
    {
      applicableSenses: [6, 4, 2, 1, 5, 3],
      hint: "規模大小",
    },
    "gemini-3.5-flash",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(value.target.fields.Hint, "");
  assertEquals(value.senseResolution, {
    status: "generated",
    model: "gemini-3.5-flash",
    generatedAt: "2026-07-18T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [],
  });
});

Deno.test("applyGeneratedCardFields defers a usage matching no compatible sense", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };

  await applyGeneratedCardFields(
    value,
    entry,
    {
      applicableSenses: null,
      hint: null,
    },
    "gpt-5.6",
    "2026-07-26T00:00:00.000Z",
  );

  assertEquals(value.senseResolution, {
    status: "no-match",
    model: "gpt-5.6",
    generatedAt: "2026-07-26T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
  });
  assertEquals(deferredReason(value), "no-applicable-jmdict-sense");
  assertEquals(needsCardFieldEnrichment(value), false);
  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(value.target.fields.Hint, "");
});

Deno.test("applyGeneratedCardFields rejects stale compatible-sense evidence", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };
  value.senseResolution = { status: "pending", compatibleSenses: [1, 2] };

  await assertRejects(
    () =>
      applyGeneratedCardFields(
        value,
        entry,
        {
          applicableSenses: [2],
          hint: "規模大小",
        },
        "gemini-3.5-flash",
        "2026-07-18T00:00:00.000Z",
      ),
    Error,
    "the selected spelling and reading now permit [1,2,3,4,5,6]",
  );
});

Deno.test("applyGeneratedCardFields retries a failed sense selection", async () => {
  const value = candidate();
  value.minimizedContextResolution = {
    status: "generated",
    model: "gpt-5.6",
    generatedAt: "2026-07-17T00:00:00.000Z",
  };
  value.target.fields["Minimized context"] = "既存の<mark>大小</mark>。";
  value.senseResolution = {
    status: "failed",
    model: "gemini-3.5-flash",
    attemptedAt: "2026-07-17T00:00:00.000Z",
    error: "Invalid JSON response",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
  };
  assertEquals(needsCardFieldEnrichment(value), true);

  await applyGeneratedCardFields(
    value,
    entry,
    {
      applicableSenses: [2],
      hint: "規模大小",
    },
    "claude-opus-4-8",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110 | 2");
  assertEquals<ConversionCandidate["senseResolution"]>(value.senseResolution, {
    status: "generated",
    model: "claude-opus-4-8",
    generatedAt: "2026-07-18T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  });
  assertEquals(value.target.fields["Minimized context"], "既存の<mark>大小</mark>。");
  assertEquals(value.minimizedContextResolution, {
    status: "generated",
    model: "gpt-5.6",
    generatedAt: "2026-07-17T00:00:00.000Z",
  });
});

Deno.test("applyGeneratedCardFields preserves an existing sense while minimizing", async () => {
  const value = candidate();
  value.senseResolution = {
    status: "generated",
    model: "gemini-3.5-flash",
    generatedAt: "2026-07-17T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  };
  value.target.fields.Key = "大小 | 1414110 | 2";
  value.target.fields.Hint = "規模大小";

  await applyGeneratedCardFields(
    value,
    entry,
    {
      applicableSenses: [99],
      targetInContext: "大小",
      hint: "unused",
      minimizedContext: "物の<mark>大小</mark>を比べた。",
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
    "claude-opus-4-8",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110 | 2");
  assertEquals(value.target.fields.Hint, "規模大小");
  assertEquals(value.target.fields["Minimized context"], "物の<mark>大小</mark>を比べた。");
});

Deno.test("needsCardFieldEnrichment waits for a restored full context", () => {
  const value = candidate();
  value.fullContextResolution = {
    status: "failed",
    source: "Test",
    requiredContextHTML: "物の大小を比べる。",
    model: "gemini-3.5-flash",
    attemptedAt: "2026-07-21T00:00:00.000Z",
    error: "Source ruby could not be validated",
  };

  assertEquals(needsCardFieldEnrichment(value), false);
});

Deno.test("needsCardFieldEnrichment accepts a sense determined by JMDict restrictions", () => {
  const value = candidate();
  value.senseResolution = { status: "determined", applicableSenses: [2] };
  value.minimizedContextResolution = { status: "not-needed" };

  assertEquals(needsCardFieldEnrichment(value), false);
});

Deno.test("applyGeneratedCardFields ignores sense output for single-sense candidates", async () => {
  const value = candidate();
  value.senseResolution = { status: "not-needed" };
  value.minimizedContextResolution = { status: "not-needed" };
  await applyGeneratedCardFields(
    value,
    { ...entry, sense: [entry.sense[0]] },
    {
      applicableSenses: [99],
      targetInContext: "大小",
      hint: "規模大小",
      minimizedContext: "unused",
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
    "gemini-3.5-flash",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(value.target.fields.Hint, "");
  assertEquals(value.senseResolution, { status: "not-needed" });
  assertEquals(needsCardFieldEnrichment(value), false);
});

Deno.test("applyGeneratedCardFields rerenders affix notation after sense selection", async () => {
  const degree = await preextractedJMDictEntry("1006690");
  const value = candidate();
  value.jmdictId = degree.id;
  value.recognitionTarget = "そこそこ";
  value.keyRecognitionTarget = "そこそこ";
  value.readingKana = "そこそこ";
  value.minimizedContextResolution = { status: "not-needed" };
  value.senseResolution = { status: "pending", compatibleSenses: [1, 2, 3] };
  value.target.fields.Key = `そこそこ | ${degree.id}`;
  value.target.fields["Recognition target"] = "そこそこ";
  value.target.fields.Reading = "";
  value.target.fields["Full context"] = "<mark>そこそこ</mark>の出来だ。";

  await applyGeneratedCardFields(
    value,
    degree,
    {
      applicableSenses: [3],
      targetInContext: "そこそこ",
      hint: "評価はそこそこ",
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
    "gemini-3.5-flash",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, `そこそこ | ${degree.id} | 3`);
  assertEquals(value.target.fields["Recognition target"], "～そこそこ");
  assertEquals(value.target.fields.Hint, "");
  assertEquals(value.recognitionTarget, "～そこそこ");
});

Deno.test("applyGeneratedCardFields retains a hint between same-pattern affix senses", async () => {
  const suffixEntry = structuredClone(await preextractedJMDictEntry("1006690"));
  suffixEntry.sense = [
    { ...structuredClone(suffixEntry.sense[2]), gloss: suffixEntry.sense[0].gloss },
    { ...structuredClone(suffixEntry.sense[2]), gloss: suffixEntry.sense[1].gloss },
  ];
  const value = candidate();
  value.jmdictId = suffixEntry.id;
  value.recognitionTarget = "そこそこ";
  value.keyRecognitionTarget = "そこそこ";
  value.readingKana = "そこそこ";
  value.minimizedContextResolution = { status: "not-needed" };
  value.senseResolution = { status: "pending", compatibleSenses: [1, 2] };
  value.target.fields.Key = `そこそこ | ${suffixEntry.id}`;
  value.target.fields["Recognition target"] = "そこそこ";
  value.target.fields.Reading = "";
  value.target.fields["Full context"] = "<mark>そこそこ</mark>の出来だ。";

  await applyGeneratedCardFields(
    value,
    suffixEntry,
    {
      applicableSenses: [1],
      targetInContext: "そこそこ",
      hint: "評価はそこそこ",
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
    "gemini-3.5-flash",
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields["Recognition target"], "～そこそこ");
  assertEquals(value.target.fields.Hint, "評価はそこそこ");
});
