import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildConversionReport,
  buildDeferredContextsCSV,
  defaultDeferredContextsPath,
  defaultReportPath,
} from "./report.ts";
import type { ConversionManifest } from "./types.ts";

Deno.test("defaultReportPath replaces the manifest extension", () => {
  assertEquals(defaultReportPath("generated/conversion.json"), "generated/conversion.report.md");
  assertEquals(
    defaultDeferredContextsPath("generated/conversion.json"),
    "generated/conversion.deferred-contexts.csv",
  );
});

Deno.test("buildConversionReport groups exact final source HTML strings", () => {
  const manifest = {
    version: 7,
    generatedAt: "2026-07-15T00:00:00.000Z",
    query: 'note:"Animecards"',
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {},
    candidates: [
      {
        noteId: 1,
        approved: true,
        recognitionTarget: "～舟",
        keyRecognitionTarget: "舟",
        readingKana: "ふね",
        sourceResolution: {
          name: "舟を編む",
          method: "source-field",
          url: "https://reader.miwake.app/b?id=15",
          urlIsPublic: false,
        },
        fullContextResolution: { status: "restored", method: "exact" },
        minimizedContextResolution: { status: "not-needed" },
        senseResolution: { status: "not-needed" },
        target: { fields: { Source: '<span lang="ja">『舟を編む』</span>', Key: "舟 | 1" } },
      },
      {
        noteId: 2,
        approved: false,
        recognitionTarget: "本",
        keyRecognitionTarget: "本",
        readingKana: "ほん",
        sourceResolution: { name: null, method: "none", url: null, urlIsPublic: false },
        fullContextResolution: { status: "source-unavailable" },
        minimizedContextResolution: { status: "pending" },
        senseResolution: { status: "pending" },
        original: { fields: {} },
        target: { fields: { Source: "", Key: "本 | 2" } },
      },
      {
        noteId: 3,
        approved: true,
        recognitionTarget: "微塵",
        keyRecognitionTarget: "微塵",
        readingKana: "みじん",
        sourceResolution: {
          name: "容疑者Xの献身",
          method: "epub",
          url: null,
          urlIsPublic: false,
        },
        fullContextResolution: {
          status: "failed",
          model: "gemini-3.5-flash",
          attemptedAt: "2026-07-21T00:00:00.000Z",
          error: "Could not derive a complete reading",
        },
        minimizedContextResolution: { status: "pending" },
        senseResolution: { status: "pending" },
        original: { fields: {} },
        target: {
          fields: {
            Source: '<span lang="ja">『容疑者Xの献身』</span>',
            Key: "微塵 | 1486050",
          },
        },
      },
      {
        noteId: 4,
        approved: true,
        recognitionTarget: "衝撃波",
        keyRecognitionTarget: "衝撃波",
        readingKana: "しょうげきは",
        sourceResolution: {
          name: "虐殺器官",
          method: "source-field",
          url: null,
          urlIsPublic: false,
        },
        fullContextResolution: { status: "restored", method: "exact" },
        minimizedContextResolution: {
          status: "failed",
          model: "gemini-3.5-flash",
          attemptedAt: "2026-07-21T00:00:00.000Z",
          error: "Invalid JSON response",
        },
        senseResolution: { status: "not-needed" },
        original: { fields: {} },
        target: {
          fields: {
            Source: '<span lang="ja">『虐殺器官』</span>',
            Key: "衝撃波 | 2655780",
          },
        },
      },
    ],
    skipped: [{ reason: "multiple-jmdict-ids" }],
  } as unknown as ConversionManifest;

  const report = buildConversionReport(manifest);
  assertStringIncludes(report, "Eligible conversion candidates: 1");
  assertStringIncludes(report, "Deferred candidates: 3");
  assertStringIncludes(report, "1 distinct strings; none are empty");
  assertStringIncludes(report, "full-context-source-unavailable");
  assertStringIncludes(report, "full-context-restoration-failed");
  assertStringIncludes(report, "ai-enrichment-failed");
  assertStringIncludes(report, "Failed AI enrichments: 1");
  assertStringIncludes(report, "private or temporary/unlinked");
  assertStringIncludes(report, "| 1 | `～舟` | `舟` | `舟 \\| 1` |");
  assertStringIncludes(report, "| 1 | `multiple-jmdict-ids` |");

  const deferredCSV = buildDeferredContextsCSV(manifest);
  assertStringIncludes(deferredCSV, "note_id,recognition_target,jmdict_id");
  assertStringIncludes(deferredCSV, "2,本");
  assertStringIncludes(deferredCSV, "3,微塵");
  assertStringIncludes(deferredCSV, "4,衝撃波");
  assertStringIncludes(deferredCSV, "full-context-source-unavailable");
});
