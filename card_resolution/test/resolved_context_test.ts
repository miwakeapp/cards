import { assertEquals } from "@std/assert";
import { resolveContextTarget } from "card_resolution";

Deno.test("resolveContextTarget preserves occurrence identity across structured HTML", async () => {
  const contextHTML =
    "<p>彼の考えとは<ruby>異<rt>こと</rt></ruby>なるが、</p><p>結果はこうなる。</p>";
  const result = await resolveContextTarget(contextHTML, "なる", { partOfSpeech: ["v5r"] });

  assertEquals(result, {
    lookupSpelling: "なる",
    renderedText: "彼の考えとは異なるが、\n結果はこうなる。\n",
    occurrences: [{ start: 17, end: 19, surface: "なる" }],
    surfaces: ["なる"],
    markedHTML:
      "<p>彼の考えとは<ruby>異<rt>こと</rt></ruby>なるが、</p><p>結果はこう<mark>なる</mark>。</p>",
  });
});

Deno.test("resolveContextTarget returns null without a supported occurrence", async () => {
  assertEquals(
    await resolveContextTarget("<p>好きな食べ物は寿司だ。</p>", "食べる", {
      partOfSpeech: ["v1"],
    }),
    null,
  );
});

Deno.test("resolveContextTarget rejects an inflection embedded in another lexical item", async () => {
  assertEquals(
    await resolveContextTarget("焼け跡を見た。", "焼く", {
      partOfSpeech: ["v5k"],
    }),
    null,
  );
});

Deno.test("resolveContextTarget rejects a kana noun embedded in another lexical item", async () => {
  assertEquals(
    await resolveContextTarget("フライパンを買った。", "パン", {
      partOfSpeech: ["n"],
    }),
    null,
  );
});

Deno.test("resolveContextTarget maps presentational spaces back to exact HTML ranges", async () => {
  const result = await resolveContextTarget("頼っ <span>た</span>り頼られたりした。", "頼る", {
    partOfSpeech: ["v5r"],
  });

  assertEquals(result?.surfaces, ["頼ったり", "頼られたり"]);
  assertEquals(result?.occurrences, [
    { start: 0, end: 5, surface: "頼っ たり" },
    { start: 5, end: 10, surface: "頼られたり" },
  ]);
  assertEquals(
    result?.markedHTML,
    "<mark>頼っ <span>た</span>り</mark><mark>頼られたり</mark>した。",
  );
});

Deno.test("resolveContextTarget stops before a desiderative auxiliary", async () => {
  const result = await resolveContextTarget(
    "あんな人に呼び捨てにされたくない。",
    "呼び捨てにする",
    { partOfSpeech: ["exp", "vs-i"] },
  );

  assertEquals(result?.surfaces, ["呼び捨てにされ"]);
  assertEquals(
    result?.markedHTML,
    "あんな人に<mark>呼び捨てにされ</mark>たくない。",
  );
});

Deno.test("resolveContextTarget leaves a causative outside a noun target", async () => {
  const result = await resolveContextTarget("敵を全滅させた。", "全滅", {
    partOfSpeech: ["n"],
  });

  assertEquals(result?.surfaces, ["全滅"]);
  assertEquals(result?.markedHTML, "敵を<mark>全滅</mark>させた。");
});

Deno.test("resolveContextTarget includes finite morphology without sentence-final particles", async () => {
  const irregular = await resolveContextTarget("明日来ますか。", "来る", {
    partOfSpeech: ["vk"],
  });
  assertEquals(irregular?.markedHTML, "明日<mark>来ます</mark>か。");
  assertEquals(irregular?.surfaces, ["来ます"]);

  const politeVolitional = await resolveContextTarget("一緒に食べましょう。", "食べる", {
    partOfSpeech: ["v1"],
  });
  assertEquals(politeVolitional?.markedHTML, "一緒に<mark>食べましょう</mark>。");
  assertEquals(politeVolitional?.surfaces, ["食べましょう"]);
});

Deno.test("resolveContextTarget includes conditional inflection but not a missing lexical particle", async () => {
  const conditional = await resolveContextTarget(
    "横になったら、ついうとうとしてしまった。",
    "横になる",
    { partOfSpeech: ["v5r"] },
  );
  assertEquals(
    conditional?.markedHTML,
    "<mark>横になったら</mark>、ついうとうとしてしまった。",
  );
  assertEquals(conditional?.surfaces, ["横になったら"]);

  assertEquals(
    await resolveContextTarget("ちょっくらオレも様子見てくら。", "様子を見る", {
      partOfSpeech: ["exp", "v1"],
    }),
    null,
  );
});
