import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { compatibleSenseNumbersForJMDictUsage } from "../src/mod.ts";

Deno.test("compatibleSenseNumbersForJMDictUsage applies reading restrictions", async () => {
  const entry = await preextractedJMDictEntry("1158110");

  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "異名", "いみょう"),
    [1],
  );
  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "異名", "いめい"),
    [1, 2],
  );
  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "いみょう", undefined),
    [1],
  );
});

Deno.test("compatibleSenseNumbersForJMDictUsage retains unrestricted senses", async () => {
  const entry = await preextractedJMDictEntry("1414110");

  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "大小", "だいしょう"),
    [1, 2, 3, 4, 5, 6],
  );
});

Deno.test("compatibleSenseNumbersForJMDictUsage applies spelling restrictions", async () => {
  const entry = await preextractedJMDictEntry("2013080");

  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "歿する", "ぼっする"),
    [2],
  );
  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "没する", "ぼっする"),
    [1, 2, 3, 4],
  );
});
