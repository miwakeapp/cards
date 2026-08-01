import { assertEquals } from "@std/assert";
import type { JMDictWord } from "data";
import { buildSpellingIndex, findAllEntriesBySpelling } from "../src/mod.ts";

function jmdictWord(id: string, kanji: string[], kana: string[]): JMDictWord {
  return {
    id,
    kanji: kanji.map((text) => ({ common: false, text, tags: [] })),
    kana: kana.map((text) => ({
      common: false,
      text,
      tags: [],
      appliesToKanji: ["*"],
    })),
    sense: [],
  };
}

Deno.test("findAllEntriesBySpelling unions JMDict form categories", () => {
  const kanjiEntry = jmdictWord("kanji", ["悪戯"], ["いたずら"]);
  const kanaCollision = jmdictWord("kana-collision", [], ["悪戯"]);
  const bothCategories = jmdictWord("both", ["悪戯"], ["悪戯"]);
  const index = buildSpellingIndex([kanjiEntry, kanaCollision, bothCategories]);

  assertEquals(findAllEntriesBySpelling(index, "悪戯"), [
    kanjiEntry,
    bothCategories,
    kanaCollision,
  ]);
  assertEquals(findAllEntriesBySpelling(index, "不存在"), []);
});
