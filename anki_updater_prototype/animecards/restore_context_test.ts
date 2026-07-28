import { assertEquals } from "@std/assert";
import { entrySelectionOverride } from "./entry_selection.ts";
import type { ConversionCandidate } from "./types.ts";

Deno.test("entrySelectionOverride replays the selected entry, senses, and hint", () => {
  const candidate = {
    jmdictId: "1416170",
    keyRecognitionTarget: "叩く",
    jmdictEntryResolution: {
      model: "gemini-3.6-flash",
      generatedAt: "2026-07-27T00:00:00.000Z",
      applicableSenseNumbers: [1],
      hint: "肩を叩く",
      candidateJMDictIds: ["1416170", "2829135"],
      allowedJMDictIds: ["1416170"],
    },
  } as ConversionCandidate;

  assertEquals(entrySelectionOverride(candidate), {
    jmdictId: "1416170",
    recognitionTarget: "叩く",
    applicableSenseNumbers: [1],
    hint: "肩を叩く",
    model: "gemini-3.6-flash",
    generatedAt: "2026-07-27T00:00:00.000Z",
    candidateJMDictIds: ["1416170", "2829135"],
    allowedJMDictIds: ["1416170"],
  });
});

Deno.test("entrySelectionOverride omits ordinary candidates", () => {
  assertEquals(
    entrySelectionOverride({ jmdictEntryResolution: undefined } as ConversionCandidate),
    undefined,
  );
});
