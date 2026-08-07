import "./use_jmdict_fixtures.ts";
import { assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { jmdictReadingsForSpelling } from "../src/mod.ts";
import { buildJMDictReadings } from "../src/jmdict_readings.ts";

Deno.test("buildJMDictReadings respects reading-to-spelling restrictions", () => {
  const entry: JMdictWord = {
    id: "1",
    kanji: [
      { common: false, text: "甲", tags: [] },
      { common: false, text: "乙", tags: [] },
    ],
    kana: [
      { common: false, text: "こう", tags: [], appliesToKanji: ["甲"] },
      { common: false, text: "おつ", tags: [], appliesToKanji: ["乙"] },
      { common: false, text: "きのえ", tags: [], appliesToKanji: ["*"] },
      { common: false, text: "フン", tags: [], appliesToKanji: [] },
    ],
    sense: [],
  };

  assertEquals(buildJMDictReadings([entry]), {
    "甲": ["こう", "きのえ", "フン"],
    "乙": ["おつ", "きのえ", "フン"],
  });
});

Deno.test("jmdictReadingsForSpelling uses the compact runtime index", async () => {
  assertEquals(await jmdictReadingsForSpelling("赦"), ["しゃ"]);
  assertEquals(await jmdictReadingsForSpelling("存在しない綴り"), []);
});
