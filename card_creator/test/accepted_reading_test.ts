import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { formatAcceptedReadingsForAnki } from "card_creator/accepted-reading";
import { preextractedJMDictEntry } from "data";

Deno.test("formatAcceptedReadingsForAnki validates and canonically orders alternatives", async () => {
  const lowerId = await preextractedJMDictEntry("1645430");
  const higherId = await preextractedJMDictEntry("2863046");

  assertEquals(
    await formatAcceptedReadingsForAnki({
      jmdictUsages: [{ entry: higherId }, { entry: lowerId }],
      kanaReadings: ["すぎわい", "なりわい"],
      recognitionTarget: "生業",
    }),
    ["生業[なりわい]", "生業[すぎわい]"],
  );
});

Deno.test("formatAcceptedReadingsForAnki returns null for a kana target", async () => {
  const entry = await preextractedJMDictEntry("1000230");
  assertEquals(
    await formatAcceptedReadingsForAnki({
      jmdictUsages: [{ entry }],
      recognitionTarget: "あかん",
    }),
    null,
  );
});
