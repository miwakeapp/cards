import "../../data/test/use_furigana_fixture.ts";

import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";

import { formatReadingForAnki } from "../src/format_reading_for_anki.ts";

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
    const result = await formatReadingForAnki(id, word, reading);
    await assertSnapshot(t, result);
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

const nonKanjiTestCases: [string, string, string][] = [
  ["1000100", "ＡＢＣ順", "エービーシーじゅん"],
  ["1000110", "ＣＤプレーヤー", "シーディープレーヤー"],
];

for (const [id, word, reading] of nonKanjiTestCases) {
  Deno.test(`formatReadingForAnki (non-kanji): ${word}`, async (t) => {
    const result = await formatReadingForAnki(id, word, reading);
    await assertSnapshot(t, result);
  });
}

Deno.test("formatReadingForAnki: handles hiragana-katakana swapped surface forms", async () => {
  assertEquals(
    await formatReadingForAnki("2643730", "エンジ色", "えんじいろ"),
    "エンジ 色[いろ]",
  );
  assertEquals(
    await formatReadingForAnki("2643730", "エンジ色", "エンジいろ"),
    "エンジ 色[いろ]",
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
