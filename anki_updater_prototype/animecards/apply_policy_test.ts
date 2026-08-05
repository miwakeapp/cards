import { assertEquals } from "@std/assert";
import { preflightCandidate } from "./apply_policy.ts";
import {
  type AnkiNoteInfo,
  type ConversionCandidate,
  deferredReason,
  noteFingerprint,
  snapshotNote,
} from "./types.ts";

function sourceNote(): AnkiNoteInfo {
  return {
    noteId: 42,
    modelName: "Animecards",
    tags: ["mining"],
    cards: [99],
    fields: {
      Word: { value: "ねこ", order: 0 },
      Sentence: { value: "ねこがいる。", order: 1 },
    },
  };
}

async function candidate(): Promise<ConversionCandidate> {
  return {
    noteId: 42,
    approved: true,
    jmdictId: "1234567",
    recognitionTarget: "ねこ",
    keyRecognitionTarget: "ねこ",
    readingKana: "ねこ",
    senseSelectionContext: "ねこがいる。",
    sourceResolution: { name: null, method: "none", url: null, urlIsPublic: false },
    targetInContextResolution: { method: "deterministic", surface: "ねこ" },
    fullContextResolution: { status: "source-unavailable" },
    minimizedContextResolution: { status: "not-needed" },
    senseResolution: { status: "not-needed" },
    readingResolution: { status: "not-needed" },
    original: await snapshotNote(sourceNote()),
    target: {
      modelName: "Miwake",
      fields: { Key: "ねこ | 1234567", "Recognition target": "ねこ" },
    },
  };
}

Deno.test("preflightCandidate accepts an unchanged source note", async () => {
  assertEquals(await preflightCandidate(await candidate(), sourceNote(), []), { status: "ready" });
});

Deno.test("preflightCandidate rejects stale source data", async () => {
  const stale = sourceNote();
  stale.fields.Sentence.value = "変わった。";
  assertEquals(
    await preflightCandidate(await candidate(), stale, []),
    {
      status: "rejected",
      error: "Note changed after the manifest was prepared. Prepare a fresh manifest.",
    },
  );
});

Deno.test("preflightCandidate rejects another candidate claiming the same key", async () => {
  assertEquals(
    await preflightCandidate(await candidate(), sourceNote(), [42, 43]),
    {
      status: "rejected",
      error: "Miwake Card key is already used or claimed by note(s) 43.",
    },
  );
});

Deno.test("preflightCandidate recognizes an already-applied conversion", async () => {
  const item = await candidate();
  const applied: AnkiNoteInfo = {
    noteId: item.noteId,
    modelName: item.target.modelName,
    tags: [...item.original.tags],
    cards: [...item.original.cards],
    fields: Object.fromEntries(
      Object.entries(item.target.fields).map(([name, value], order) => [name, { value, order }]),
    ),
  };
  assertEquals(await preflightCandidate(item, applied, [42]), { status: "already-applied" });
});

Deno.test("failed enrichment defers a candidate from apply", async () => {
  const item = await candidate();
  item.fullContextResolution = { status: "restored", method: "exact" };
  item.minimizedContextResolution = {
    status: "failed",
    model: "gemini-3.6-flash",
    attemptedAt: "2026-07-21T00:00:00.000Z",
    error: "Invalid JSON response",
  };
  assertEquals(deferredReason(item), "ai-enrichment-failed");
});

Deno.test("a usage matching no JMDict sense is deferred from apply", async () => {
  const item = await candidate();
  item.fullContextResolution = { status: "restored", method: "exact" };
  item.senseResolution = {
    status: "no-match",
    model: "gpt-5.6-sol",
    generatedAt: "2026-07-26T00:00:00.000Z",
    compatibleSenses: [1, 2],
  };
  assertEquals(deferredReason(item), "no-applicable-jmdict-sense");
});

Deno.test("an ambiguous JMDict usage is deferred distinctly from no-match", async () => {
  const item = await candidate();
  item.fullContextResolution = { status: "restored", method: "exact" };
  item.senseResolution = {
    status: "ambiguous",
    model: "claude-opus-5",
    generatedAt: "2026-07-29T00:00:00.000Z",
    compatibleSenses: [1, 2, 3],
    possibleSenses: [1, 3],
  };
  assertEquals(deferredReason(item), "ambiguous-jmdict-sense");
});

Deno.test("note fingerprints are insensitive to field and tag ordering", async () => {
  const note = sourceNote();
  const snapshot = await snapshotNote(note);
  assertEquals(
    await noteFingerprint({
      modelName: note.modelName,
      tags: [...note.tags].reverse(),
      cards: [...note.cards].reverse(),
      fields: Object.fromEntries(Object.entries(snapshot.fields).reverse()),
    }),
    snapshot.fingerprint,
  );
});
