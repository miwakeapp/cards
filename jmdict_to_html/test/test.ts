import * as path from "@std/path";
import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";

import { formatReadingForAnki, renderEntry } from "../src/mod.ts";

for await (const dirEntry of Deno.readDir(path.resolve(import.meta.dirname!, "inputs"))) {
  const json = await Deno.readTextFile(path.resolve(import.meta.dirname!, "inputs", dirEntry.name));
  const word = JSON.parse(json) as JMdictWord;

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
