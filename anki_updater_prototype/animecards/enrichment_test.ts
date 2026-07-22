import { assertEquals, assertThrows } from "@std/assert";
import type { JMDictWord } from "data";
import {
  applyGeneratedCardFields,
  needsCardFieldEnrichment,
  rekeyCachedKey,
} from "./enrichment.ts";
import type { ConversionCandidate } from "./types.ts";

function candidate(): ConversionCandidate {
  return {
    noteId: 42,
    approved: true,
    jmdictId: "1234567",
    recognitionTarget: "大小",
    keyRecognitionTarget: "大小",
    readingKana: "だいしょう",
    sourceResolution: { name: "Test", method: "source-field", url: null, urlIsPublic: false },
    fullContextResolution: { status: "restored", method: "exact" },
    minimizedContextResolution: { status: "pending" },
    senseResolution: { status: "pending" },
    original: { modelName: "Animecards", tags: [], cards: [99], fields: {}, fingerprint: "abc" },
    target: {
      modelName: "Miwake",
      fields: {
        Key: "大小 | 1234567",
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

const entry = { id: "1234567", sense: [{}, {}, {}] } as JMDictWord;

Deno.test("applyGeneratedCardFields applies selected senses, hint, and minimized context", () => {
  const value = candidate();
  applyGeneratedCardFields(
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

  assertEquals(value.target.fields.Key, "大小 | 1234567 | 2");
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

Deno.test("applyGeneratedCardFields rejects invalid sense numbers atomically", () => {
  const value = candidate();
  assertThrows(
    () =>
      applyGeneratedCardFields(
        value,
        entry,
        {
          applicableSenses: [4],
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
  assertEquals(value.target.fields.Key, "大小 | 1234567");
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

Deno.test("applyGeneratedCardFields ignores sense output for single-sense candidates", () => {
  const value = candidate();
  value.senseResolution = { status: "not-needed" };
  value.minimizedContextResolution = { status: "not-needed" };
  applyGeneratedCardFields(
    value,
    { ...entry, sense: [{}] } as JMDictWord,
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

  assertEquals(value.target.fields.Key, "大小 | 1234567");
  assertEquals(value.target.fields.Hint, "");
  assertEquals(value.senseResolution, { status: "not-needed" });
  assertEquals(needsCardFieldEnrichment(value), false);
});

Deno.test("rekeyCachedKey preserves senses but uses the current key spelling", () => {
  const value = candidate();
  value.jmdictId = "1339630";
  value.recognitionTarget = "でたらめ";
  value.keyRecognitionTarget = "でたらめ";

  assertEquals(
    rekeyCachedKey(value, "デタラメ | 1339630 | 2"),
    "でたらめ | 1339630 | 2",
  );
  assertEquals(rekeyCachedKey(value, "デタラメ | 9999999 | 2"), null);
});
