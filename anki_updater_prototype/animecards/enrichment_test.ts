import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertRejects } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import {
  applySettledCandidateEnrichment,
  enrichmentContext,
  isAIQuotaError,
  markedSenseSelectionContext,
} from "./enrich.ts";
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
    readingResolution: { status: "not-needed" },
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
        "Dictionary": "entry",
        Source: '<span lang="en">Test</span>',
      },
    },
  };
}

const entry = await preextractedJMDictEntry("1414110");
const alternateNamesEntry = await preextractedJMDictEntry("1158110");

function additionalReadingCandidate(): ConversionCandidate {
  const value = candidate();
  value.jmdictId = alternateNamesEntry.id;
  value.recognitionTarget = "異名";
  value.keyRecognitionTarget = "異名";
  value.readingKana = "いみょう";
  value.senseSelectionContext = "その異名を知っている。";
  value.targetInContextResolution = { method: "deterministic", surface: "異名" };
  value.minimizedContextResolution = { status: "not-needed" };
  value.senseResolution = { status: "determined", applicableSenses: [1] };
  value.readingResolution = {
    status: "pending",
    alternatives: [{
      jmdictId: alternateNamesEntry.id,
      kanaReading: "いめい",
      applicableSenseNumbers: [1],
    }],
  };
  value.target.fields.Key = "異名 | 1158110:1";
  value.target.fields["Recognition target"] = "異名";
  value.target.fields.Reading = "異[い] 名[みょう]";
  value.target.fields["Full context"] = "その<mark>異名</mark>を知っている。";
  value.target.fields["Minimized context"] = "";
  return value;
}

Deno.test("enrichmentContext preserves canonical target markup", () => {
  const value = candidate();
  value.target.fields["Full context"] = "  物の<mark>大小</mark>を比べた後も、話は長く続いた。  ";

  assertEquals(
    enrichmentContext(value),
    "物の<mark>大小</mark>を比べた後も、話は長く続いた。",
  );
});

Deno.test("minimizedContextNeedsGeneration excludes completed results", () => {
  assertEquals(minimizedContextNeedsGeneration({ status: "not-needed" }), false);
  assertEquals(
    minimizedContextNeedsGeneration({
      status: "generated",
      model: "gpt-5.6-sol",
      generatedAt: "2026-07-26T00:00:00.000Z",
    }),
    false,
  );
  assertEquals(minimizedContextNeedsGeneration({ status: "pending" }), true);
  assertEquals(
    minimizedContextNeedsGeneration({
      status: "failed",
      model: "gpt-5.6-sol",
      attemptedAt: "2026-07-26T00:00:00.000Z",
      error: "quota",
    }),
    true,
  );
});

Deno.test("isAIQuotaError recognizes provider quota failures", () => {
  assertEquals(
    isAIQuotaError("You exceeded your current quota. Check your plan and billing details."),
    true,
  );
  assertEquals(isAIQuotaError("code: insufficient_quota"), true);
  assertEquals(isAIQuotaError("Spend-based rate limit reached"), true);
  assertEquals(isAIQuotaError("Your credit balance is too low"), true);
  // Generic provider quota exhaustion can be a transient per-minute/project rate limit. The AI
  // SDK gets to retry it; only explicit billing/credit exhaustion aborts an entire batch.
  assertEquals(isAIQuotaError("RESOURCE_EXHAUSTED: quota exceeded"), false);
  assertEquals(isAIQuotaError("Quota has been exceeded for this project"), false);
  assertEquals(isAIQuotaError("Invalid JSON response"), false);
});

Deno.test("applyGeneratedCardFields includes an AI-selected additional reading", async () => {
  const value = additionalReadingCandidate();
  await applyGeneratedCardFields(
    value,
    alternateNamesEntry,
    [alternateNamesEntry],
    {
      readingSelection: {
        decisions: [{
          kanaReading: "いめい",
          decision: "include",
          rationale: "A useful modern alternative.",
        }],
      },
    },
    { readingSelection: "gpt-5.6-sol@medium" },
    "2026-08-05T00:00:00.000Z",
  );

  assertEquals(
    value.target.fields.Reading,
    "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
  );
  assertEquals(value.additionalAcceptedReadings, [{
    jmdictId: "1158110",
    kanaReading: "いめい",
    applicableSenseNumbers: [1],
  }]);
  assertEquals(value.readingResolution, {
    status: "generated",
    model: "gpt-5.6-sol@medium",
    generatedAt: "2026-08-05T00:00:00.000Z",
    alternatives: [{
      jmdictId: "1158110",
      kanaReading: "いめい",
      applicableSenseNumbers: [1],
    }],
    decisions: [{
      kanaReading: "いめい",
      decision: "include",
      rationale: "A useful modern alternative.",
    }],
  });
});

Deno.test("applyGeneratedCardFields omits a rejected additional reading", async () => {
  const value = additionalReadingCandidate();
  await applyGeneratedCardFields(
    value,
    alternateNamesEntry,
    [alternateNamesEntry],
    {
      readingSelection: {
        decisions: [{
          kanaReading: "いめい",
          decision: "omit",
          rationale: "Too uncommon for this card.",
        }],
      },
    },
    { readingSelection: "gpt-5.6-sol@medium" },
    "2026-08-05T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Reading, "異[い] 名[みょう]");
  assertEquals(value.additionalAcceptedReadings, undefined);
  assertEquals(value.readingResolution.status, "generated");
});

Deno.test("enrichment preserves successful minimization when sense generation fails", async () => {
  const value = candidate();
  const failures = await applySettledCandidateEnrichment(
    value,
    entry,
    [entry],
    {
      sense: {
        promise: Promise.reject(new Error("sense provider failed")),
        attemptedModelConfigurationIds: new Set(["sense-model@medium"]),
      },
      minimizedContext: {
        promise: Promise.resolve({
          value: "物の<mark>大小</mark>を比べた。",
          metadata: { modelConfigurationId: "minimization-model@low" },
        }),
        attemptedModelConfigurationIds: new Set(),
      },
    },
    "2026-07-29T00:00:00.000Z",
  );

  assertEquals(failures, [{
    operation: "sense/hint generation",
    error: "sense provider failed",
  }]);
  assertEquals(value.senseResolution, {
    status: "failed",
    model: "sense-model@medium",
    attemptedAt: "2026-07-29T00:00:00.000Z",
    error: "sense provider failed",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
  });
  assertEquals(value.minimizedContextResolution, {
    status: "generated",
    model: "minimization-model@low",
    generatedAt: "2026-07-29T00:00:00.000Z",
  });
  assertEquals(value.target.fields["Minimized context"], "物の<mark>大小</mark>を比べた。");
});

Deno.test("enrichment preserves successful sense generation when minimization fails", async () => {
  const value = candidate();
  const failures = await applySettledCandidateEnrichment(
    value,
    entry,
    [entry],
    {
      sense: {
        promise: Promise.resolve({
          senseSelection: { outcome: "selected", senseNumbers: [2] },
          hintOutcome: {
            outcome: "generated",
            semanticEvidenceSpan: "物の大小を比べた",
            hintSourceSpan: "物の大小",
            hint: "規模大小",
          },
          modelConfigurationIds: ["sense-model@medium", "hint-model@medium"],
        }),
        attemptedModelConfigurationIds: new Set(),
      },
      minimizedContext: {
        promise: Promise.reject(new Error("minimization provider failed")),
        attemptedModelConfigurationIds: new Set(["minimization-model@low"]),
      },
    },
    "2026-07-29T00:00:00.000Z",
  );

  assertEquals(failures, [{
    operation: "context minimization",
    error: "minimization provider failed",
  }]);
  assertEquals(value.senseResolution, {
    status: "generated",
    model: "sense-model@medium, hint-model@medium",
    generatedAt: "2026-07-29T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  });
  assertEquals(value.target.fields.Key, "大小 | 1414110:2");
  assertEquals(value.target.fields.Hint, "規模大小");
  assertEquals(value.minimizedContextResolution, {
    status: "failed",
    model: "minimization-model@low",
    attemptedAt: "2026-07-29T00:00:00.000Z",
    error: "minimization provider failed",
  });
});

Deno.test("applyGeneratedCardFields applies selected senses, hint, and minimized context", async () => {
  const value = candidate();
  await applyGeneratedCardFields(
    value,
    entry,
    [entry],
    {
      senseSelection: { outcome: "selected", senseNumbers: [2] },
      hintOutcome: {
        outcome: "generated",
        semanticEvidenceSpan: "物の大小を比べた",
        hintSourceSpan: "物の大小",
        hint: "規模大小",
      },
      minimizedContext: "物の<mark>大小</mark>を比べた。",
    },
    { senseSelection: "gemini-3.6-flash", minimizedContext: "gemini-3.6-flash" },
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110:2");
  assertEquals(value.target.fields.Hint, "規模大小");
  assertEquals(value.target.fields["Minimized context"], "物の<mark>大小</mark>を比べた。");
  assertEquals<ConversionCandidate["senseResolution"]>(value.senseResolution, {
    status: "generated",
    model: "gemini-3.6-flash",
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
        [entry],
        {
          senseSelection: { outcome: "selected", senseNumbers: [7] },
          hintOutcome: {
            outcome: "generated",
            semanticEvidenceSpan: "物の大小を比べた",
            hintSourceSpan: "物の大小",
            hint: "規模大小",
          },
          minimizedContext: "物の<mark>大小</mark>を比べた。",
        },
        { senseSelection: "gemini-3.6-flash", minimizedContext: "gemini-3.6-flash" },
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

Deno.test("settled enrichment retains a cross-entry hint for an all-compatible selection", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };
  const competingEntry = structuredClone(entry);
  competingEntry.id = "9999999";

  const failures = await applySettledCandidateEnrichment(
    value,
    entry,
    [entry, competingEntry],
    {
      sense: {
        promise: Promise.resolve({
          senseSelection: { outcome: "selected", senseNumbers: [1, 2, 3, 4, 5, 6] },
          hintOutcome: {
            outcome: "generated",
            semanticEvidenceSpan: "物の大小を比べた",
            hintSourceSpan: "物の大小",
            hint: "物の大小",
          },
          modelConfigurationIds: ["sense-model@medium", "hint-model@medium"],
        }),
        attemptedModelConfigurationIds: new Set(),
      },
    },
    "2026-07-29T00:00:00.000Z",
  );

  assertEquals(failures, []);
  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(value.target.fields.Hint, "物の大小");
  assertEquals(value.senseResolution, {
    status: "generated",
    model: "sense-model@medium, hint-model@medium",
    generatedAt: "2026-07-29T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [],
  });
});

Deno.test("settled enrichment accepts a validated not-needed hint outcome", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };
  const competingEntry = structuredClone(entry);
  competingEntry.id = "9999999";

  const failures = await applySettledCandidateEnrichment(
    value,
    entry,
    [entry, competingEntry],
    {
      sense: {
        promise: Promise.resolve({
          senseSelection: { outcome: "selected", senseNumbers: [2] },
          hintOutcome: { outcome: "not-needed" },
          modelConfigurationIds: ["sense-model@medium", "hint-model@medium"],
        }),
        attemptedModelConfigurationIds: new Set(),
      },
    },
    "2026-07-29T00:00:00.000Z",
  );

  assertEquals(failures, []);
  assertEquals(value.target.fields.Key, "大小 | 1414110:2");
  assertEquals(value.target.fields.Hint, "");
  assertEquals(value.senseResolution, {
    status: "generated",
    model: "sense-model@medium, hint-model@medium",
    generatedAt: "2026-07-29T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  });
});

Deno.test("settled enrichment accepts a validated source-insufficient hint outcome", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };
  const competingEntry = structuredClone(entry);
  competingEntry.id = "9999999";

  const failures = await applySettledCandidateEnrichment(
    value,
    entry,
    [entry, competingEntry],
    {
      sense: {
        promise: Promise.resolve({
          senseSelection: { outcome: "selected", senseNumbers: [2] },
          hintOutcome: { outcome: "source-insufficient" },
          modelConfigurationIds: ["sense-model@medium", "hint-model@medium"],
        }),
        attemptedModelConfigurationIds: new Set(),
      },
    },
    "2026-07-29T00:00:00.000Z",
  );

  assertEquals(failures, []);
  assertEquals(value.target.fields.Key, "大小 | 1414110:2");
  assertEquals(value.target.fields.Hint, "");
  assertEquals(value.senseResolution, {
    status: "generated",
    model: "sense-model@medium, hint-model@medium",
    generatedAt: "2026-07-29T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  });
});

Deno.test("applyGeneratedCardFields defers a usage matching no compatible sense", async () => {
  const value = candidate();
  value.minimizedContextResolution = { status: "not-needed" };

  await applyGeneratedCardFields(
    value,
    entry,
    [entry],
    {
      senseSelection: { outcome: "no-match" },
      hintOutcome: null,
    },
    { senseSelection: "gpt-5.6-sol" },
    "2026-07-26T00:00:00.000Z",
  );

  assertEquals(value.senseResolution, {
    status: "no-match",
    model: "gpt-5.6-sol",
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
        [entry],
        {
          senseSelection: { outcome: "selected", senseNumbers: [2] },
          hintOutcome: {
            outcome: "generated",
            semanticEvidenceSpan: "物の大小を比べた",
            hintSourceSpan: "物の大小",
            hint: "規模大小",
          },
        },
        { senseSelection: "gemini-3.6-flash", minimizedContext: "gemini-3.6-flash" },
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
    model: "gpt-5.6-sol",
    generatedAt: "2026-07-17T00:00:00.000Z",
  };
  value.target.fields["Minimized context"] = "既存の<mark>大小</mark>。";
  value.senseResolution = {
    status: "failed",
    model: "gemini-3.6-flash",
    attemptedAt: "2026-07-17T00:00:00.000Z",
    error: "Invalid JSON response",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
  };
  assertEquals(needsCardFieldEnrichment(value), true);

  await applyGeneratedCardFields(
    value,
    entry,
    [entry],
    {
      senseSelection: { outcome: "selected", senseNumbers: [2] },
      hintOutcome: {
        outcome: "generated",
        semanticEvidenceSpan: "物の大小を比べた",
        hintSourceSpan: "物の大小",
        hint: "規模大小",
      },
    },
    { senseSelection: "claude-opus-5" },
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110:2");
  assertEquals<ConversionCandidate["senseResolution"]>(value.senseResolution, {
    status: "generated",
    model: "claude-opus-5",
    generatedAt: "2026-07-18T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  });
  assertEquals(value.target.fields["Minimized context"], "既存の<mark>大小</mark>。");
  assertEquals(value.minimizedContextResolution, {
    status: "generated",
    model: "gpt-5.6-sol",
    generatedAt: "2026-07-17T00:00:00.000Z",
  });
});

Deno.test("applyGeneratedCardFields preserves an existing sense while minimizing", async () => {
  const value = candidate();
  value.senseResolution = {
    status: "generated",
    model: "gemini-3.6-flash",
    generatedAt: "2026-07-17T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    applicableSenses: [2],
  };
  value.target.fields.Key = "大小 | 1414110:2";
  value.target.fields.Hint = "規模大小";

  await applyGeneratedCardFields(
    value,
    entry,
    [entry],
    {
      minimizedContext: "物の<mark>大小</mark>を比べた。",
    },
    { minimizedContext: "claude-opus-5" },
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, "大小 | 1414110:2");
  assertEquals(value.target.fields.Hint, "規模大小");
  assertEquals(value.target.fields["Minimized context"], "物の<mark>大小</mark>を比べた。");
});

Deno.test("needsCardFieldEnrichment waits for a restored full context", () => {
  const value = candidate();
  value.fullContextResolution = {
    status: "failed",
    source: "Test",
    requiredContextHTML: "物の大小を比べる。",
    model: "gemini-3.6-flash",
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
  const singleSenseEntry = { ...entry, sense: [entry.sense[0]] };
  value.senseResolution = { status: "not-needed" };
  value.minimizedContextResolution = { status: "not-needed" };
  await applyGeneratedCardFields(
    value,
    singleSenseEntry,
    [singleSenseEntry],
    {
      senseSelection: { outcome: "selected", senseNumbers: [99] },
      hintOutcome: {
        outcome: "generated",
        semanticEvidenceSpan: "物の大小を比べた",
        hintSourceSpan: "物の大小",
        hint: "規模大小",
      },
      minimizedContext: "unused",
    },
    {},
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
    [degree],
    {
      senseSelection: { outcome: "selected", senseNumbers: [3] },
      hintOutcome: null,
      minimizedContext: null,
    },
    { senseSelection: "gemini-3.6-flash" },
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields.Key, `そこそこ | ${degree.id}:3`);
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
    [suffixEntry],
    {
      senseSelection: { outcome: "selected", senseNumbers: [1] },
      hintOutcome: {
        outcome: "generated",
        semanticEvidenceSpan: "評価はそこそこ",
        hintSourceSpan: "評価はそこそこ",
        hint: "評価はそこそこ",
      },
      minimizedContext: null,
    },
    { senseSelection: "gemini-3.6-flash" },
    "2026-07-18T00:00:00.000Z",
  );

  assertEquals(value.target.fields["Recognition target"], "～そこそこ");
  assertEquals(value.target.fields.Hint, "評価はそこそこ");
});

Deno.test("applyGeneratedCardFields records ambiguity without rendering a card", async () => {
  const value = candidate();

  await applyGeneratedCardFields(
    value,
    entry,
    [entry],
    {
      senseSelection: { outcome: "ambiguous", possibleSenseNumbers: [2, 3] },
      hintOutcome: null,
      minimizedContext: "物の<mark>大小</mark>を比べた。",
    },
    { senseSelection: "claude-opus-5", minimizedContext: "claude-opus-5" },
    "2026-07-29T00:00:00.000Z",
  );

  assertEquals(value.senseResolution, {
    status: "ambiguous",
    model: "claude-opus-5",
    generatedAt: "2026-07-29T00:00:00.000Z",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
    possibleSenses: [2, 3],
  });
  assertEquals(value.minimizedContextResolution, {
    status: "generated",
    model: "claude-opus-5",
    generatedAt: "2026-07-29T00:00:00.000Z",
  });
  assertEquals(value.target.fields["Minimized context"], "物の<mark>大小</mark>を比べた。");
  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(deferredReason(value), "ambiguous-jmdict-sense");
  assertEquals(needsCardFieldEnrichment(value), false);
});

Deno.test("markedSenseSelectionContext leaves same-spelling background occurrences unmarked", async () => {
  const value = candidate();
  value.senseSelectionContext =
    "別の大小について話した。\n\n物の大小を比べた後も、話は長く続いた。\n\nまた大小に戻った。";

  assertEquals(
    await markedSenseSelectionContext(
      value,
      entry.sense.flatMap((sense) => sense.partOfSpeech),
    ),
    "別の大小について話した。\n\n物の<mark>大小</mark>を比べた後も、話は長く続いた。\n\nまた大小に戻った。",
  );
});
