import { assertEquals, assertThrows } from "@std/assert";
import {
  containsKanji,
  isKanji,
  parseAnkiFurigana,
  smallKanaForFullSizeKana,
  toHiragana,
} from "japanese_text";

Deno.test("toHiragana converts katakana without changing the original orthography otherwise", () => {
  assertEquals(toHiragana("面子メンツ・ゲームー"), "面子めんつ・げーむー");
});

Deno.test("containsKanji detects Han characters anywhere in text", () => {
  assertEquals(containsKanji("かな漢字"), true);
  assertEquals(containsKanji("カタカナだけ"), false);
});

Deno.test("isKanji requires exactly one Han character", () => {
  assertEquals(isKanji("漢"), true);
  assertEquals(isKanji("𠮷"), true);
  assertEquals(isKanji(""), false);
  assertEquals(isKanji("漢字"), false);
  assertEquals(isKanji("か"), false);
  assertEquals(isKanji("漢か"), false);
});

Deno.test("smallKanaForFullSizeKana maps every supported hiragana and katakana", () => {
  assertEquals(smallKanaForFullSizeKana("あ"), "ぁ");
  assertEquals(smallKanaForFullSizeKana("い"), "ぃ");
  assertEquals(smallKanaForFullSizeKana("う"), "ぅ");
  assertEquals(smallKanaForFullSizeKana("え"), "ぇ");
  assertEquals(smallKanaForFullSizeKana("お"), "ぉ");
  assertEquals(smallKanaForFullSizeKana("や"), "ゃ");
  assertEquals(smallKanaForFullSizeKana("ゆ"), "ゅ");
  assertEquals(smallKanaForFullSizeKana("よ"), "ょ");
  assertEquals(smallKanaForFullSizeKana("つ"), "っ");
  assertEquals(smallKanaForFullSizeKana("わ"), "ゎ");
  assertEquals(smallKanaForFullSizeKana("か"), "ゕ");
  assertEquals(smallKanaForFullSizeKana("け"), "ゖ");
  assertEquals(smallKanaForFullSizeKana("ア"), "ァ");
  assertEquals(smallKanaForFullSizeKana("イ"), "ィ");
  assertEquals(smallKanaForFullSizeKana("ウ"), "ゥ");
  assertEquals(smallKanaForFullSizeKana("エ"), "ェ");
  assertEquals(smallKanaForFullSizeKana("オ"), "ォ");
  assertEquals(smallKanaForFullSizeKana("ヤ"), "ャ");
  assertEquals(smallKanaForFullSizeKana("ユ"), "ュ");
  assertEquals(smallKanaForFullSizeKana("ヨ"), "ョ");
  assertEquals(smallKanaForFullSizeKana("ツ"), "ッ");
  assertEquals(smallKanaForFullSizeKana("ワ"), "ヮ");
  assertEquals(smallKanaForFullSizeKana("カ"), "ヵ");
  assertEquals(smallKanaForFullSizeKana("ケ"), "ヶ");
});

Deno.test("smallKanaForFullSizeKana requires exactly one Unicode code point", () => {
  assertThrows(
    () => smallKanaForFullSizeKana(""),
    RangeError,
    "character must contain exactly one Unicode code point",
  );
  assertThrows(
    () => smallKanaForFullSizeKana("あい"),
    RangeError,
    "character must contain exactly one Unicode code point",
  );
  assertThrows(
    () => smallKanaForFullSizeKana("漢字"),
    RangeError,
    "character must contain exactly one Unicode code point",
  );
  assertThrows(
    () => smallKanaForFullSizeKana("aつ"),
    RangeError,
    "character must contain exactly one Unicode code point",
  );
});

Deno.test("smallKanaForFullSizeKana returns undefined for other characters", () => {
  assertEquals(smallKanaForFullSizeKana("漢"), undefined);
  assertEquals(smallKanaForFullSizeKana("々"), undefined);
  assertEquals(smallKanaForFullSizeKana("ん"), undefined);
  assertEquals(smallKanaForFullSizeKana("ン"), undefined);
  assertEquals(smallKanaForFullSizeKana("ぁ"), undefined);
  assertEquals(smallKanaForFullSizeKana("ァ"), undefined);
  assertEquals(smallKanaForFullSizeKana("ｱ"), undefined);
  assertEquals(smallKanaForFullSizeKana("ー"), undefined);
  assertEquals(smallKanaForFullSizeKana("。"), undefined);
  assertEquals(smallKanaForFullSizeKana("a"), undefined);
  assertEquals(smallKanaForFullSizeKana("1"), undefined);
  assertEquals(smallKanaForFullSizeKana("🙂"), undefined);
});

Deno.test("parseAnkiFurigana recovers surface text and reading", () => {
  assertEquals(parseAnkiFurigana("その 異[い] 名[みょう]"), {
    surface: "その異名",
    reading: "そのいみょう",
    parts: [
      { type: "plain", text: "その" },
      { type: "ruby", base: "異", reading: "い" },
      { type: "ruby", base: "名", reading: "みょう" },
    ],
  });
  assertEquals(parseAnkiFurigana("気[き] [っ] 風[ぷ]"), {
    surface: "気風",
    reading: "きっぷ",
    parts: [
      { type: "ruby", base: "気", reading: "き" },
      { type: "ruby", base: "", reading: "っ" },
      { type: "ruby", base: "風", reading: "ぷ" },
    ],
  });
});

Deno.test("parseAnkiFurigana rejects malformed bracket syntax", () => {
  assertEquals(parseAnkiFurigana(""), null);
  assertEquals(parseAnkiFurigana("食[]べる"), null);
  assertEquals(parseAnkiFurigana("食[たべる"), null);
  assertEquals(parseAnkiFurigana("食[た[べ]る"), null);
});
