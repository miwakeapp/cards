import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildConversionReport,
  buildDeferredContextsCSV,
  defaultDeferredContextsPath,
  defaultReportPath,
} from "./report.ts";
import { CONVERSION_MANIFEST_VERSION, type ConversionManifest } from "./types.ts";

Deno.test("defaultReportPath replaces the manifest extension", () => {
  assertEquals(defaultReportPath("generated/conversion.json"), "generated/conversion.report.md");
  assertEquals(
    defaultDeferredContextsPath("generated/conversion.json"),
    "generated/conversion.deferred-contexts.csv",
  );
});

Deno.test("buildConversionReport groups exact final source HTML strings", () => {
  const manifest = {
    version: CONVERSION_MANIFEST_VERSION,
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
        targetInContextResolution: {
          method: "ai",
          surface: "舟",
          model: "gemini-3.6-flash",
          generatedAt: "2026-07-22T00:00:00.000Z",
        },
        fullContextResolution: { status: "restored", method: "exact" },
        minimizedContextResolution: { status: "not-needed" },
        senseResolution: { status: "not-needed" },
        readingResolution: { status: "not-needed" },
        target: { fields: { Source: '<span lang="ja">『舟を編む』</span>', Key: "舟 | 1" } },
      },
      {
        noteId: 2,
        approved: false,
        recognitionTarget: "本",
        keyRecognitionTarget: "本",
        readingKana: "ほん",
        senseSelectionContext: "本を読む。",
        sourceResolution: { name: null, method: "none", url: null, urlIsPublic: false },
        targetInContextResolution: { method: "deterministic", surface: "本" },
        fullContextResolution: { status: "source-unavailable" },
        minimizedContextResolution: { status: "pending" },
        senseResolution: { status: "pending", compatibleSenses: [1, 2] },
        readingResolution: { status: "not-needed" },
        original: { fields: {} },
        target: { fields: { Source: "", Key: "本 | 2" } },
      },
      {
        noteId: 3,
        approved: true,
        recognitionTarget: "微塵",
        keyRecognitionTarget: "微塵",
        readingKana: "みじん",
        senseSelectionContext: "微塵も疑わない。",
        sourceResolution: {
          name: "容疑者Xの献身",
          method: "epub",
          url: null,
          urlIsPublic: false,
        },
        targetInContextResolution: { method: "deterministic", surface: "微塵" },
        fullContextResolution: {
          status: "failed",
          source: "容疑者Xの献身",
          requiredContextHTML: "微塵も疑わない。",
          model: "gemini-3.6-flash",
          attemptedAt: "2026-07-21T00:00:00.000Z",
          error: "Could not derive a complete reading",
        },
        minimizedContextResolution: { status: "pending" },
        senseResolution: { status: "pending", compatibleSenses: [1, 2] },
        readingResolution: { status: "not-needed" },
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
        targetInContextResolution: { method: "deterministic", surface: "衝撃波" },
        fullContextResolution: { status: "restored", method: "exact" },
        minimizedContextResolution: {
          status: "failed",
          model: "gemini-3.6-flash",
          attemptedAt: "2026-07-21T00:00:00.000Z",
          error: "Invalid JSON response",
        },
        senseResolution: { status: "not-needed" },
        readingResolution: { status: "not-needed" },
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
  assertStringIncludes(report, "Target-in-context resolution: ai=1");
  assertStringIncludes(report, "| 1 | `～舟` | `舟` | gemini-3.6-flash |");
  assertStringIncludes(report, "| 1 | `～舟` | `舟` | `舟 \\| 1` |");
  assertStringIncludes(report, "| 1 | `multiple-jmdict-ids` |");

  const deferredCSV = buildDeferredContextsCSV(manifest);
  assertStringIncludes(deferredCSV, "note_id,recognition_target,jmdict_id");
  assertStringIncludes(deferredCSV, "2,本");
  assertStringIncludes(deferredCSV, "3,微塵");
  assertStringIncludes(deferredCSV, "4,衝撃波");
  assertStringIncludes(deferredCSV, "full-context-source-unavailable");
});

Deno.test("buildConversionReport shows selected and compatible senses", () => {
  const manifest = {
    version: CONVERSION_MANIFEST_VERSION,
    generatedAt: "2026-07-26T00:00:00.000Z",
    query: 'note:"Animecards"',
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {},
    candidates: [{
      noteId: 42,
      approved: false,
      jmdictId: "1414110",
      recognitionTarget: "大小",
      keyRecognitionTarget: "大小",
      readingKana: "だいしょう",
      senseSelectionContext: "前段。物の大小を比べる。後段。",
      sourceResolution: {
        name: "Test",
        method: "source-field",
        url: null,
        urlIsPublic: false,
      },
      targetInContextResolution: { method: "deterministic", surface: "大小" },
      fullContextResolution: { status: "restored", method: "exact" },
      minimizedContextResolution: { status: "not-needed" },
      senseResolution: {
        status: "generated",
        model: "gemini-3.6-flash",
        generatedAt: "2026-07-26T00:00:00.000Z",
        compatibleSenses: [1, 2, 3],
        applicableSenses: [2],
      },
      readingResolution: { status: "not-needed" },
      jmdictEntryResolution: {
        model: "gemini-3.6-flash",
        generatedAt: "2026-07-27T00:00:00.000Z",
        applicableSenseNumbers: [2],
        hint: "規模大小",
        candidateJMDictIds: ["1414110", "2999999"],
        allowedJMDictIds: ["1414110"],
      },
      original: { fields: {} },
      target: {
        fields: {
          Source: '<span lang="en">Test</span>',
          Key: "大小 | 1414110:2",
          Hint: "規模大小",
          "Full context": "物の<mark>大小</mark>を比べる。",
        },
      },
    }],
    skipped: [],
  } as unknown as ConversionManifest;

  const report = buildConversionReport(manifest);
  assertStringIncludes(report, "## Sense selections");
  assertStringIncludes(
    report,
    "| 42 | `大小` | `manual-hold` | `generated` | `2 / 1,2,3` | `大小 \\| 1414110:2` | `規模大小` | gemini-3.6-flash | `物の大小を比べる。` | `前段。物の大小を比べる。後段。` |",
  );
  assertStringIncludes(report, "## JMDict entry selections");
  assertStringIncludes(
    report,
    "| 42 | `大小` | 1414110 | `1414110` | `1414110, 2999999` | `規模大小` | gemini-3.6-flash | `前段。物の大小を比べる。後段。` |",
  );
});

Deno.test("buildConversionReport audits no-match sense selections", () => {
  const manifest = {
    version: CONVERSION_MANIFEST_VERSION,
    generatedAt: "2026-07-26T00:00:00.000Z",
    query: 'note:"Animecards"',
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {},
    candidates: [{
      noteId: 43,
      approved: true,
      jmdictId: "1630340",
      recognitionTarget: "金子",
      keyRecognitionTarget: "金子",
      readingKana: "きんす",
      senseSelectionContext: "バイトの金子は配達中だ。",
      sourceResolution: {
        name: "Test",
        method: "source-field",
        url: null,
        urlIsPublic: false,
      },
      targetInContextResolution: { method: "deterministic", surface: "金子" },
      fullContextResolution: { status: "restored", method: "exact" },
      minimizedContextResolution: { status: "not-needed" },
      senseResolution: {
        status: "no-match",
        model: "gpt-5.6-sol",
        generatedAt: "2026-07-26T00:00:00.000Z",
        compatibleSenses: [1, 2],
      },
      readingResolution: { status: "not-needed" },
      original: { fields: {} },
      target: {
        fields: {
          Source: '<span lang="en">Test</span>',
          Key: "金子 | 1630340",
          Hint: "",
          "Full context": "バイトの<mark>金子</mark>は配達中だ。",
        },
      },
    }],
    skipped: [],
  } as unknown as ConversionManifest;

  const report = buildConversionReport(manifest);
  assertStringIncludes(
    report,
    "| 43 | `金子` | `no-applicable-jmdict-sense` | `no-match` | `none / 1,2` | `金子 \\| 1630340` | `` | gpt-5.6-sol |",
  );
  assertStringIncludes(report, "| 1 | `no-applicable-jmdict-sense` |");
});

Deno.test("buildConversionReport audits ambiguous sense selections distinctly", () => {
  const manifest = {
    version: CONVERSION_MANIFEST_VERSION,
    generatedAt: "2026-07-29T00:00:00.000Z",
    query: 'note:"Animecards"',
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {},
    candidates: [{
      noteId: 44,
      approved: true,
      jmdictId: "1414110",
      recognitionTarget: "大小",
      keyRecognitionTarget: "大小",
      readingKana: "だいしょう",
      senseSelectionContext: "物の大小を比べる。",
      sourceResolution: {
        name: "Test",
        method: "source-field",
        url: null,
        urlIsPublic: false,
      },
      targetInContextResolution: { method: "deterministic", surface: "大小" },
      fullContextResolution: { status: "restored", method: "exact" },
      minimizedContextResolution: { status: "not-needed" },
      senseResolution: {
        status: "ambiguous",
        model: "claude-opus-5",
        generatedAt: "2026-07-29T00:00:00.000Z",
        compatibleSenses: [1, 2, 3],
        possibleSenses: [1, 3],
      },
      readingResolution: { status: "not-needed" },
      original: { fields: {} },
      target: {
        fields: {
          Source: '<span lang="en">Test</span>',
          Key: "大小 | 1414110",
          Hint: "",
          "Full context": "物の<mark>大小</mark>を比べる。",
        },
      },
    }],
    skipped: [],
  } as unknown as ConversionManifest;

  const report = buildConversionReport(manifest);
  assertStringIncludes(
    report,
    "| 44 | `大小` | `ambiguous-jmdict-sense` | `ambiguous` | `ambiguous: 1,3 / 1,2,3` |",
  );
  assertStringIncludes(report, "| 1 | `ambiguous-jmdict-sense` |");
});

Deno.test("buildConversionReport audits individual deferred entry selections", () => {
  const manifest = {
    version: CONVERSION_MANIFEST_VERSION,
    generatedAt: "2026-07-27T00:00:00.000Z",
    query: 'note:"Animecards"',
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {},
    candidates: [],
    skipped: [{
      noteId: 42,
      word: "業",
      reason: "ai-ambiguous-jmdict-entry",
      detail: "1111111, 2222222",
      entrySelection: {
        model: "gemini-3.6-flash",
        recognitionTarget: "業",
        context: "前世の業か、職人の業か。",
        candidateJMDictIds: ["1111111", "2222222"],
        allowedJMDictIds: ["1111111", "2222222"],
        candidateDescriptions: {
          "1111111": "1. karma",
          "2222222": "1. work; performance",
        },
      },
    }],
  } as unknown as ConversionManifest;

  const report = buildConversionReport(manifest);
  assertStringIncludes(report, "### Deferred JMDict entry selections");
  assertStringIncludes(
    report,
    "| 42 | `業` | `ai-ambiguous-jmdict-entry` | `1111111, 2222222` | `1111111, 2222222` | `1111111: 1. karma \\|\\| 2222222: 1. work; performance` | gemini-3.6-flash | `前世の業か、職人の業か。` |",
  );
});
