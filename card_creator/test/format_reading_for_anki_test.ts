import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";

import { formatReadingForAnki } from "../src/format_reading_for_anki.ts";

const furiganaTestCases: [string, string, string, string][] = [
  ["2252350", "大人買い", "おとながい", "大人[おとな] 買[が]い"],
  ["1217700", "頑張る", "がんばる", "頑[がん] 張[ば]る"],
  ["1358280", "食べる", "たべる", "食[た]べる"],
  ["1402540", "走る", "はしる", "走[はし]る"],
  ["1464530", "日本語", "にほんご", "日[に] 本[ほん] 語[ご]"],
  ["1447690", "東京", "とうきょう", "東[とう] 京[きょう]"],
  ["1485470", "飛行機", "ひこうき", "飛[ひ] 行[こう] 機[き]"],
  ["1361590", "新幹線", "しんかんせん", "新[しん] 幹[かん] 線[せん]"],
  ["1370420", "図書館", "としょかん", "図[と] 書[しょ] 館[かん]"],
  ["1413260", "大学生", "だいがくせい", "大[だい] 学[がく] 生[せい]"],
];

for (const [id, word, reading, expected] of furiganaTestCases) {
  Deno.test(`formatReadingForAnki: ${word}`, async () => {
    assertEquals(await formatReadingForAnki(id, word, reading), expected);
  });
}

const kanaOnlyTestCases: [string, string][] = [
  ["1591900", "きれい"],
  ["1374550", "すごい"],
  ["1049180", "コーヒー"],
  ["1080510", "テレビ"],
];

for (const [id, kana] of kanaOnlyTestCases) {
  Deno.test(`formatReadingForAnki (kana-only): ${kana}`, async () => {
    const result = await formatReadingForAnki(id, kana, kana);
    assertEquals(result, kana);
  });
}

const nonKanjiTestCases: [string, string, string, string][] = [
  ["1000100", "ＡＢＣ順", "エービーシーじゅん", "Ａ[エー] Ｂ[ビー] Ｃ[シー] 順[じゅん]"],
  ["1000110", "ＣＤプレーヤー", "シーディープレーヤー", "Ｃ[シー] Ｄ[ディー]プレーヤー"],
];

for (const [id, word, reading, expected] of nonKanjiTestCases) {
  Deno.test(`formatReadingForAnki (non-kanji): ${word}`, async () => {
    assertEquals(await formatReadingForAnki(id, word, reading), expected);
  });
}

Deno.test("formatReadingForAnki requires an exact spelling and reading", async () => {
  assertEquals(
    await formatReadingForAnki("1217700", "頑張る", "がんばる"),
    "頑[がん] 張[ば]る",
  );
  assertEquals(
    await formatReadingForAnki("1217700", "頑張ル", "がんばる"),
    null,
  );
  assertEquals(
    await formatReadingForAnki("1217700", "頑張る", "ガンバル"),
    null,
  );
  assertEquals(
    await formatReadingForAnki("1217700", "頑張ル", "ガンバル"),
    null,
  );
});

Deno.test("formatReadingForAnki: uses an imported search-only kanji spelling", async () => {
  assertEquals(
    await formatReadingForAnki("1686540", "種つけ", "たねつけ"),
    "種[たね]つけ",
  );
  assertEquals(
    await formatReadingForAnki("0000000", "種つけ", "たねつけ"),
    null,
  );
});

Deno.test("formatReadingForAnki: directly annotates a single kanji", async () => {
  assertEquals(await formatReadingForAnki("0000000", "炬", "たいまつ"), "炬[たいまつ]");
});
