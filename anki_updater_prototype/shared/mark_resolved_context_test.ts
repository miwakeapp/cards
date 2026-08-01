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

Deno.test("markResolvedContextTarget allows multi-kanji words inside compounds", async () => {
  assertEquals(
    await markResolvedContextTarget("原始社会の社会運動家だ。", "原始", ["n", "adj-no"]),
    "<mark>原始</mark>社会の社会運動家だ。",
  );
  assertEquals(
    await markResolvedContextTarget("原始社会の社会運動家だ。", "運動家", ["n"]),
    "原始社会の社会<mark>運動家</mark>だ。",
  );
});

Deno.test("markResolvedContextTarget allows kana-ended surfaces before kanji", async () => {
  assertEquals(
    await markResolvedContextTarget("自分は無力だと居直って怠惰の言い訳をする。", "居直る", [
      "v5r",
    ]),
    "自分は無力だと<mark>居直って</mark>怠惰の言い訳をする。",
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
