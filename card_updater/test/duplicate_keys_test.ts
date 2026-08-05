import { assertEquals } from "@std/assert";
import type { AnalyzedCard } from "../src/analyze.ts";
import { flagDuplicateRecognitionUnits, RecognitionUnitIndex } from "../src/duplicate_keys.ts";

const entries = new Map([
  ["1000000", { sense: [{}] }],
  ["2000000", { sense: [{}, {}] }],
]);

Deno.test("RecognitionUnitIndex expands all senses", () => {
  const index = new RecognitionUnitIndex([
    { noteId: 1, key: "業 | 1000000;2000000" },
  ], entries);

  assertEquals(index.conflicts(2, "業 | 1000000;2000000:1,2"), [1]);
});

Deno.test("RecognitionUnitIndex catches a singleton usage inside a multi-entry card", () => {
  const index = new RecognitionUnitIndex([
    { noteId: 1, key: "業 | 1000000;2000000:1" },
  ], entries);

  assertEquals(index.conflicts(2, "業 | 1000000"), [1]);
  assertEquals(index.conflicts(2, "業 | 2000000:2"), []);
});

Deno.test("RecognitionUnitIndex catches a partially overlapping sense selection", () => {
  const index = new RecognitionUnitIndex([
    { noteId: 1, key: "業 | 2000000:1" },
  ], entries);

  assertEquals(index.conflicts(2, "業 | 2000000"), [1]);
});

Deno.test("RecognitionUnitIndex replaces a note's previous usages after an update", () => {
  const index = new RecognitionUnitIndex([{ noteId: 1, key: "業 | 1000000" }], entries);
  index.update(1, "業 | 2000000:2");

  assertEquals(index.conflicts(2, "業 | 1000000"), []);
  assertEquals(index.conflicts(2, "業 | 2000000:2"), [1]);
});

function card(
  noteId: number,
  key: string,
  exception?: { reason: string; detail: string },
): AnalyzedCard {
  return {
    note: { noteId, fields: { key } },
    verdict: exception === undefined ? "unchanged" : "exception",
    reason: exception?.reason ?? "unchanged",
    detail: exception?.detail ?? "",
    needsAI: false,
  } as AnalyzedCard;
}

Deno.test("flagDuplicateRecognitionUnits marks every conflicting card", () => {
  const cards = flagDuplicateRecognitionUnits([
    card(2, "業 | 1000000;2000000:1"),
    card(1, "業 | 1000000;2000000:2"),
  ], entries);

  assertEquals(cards.map(({ verdict, reason, detail }) => ({ verdict, reason, detail })), [{
    verdict: "exception",
    reason: "duplicate-recognition-unit",
    detail: "Another scanned card represents the same JMDict entry/sense usage. Note IDs: 1, 2.",
  }, {
    verdict: "exception",
    reason: "duplicate-recognition-unit",
    detail: "Another scanned card represents the same JMDict entry/sense usage. Note IDs: 1, 2.",
  }]);
});

Deno.test("flagDuplicateRecognitionUnits preserves a more fundamental exception", () => {
  const cards = flagDuplicateRecognitionUnits([
    card(1, "業 | 1000000;9999999", {
      reason: "entry-deleted",
      detail: "JMDict no longer contains supplemental entry 9999999.",
    }),
    card(2, "業 | 1000000"),
  ], entries);

  assertEquals(cards.map(({ verdict, reason, detail }) => ({ verdict, reason, detail })), [{
    verdict: "exception",
    reason: "entry-deleted",
    detail: "JMDict no longer contains supplemental entry 9999999.",
  }, {
    verdict: "exception",
    reason: "duplicate-recognition-unit",
    detail: "Another scanned card represents the same JMDict entry/sense usage. Note IDs: 1, 2.",
  }]);
});
