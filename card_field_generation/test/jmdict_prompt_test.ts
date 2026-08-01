import { assertEquals, assertRejects } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { promptJMDictEntry } from "../src/jmdict_prompt.ts";

Deno.test("promptJMDictEntry describes part-of-speech and field tags", async () => {
  const catchEntry = await preextractedJMDictEntry("1041530");

  assertEquals(await promptJMDictEntry(catchEntry, [2]), {
    id: "1041530",
    senses: [{
      number: 2,
      glosses: ["catch"],
      partOfSpeech: [
        "noun (common) (futsuumeishi)",
        "noun or participle which takes the aux. verb suru",
      ],
      field: ["baseball"],
      dialect: undefined,
      misc: undefined,
      info: undefined,
    }],
  });
});

Deno.test("promptJMDictEntry describes miscellaneous tags", async () => {
  const jaggedEntry = await preextractedJMDictEntry("1003560");

  assertEquals(await promptJMDictEntry(jaggedEntry, [1]), {
    id: "1003560",
    senses: [{
      number: 1,
      glosses: [
        "notches",
        "serration",
        "indentation",
        "jaggies (stair-step artifacts in computer images)",
      ],
      partOfSpeech: ["noun (common) (futsuumeishi)"],
      field: undefined,
      dialect: undefined,
      misc: [
        "onomatopoeic or mimetic word",
        "word usually written using kana alone",
      ],
      info: undefined,
    }],
  });
});

Deno.test("promptJMDictEntry describes verb tags", async () => {
  const persevereEntry = await preextractedJMDictEntry("1217700");

  assertEquals((await promptJMDictEntry(persevereEntry, [1])).senses[0].partOfSpeech, [
    "Godan verb with 'ru' ending",
    "intransitive verb",
  ]);
});

Deno.test("promptJMDictEntry rejects unknown tags", async () => {
  const catchEntry = structuredClone(await preextractedJMDictEntry("1041530"));
  catchEntry.sense[1].field = ["not-a-real-jmdict-tag"];

  await assertRejects(
    () => promptJMDictEntry(catchEntry, [2]),
    Error,
    'jmdictEntry with id "1041530" has unknown field tag "not-a-real-jmdict-tag" in sense 2',
  );
});

Deno.test("promptJMDictEntry rejects duplicate and out-of-range sense numbers", async () => {
  const catchEntry = await preextractedJMDictEntry("1041530");

  await assertRejects(
    () => promptJMDictEntry(catchEntry, [2, 2]),
    RangeError,
    'senseNumbers must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1041530"; received [2,2]',
  );
  await assertRejects(
    () => promptJMDictEntry(catchEntry, [7]),
    RangeError,
    'senseNumbers must contain one or more unique integers between 1 and 6, inclusive, for jmdictEntry with id "1041530"; received [7]',
  );
});
