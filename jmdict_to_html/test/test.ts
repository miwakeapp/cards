import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { preextractedJMDictEntry } from "data";

import { formatReadingForAnki, renderEntry } from "../src/mod.ts";

// Entry IDs to test renderEntry with
const RENDER_ENTRY_TEST_IDS = [
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

for (const id of RENDER_ENTRY_TEST_IDS) {
  const word = await preextractedJMDictEntry(id);

  Deno.test(`renderEntry: ${word.id}`, async (t) => {
    const html = renderEntry(word);
    await assertSnapshot(t, html);
  });
}

// Test cases: [jmdictId, word, reading]
const furiganaTestCases: [string, string, string][] = [
  ["2252350", "大人買い", "おとながい"],
  ["1217700", "頑張る", "がんばる"],
  ["1358280", "食べる", "たべる"],
  ["1402540", "走る", "はしる"],
  ["1464530", "日本語", "にほんご"],
  ["1447690", "東京", "とうきょう"],
  ["1485470", "飛行機", "ひこうき"],
  ["1361590", "新幹線", "しんかんせん"],
  ["1370420", "図書館", "としょかん"],
  ["1413260", "大学生", "だいがくせい"],
];

for (const [id, word, reading] of furiganaTestCases) {
  Deno.test(`formatReadingForAnki: ${word}`, async (t) => {
    const result = formatReadingForAnki(id, word, reading);
    await assertSnapshot(t, result);
  });
}

// Kana-only test cases: [jmdictId, kana]
// For these, word === reading, and the result should also equal both
const kanaOnlyTestCases: [string, string][] = [
  ["1591900", "きれい"], // hiragana
  ["1374550", "すごい"], // hiragana
  ["1049180", "コーヒー"], // katakana
  ["1080510", "テレビ"], // katakana
];

for (const [id, kana] of kanaOnlyTestCases) {
  Deno.test(`formatReadingForAnki (kana-only): ${kana}`, () => {
    const result = formatReadingForAnki(id, kana, kana);
    assertEquals(result, kana);
  });
}

// Non-kanji test cases (fullwidth letters, etc.): [jmdictId, word, reading]
const nonKanjiTestCases: [string, string, string][] = [
  ["1000100", "ＡＢＣ順", "エービーシーじゅん"],
  ["1000110", "ＣＤプレーヤー", "シーディープレーヤー"],
];

for (const [id, word, reading] of nonKanjiTestCases) {
  Deno.test(`formatReadingForAnki (non-kanji): ${word}`, async (t) => {
    const result = formatReadingForAnki(id, word, reading);
    await assertSnapshot(t, result);
  });
}

Deno.test("formatReadingForAnki: handles hiragana-katakana swapped surface forms", () => {
  assertEquals(formatReadingForAnki("2643730", "エンジ色", "えんじいろ"), "エンジ 色[いろ]");
  assertEquals(formatReadingForAnki("2643730", "エンジ色", "エンジいろ"), "エンジ 色[いろ]");
});
