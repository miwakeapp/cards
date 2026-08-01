import { assertEquals, assertRejects } from "@std/assert";
import { markResolvedContextTarget } from "./mark_resolved_context.ts";

Deno.test("markResolvedContextTarget marks every occurrence of the selected spelling", async () => {
  assertEquals(
    await markResolvedContextTarget("かなとかなを比べる。", "かな", ["n"]),
    "<mark>かな</mark>と<mark>かな</mark>を比べる。",
  );
});

Deno.test("markResolvedContextTarget does not mark the same surface in another lexical item", async () => {
  assertEquals(
    await markResolvedContextTarget("彼の考えとは異なるが、結果はこうなる。", "なる", ["v5r"]),
    "彼の考えとは異なるが、結果はこう<mark>なる</mark>。",
  );
});

Deno.test("markResolvedContextTarget rejects a kana-script substitution", async () => {
  await assertRejects(
    () => markResolvedContextTarget("カナを比べる。", "かな", ["n"]),
    Error,
    `changed the kana script of recognitionTarget "かな" to source surface "カナ"`,
  );
});

Deno.test("markResolvedContextTarget rejects one-kanji targets embedded in compounds", async () => {
  await assertRejects(
    () => markResolvedContextTarget("懐中から懐を出す。", "懐", ["n"]),
    Error,
    `source surface "懐"`,
  );
});

Deno.test("markResolvedContextTarget allows one-kanji counters after numerals", async () => {
  assertEquals(
    await markResolvedContextTarget("二棟建っている。", "棟", ["ctr"]),
    "二<mark>棟</mark>建っている。",
  );
});

Deno.test("markResolvedContextTarget rejects multi-kanji targets embedded in compounds", async () => {
  await assertRejects(
    () => markResolvedContextTarget("会社員が会社にいる。", "会社", ["n"]),
    Error,
    `source surface "会社"`,
  );
});

Deno.test("markResolvedContextTarget allows JMDict prefix and suffix attachment", async () => {
  assertEquals(
    await markResolvedContextTarget("積極的な人だ。", "的", ["suf"]),
    "積極<mark>的</mark>な人だ。",
  );
  assertEquals(
    await markResolvedContextTarget("万年平社員だ。", "万年", ["pref"]),
    "<mark>万年</mark>平社員だ。",
  );
});
