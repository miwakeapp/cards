import { assertEquals } from "@std/assert";
import { findSourceUnsupportedHiraganaWords } from "../src/lexical_grounding.ts";

Deno.test("findSourceUnsupportedHiraganaWords consumes copied words as a multiset", () => {
  assertEquals(
    findSourceUnsupportedHiraganaWords("あの、あの方針", "あの方針"),
    ["あの"],
  );
});

Deno.test("findSourceUnsupportedHiraganaWords permits structural grammatical words", () => {
  assertEquals(
    findSourceUnsupportedHiraganaWords("会社の方針が対象だ", "会社、方針、対象"),
    [],
  );
});

Deno.test("findSourceUnsupportedHiraganaWords permits exact dictionary-form normalization", () => {
  assertEquals(findSourceUnsupportedHiraganaWords("ふむ", "ふんでいる"), []);
  assertEquals(findSourceUnsupportedHiraganaWords("する", "話をしていた"), []);
  assertEquals(findSourceUnsupportedHiraganaWords("くる", "ここまできた"), []);
});

Deno.test("findSourceUnsupportedHiraganaWords rejects accidental stem-character overlap", () => {
  assertEquals(findSourceUnsupportedHiraganaWords("ある", "あの会社の方針"), ["ある"]);
});

Deno.test("findSourceUnsupportedHiraganaWords leaves mixed-script grounding to its caller", () => {
  assertEquals(findSourceUnsupportedHiraganaWords("猫を撫でる", "猫を撫でて"), []);
  assertEquals(
    findSourceUnsupportedHiraganaWords("なかなか会えなかった", "なかなか会えなくて"),
    [],
  );
  assertEquals(findSourceUnsupportedHiraganaWords("目と口を開けた", "目と口を開け"), []);
});
