import { assertEquals, assertNotEquals } from "@std/assert";
import { generationCacheKey } from "card_field_generation";
import { type JMDictWord, preextractedJMDictEntry } from "data";
import { evalFixtureHashContent, evalFixtureSetHashContent } from "../src/generation_inputs.ts";
import type { HintFixture, SenseSelectionFixture } from "../src/types.ts";

const PROVENANCE = {
  corpus: "test",
  sourceNoteId: 1,
  artifact: "test.json",
};

const SENSE_FIXTURE: SenseSelectionFixture = {
  operation: "sense-selection",
  id: "jmdict-semantic-identity",
  provenance: PROVENANCE,
  evaluation: { promptOverlap: false, referenceBasis: "agent-reviewed" },
  input: {
    context: "規則を<mark>踏む</mark>。",
    recognitionTarget: "踏む",
    jmdictId: "1450270",
    compatibleSenseNumbers: [1],
  },
  expected: { outcome: { outcome: "selected", senseNumbers: [1] } },
};

const HINT_FIXTURE: HintFixture = {
  operation: "hint",
  id: "jmdict-contrast-semantic-identity",
  provenance: PROVENANCE,
  evaluation: { promptOverlap: false, referenceBasis: "agent-reviewed" },
  input: {
    context: "規則を<mark>踏む</mark>。",
    recognitionTarget: "踏む",
    selectedUsage: { jmdictId: "1450270", senseNumbers: [1] },
    contrastingUsages: [{ jmdictId: "1450270", senseNumbers: [2] }],
  },
  expected: {
    disposition: "generated",
    preferredHints: ["規則を踏む"],
    acceptableHints: [],
    observedBadHints: [],
    rubricNotes: ["Keep the selected and contrasting dictionary evidence identifiable."],
  },
};

function loader(entry: JMDictWord): (id: string) => Promise<JMDictWord> {
  return (id) => {
    assertEquals(id, entry.id);
    return Promise.resolve(entry);
  };
}

async function fixtureHash(
  fixture: SenseSelectionFixture | HintFixture,
  entry: JMDictWord,
): Promise<string> {
  return await generationCacheKey(await evalFixtureHashContent(fixture, loader(entry)));
}

Deno.test("eval fixture hashes track only prompt-visible selected JMDict semantics", async () => {
  const entry = await preextractedJMDictEntry("1450270");
  const baselineHash = await fixtureHash(SENSE_FIXTURE, entry);

  const irrelevantDrift = structuredClone(entry);
  irrelevantDrift.kanji[0].common = !irrelevantDrift.kanji[0].common;
  irrelevantDrift.sense[1].gloss[0].text += " (changed outside the selected projection)";
  assertEquals(await fixtureHash(SENSE_FIXTURE, irrelevantDrift), baselineHash);

  const glossDrift = structuredClone(entry);
  glossDrift.sense[0].gloss[0].text += " (changed selected gloss)";
  assertNotEquals(await fixtureHash(SENSE_FIXTURE, glossDrift), baselineHash);

  const tagDrift = structuredClone(entry);
  tagDrift.sense[0].misc.push("arch");
  assertNotEquals(await fixtureHash(SENSE_FIXTURE, tagDrift), baselineHash);
});

Deno.test("hint and selected-set hashes track contrasting JMDict prompt semantics", async () => {
  const entry = await preextractedJMDictEntry("1450270");
  const baselineFixtureHash = await fixtureHash(HINT_FIXTURE, entry);
  const baselineSetHash = await generationCacheKey(
    await evalFixtureSetHashContent([SENSE_FIXTURE, HINT_FIXTURE], loader(entry)),
  );

  const contrastDrift = structuredClone(entry);
  contrastDrift.sense[1].info.push("Changed prompt-visible contrast information.");
  assertNotEquals(await fixtureHash(HINT_FIXTURE, contrastDrift), baselineFixtureHash);
  assertNotEquals(
    await generationCacheKey(
      await evalFixtureSetHashContent(
        [SENSE_FIXTURE, HINT_FIXTURE],
        loader(contrastDrift),
      ),
    ),
    baselineSetHash,
  );
});
