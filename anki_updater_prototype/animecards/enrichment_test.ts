import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertRejects } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { applyGeneratedCardFields, needsCardFieldEnrichment } from "./enrichment.ts";
import type { ConversionCandidate } from "./types.ts";

function candidate(): ConversionCandidate {
  return {
    noteId: 42,
    approved: true,
    jmdictId: "1414110",
    recognitionTarget: "大小",
    keyRecognitionTarget: "大小",
    readingKana: "だいしょう",
    sourceResolution: { name: "Test", method: "source-field", url: null, urlIsPublic: false },
    targetInContextResolution: { method: "deterministic", surface: "大小" },
    fullContextResolution: { status: "restored", method: "exact" },
    minimizedContextResolution: { status: "pending" },
    senseResolution: { status: "pending" },
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
  assertEquals(value.senseResolution, {
    status: "generated",
    model: "gemini-3.5-flash",
    generatedAt: "2026-07-18T00:00:00.000Z",
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
    "invalid applicable senses",
  );
  assertEquals(value.target.fields.Key, "大小 | 1414110");
  assertEquals(value.senseResolution, { status: "pending" });
  assertEquals(value.minimizedContextResolution, { status: "pending" });
});

Deno.test("needsCardFieldEnrichment waits for a restored full context", () => {
  const value = candidate();
  value.fullContextResolution = {
    status: "failed",
    model: "gemini-3.5-flash",
    attemptedAt: "2026-07-21T00:00:00.000Z",
    error: "Source ruby could not be validated",
  };

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
  assertEquals(value.recognitionTarget, "～そこそこ");
});
