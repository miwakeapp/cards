import { assertEquals } from "@std/assert";
import { checkpointMatchesInput, createCheckpointManifest } from "./checkpoint.ts";
import { CONVERSION_MANIFEST_VERSION, type ConversionManifest } from "./types.ts";

function manifest(): ConversionManifest {
  return {
    version: CONVERSION_MANIFEST_VERSION,
    generatedAt: "2026-07-21T00:00:00.000Z",
    query: "note:Animecards",
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: {
      word: "Word",
      sentence: "Sentence",
      glossary: "Glossary",
      reading: "Reading",
      source: "Source",
      sourceURL: "Source URL",
    },
    candidates: [],
    skipped: [],
  };
}

Deno.test("checkpoint fingerprint rejects an edited input manifest", async () => {
  const input = manifest();
  const checkpoint = await createCheckpointManifest(input);
  assertEquals(await checkpointMatchesInput(input, checkpoint), true);

  input.query = "note:Animecards approved:true";
  assertEquals(await checkpointMatchesInput(input, checkpoint), false);
});

Deno.test("checkpoint fingerprint covers candidate review decisions", async () => {
  const input = manifest();
  input.candidates = [{ approved: true }] as ConversionManifest["candidates"];
  const checkpoint = await createCheckpointManifest(input);

  input.candidates[0].approved = false;
  assertEquals(await checkpointMatchesInput(input, checkpoint), false);
});

Deno.test("checkpoint output may change without breaking its input relationship", async () => {
  const input = manifest();
  const checkpoint = await createCheckpointManifest(input);
  checkpoint.query = "stage output mutation";

  assertEquals(await checkpointMatchesInput(input, checkpoint), true);
});
