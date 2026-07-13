import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { preextractedJMDictEntry } from "data";

import { renderEntry } from "../src/mod.ts";

const TEST_ENTRY_IDS = [
  "2030540", // 狂喜乱舞, simple entry
  "1414110", // 大小, one reading, multiple senses, per-sense tags
  "1590470", // 画期的, multiple readings, one sense
  "1000230", // あかん, dialect + misc/info
  "1014630", // アウター, antonyms + abbr sense
  "1061000", // シノニム, related sense references + fields
  "1122910", // ホルモン, language source + dialect sense
  "1158110", // 異名, reading restrictions + fields
  "1632080", // 松明, gikun + kanji tags
  "2013080", // 没する, applies-to restrictions + vt/vi mix
  "1178920", // 於いて, shared info + related sense references
  "2228700", // 彼岸桜, shared related tags + mixed misc
  "2861582", // トスアップ, shared field + language source
  "1604990", // 目にあう, lots of forms
];

for (const id of TEST_ENTRY_IDS) {
  const word = await preextractedJMDictEntry(id);

  Deno.test(`renderEntry: ${word.id}`, async (t) => {
    const html = renderEntry(word);
    await assertSnapshot(t, html);
  });
}

Deno.test("renderEntry: escapes text minimally (apostrophes stay literal)", () => {
  const word = {
    id: "9999999",
    kanji: [],
    kana: [{ common: true, text: "てすと", tags: [], appliesToKanji: ["*"] }],
    sense: [{
      partOfSpeech: ["n"],
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: ["A & B <see 'note'>"],
      languageSource: [],
      gloss: [{ lang: "eng", gender: null, type: null, text: `when it's "most" important` }],
    }],
  } as Parameters<typeof renderEntry>[0];

  const html = renderEntry(word);
  // Apostrophes and double quotes stay literal in text content, so stored card HTML doesn't
  // churn on re-render; only `&`, `<`, and `>` are escaped.
  assertEquals(html.includes(`<li>when it's "most" important</li>`), true);
  assertEquals(html.includes("<li>A &amp; B &lt;see 'note'&gt;</li>"), true);
});
