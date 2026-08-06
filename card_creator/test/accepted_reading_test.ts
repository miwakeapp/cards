import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { resolveAcceptedReadingsForAnki } from "card_creator/accepted-reading";
import { preextractedJMDictEntry } from "data";

Deno.test("resolveAcceptedReadingsForAnki preserves exact readings while ordering them", async () => {
  const lowerId = await preextractedJMDictEntry("1645430");
  const higherId = await preextractedJMDictEntry("2863046");

  assertEquals(
    await resolveAcceptedReadingsForAnki({
      jmdictUsages: [{ entry: higherId }, { entry: lowerId }],
      kanaReadings: ["すぎわい", "なりわい"],
      recognitionTarget: "生業",
    }),
    {
      kanaReadings: ["なりわい", "すぎわい"],
      formattedReadings: ["生業[なりわい]", "生業[すぎわい]"],
    },
  );
});

Deno.test("resolveAcceptedReadingsForAnki returns null readings for a kana target", async () => {
  const entry = await preextractedJMDictEntry("1000230");
  assertEquals(
    await resolveAcceptedReadingsForAnki({
      jmdictUsages: [{ entry }],
      recognitionTarget: "あかん",
    }),
    { kanaReadings: null, formattedReadings: null },
  );
});
