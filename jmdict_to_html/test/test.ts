import * as path from "@std/path";
import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";

import { formatReadingForAnki, renderEntry } from "../src/mod.ts";

for await (const dirEntry of Deno.readDir(path.resolve(import.meta.dirname!, "inputs"))) {
  const json = await Deno.readTextFile(path.resolve(import.meta.dirname!, "inputs", dirEntry.name));
  const word = JSON.parse(json) as JMdictWord;

  Deno.test(word.id, async (t) => {
    const html = renderEntry(word);
    await assertSnapshot(t, html);
  });
}

const furiganaTestCases: [string, string][] = [
  ["大人買い", "おとながい"],
  ["頑張る", "がんばる"],
  ["食べる", "たべる"],
  ["走る", "はしる"],
  ["日本語", "にほんご"],
  ["東京", "とうきょう"],
  ["飛行機", "ひこうき"],
  ["新幹線", "しんかんせん"],
  ["図書館", "としょかん"],
  ["大学生", "だいがくせい"],
];

for (const [word, reading] of furiganaTestCases) {
  Deno.test(`formatReadingForAnki: ${word}`, async (t) => {
    const result = formatReadingForAnki(word, reading);
    await assertSnapshot(t, result);
  });
}

// Kana-only test cases: for these, word === reading, and the result should also equal both
const kanaOnlyTestCases: string[] = [
  "きれい",  // hiragana
  "すごい",  // hiragana
  "コーヒー", // katakana
  "テレビ",   // katakana
];

for (const kana of kanaOnlyTestCases) {
  Deno.test(`formatReadingForAnki (kana-only): ${kana}`, () => {
    const result = formatReadingForAnki(kana, kana);
    assertEquals(result, kana);
  });
}
