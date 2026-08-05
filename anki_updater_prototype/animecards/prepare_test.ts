import { assertEquals } from "@std/assert";
import type { JMDictWord } from "data";
import { removeDuplicateKeys } from "./duplicate_keys.ts";
import type { ConversionCandidate } from "./types.ts";

function entry(id: string, senseCount = 1): JMDictWord {
  return { id, sense: Array.from({ length: senseCount }, () => ({})) } as unknown as JMDictWord;
}

function candidate(noteId: number, key: string): ConversionCandidate {
  return {
    noteId,
    senseResolution: { status: "determined", applicableSenses: [1] },
    target: { fields: { "Key": key } },
    original: { fields: { Word: key.split("|")[0].trim() } },
  } as unknown as ConversionCandidate;
}

Deno.test("removeDuplicateKeys catches an equivalent usage anchored to another entry", () => {
  const entries = new Map([
    ["1000000", entry("1000000")],
    ["2000000", entry("2000000", 2)],
  ]);
  const result = removeDuplicateKeys(
    [candidate(1, "業 | 1000000;2000000")],
    [{ noteId: 2, key: "業 | 2000000:2" }],
    "Word",
    entries,
  );

  assertEquals(result.candidates, []);
  assertEquals(result.skipped, [{
    noteId: 1,
    word: "業",
    reason: "duplicate-miwake-recognition-unit",
    detail: "業 | 1000000;2000000; note IDs: 1, 2",
  }]);
});
