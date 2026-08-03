import { assertEquals, assertRejects } from "@std/assert";
import { resolveContextTarget, verifyMarkedContextTarget } from "card_resolution";

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

Deno.test("verifyMarkedContextTarget accepts stored markup resolved from lexical morphology", async () => {
  await verifyMarkedContextTarget(
    "<p>最後まで<mark>頑張[がんば]らん</mark>ばかりの勢いだ。</p>",
    "頑張る",
    { partOfSpeech: ["v5r"] },
  );
  await verifyMarkedContextTarget(
    "<mark>頼っ <span>た</span>り</mark>、また頼ったりした。",
    "頼る",
    { partOfSpeech: ["v5r"] },
  );
  await verifyMarkedContextTarget("昨日は<mark>サボった</mark>。", "サボる", {
    partOfSpeech: ["v5r"],
  });
});

Deno.test("verifyMarkedContextTarget rejects unsupported and exact-script mismatches", async () => {
  await assertRejects(
    () =>
      verifyMarkedContextTarget("会社の<mark>犬</mark>を決めた。", "方針", {
        partOfSpeech: ["n"],
      }),
    Error,
    'surface "犬", which is not a deterministically supported exact-script occurrence of lookupSpelling "方針"',
  );
  await assertRejects(
    () =>
      verifyMarkedContextTarget("紙の端が<mark>ギザギザ</mark>だ。", "ぎざぎざ", {
        partOfSpeech: ["adj-na"],
      }),
    Error,
    'surface "ギザギザ", which is not a deterministically supported exact-script occurrence of lookupSpelling "ぎざぎざ"',
  );
  await assertRejects(
    () =>
      verifyMarkedContextTarget("ひどく<mark>どん引キ</mark>した。", "ドン引き", {
        partOfSpeech: ["n", "vs"],
      }),
    Error,
    'surface "どん引キ", which is not a deterministically supported exact-script occurrence of lookupSpelling "ドン引き"',
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

Deno.test("resolveContextTarget includes tightly bound desiderative morphology", async () => {
  assertEquals(
    (await resolveContextTarget("いつか着物を縫いたい。", "縫う", {
      partOfSpeech: ["v5u"],
    }))?.markedHTML,
    "いつか着物を<mark>縫いたい</mark>。",
  );
  assertEquals(
    (await resolveContextTarget("あんな人に呼び捨てにされたくない。", "呼び捨てにする", {
      partOfSpeech: ["exp", "vs-i"],
    }))?.markedHTML,
    "あんな人に<mark>呼び捨てにされたくない</mark>。",
  );
  assertEquals(
    (await resolveContextTarget("昨日は早く帰りたかった。", "帰る", {
      partOfSpeech: ["v5r"],
    }))?.markedHTML,
    "昨日は早く<mark>帰りたかった</mark>。",
  );
  assertEquals(
    (await resolveContextTarget("それを食べたいです。", "食べる", {
      partOfSpeech: ["v1"],
    }))?.markedHTML,
    "それを<mark>食べたい</mark>です。",
  );
});

Deno.test("resolveContextTarget distinguishes appearance そう from hearsay そうだ", async () => {
  assertEquals(
    (await resolveContextTarget("収入が前年を上回りそうだ。", "上回る", {
      partOfSpeech: ["v5r"],
    }))?.markedHTML,
    "収入が前年を<mark>上回りそうだ</mark>。",
  );
  assertEquals(
    (await resolveContextTarget("収入が前年を上回ったそうだ。", "上回る", {
      partOfSpeech: ["v5r"],
    }))?.markedHTML,
    "収入が前年を<mark>上回った</mark>そうだ。",
  );
  assertEquals(
    (await resolveContextTarget("眩しそうに見る。", "眩しい", {
      partOfSpeech: ["adj-i"],
    }))?.markedHTML,
    "<mark>眩しそうに</mark>見る。",
  );
  assertEquals(
    (await resolveContextTarget("心もとなさそうな表情だ。", "心もとない", {
      partOfSpeech: ["adj-i"],
    }))?.markedHTML,
    "<mark>心もとなさそうな</mark>表情だ。",
  );
});

Deno.test("resolveContextTarget handles suppletive and regular いい adjective inflections", async () => {
  assertEquals(
    (await resolveContextTarget("カッコよく言ったってダメ。", "カッコいい", {
      partOfSpeech: ["adj-i"],
    }))?.markedHTML,
    "<mark>カッコよく</mark>言ったってダメ。",
  );
  assertEquals(
    (await resolveContextTarget("かわいく飾った。", "かわいい", {
      partOfSpeech: ["adj-i"],
    }))?.markedHTML,
    "<mark>かわいく</mark>飾った。",
  );
  assertEquals(
    await resolveContextTarget("かわよく飾った。", "かわいい", {
      partOfSpeech: ["adj-i"],
    }),
    null,
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

Deno.test("resolveContextTarget keeps lexical morphology inside the target", async () => {
  assertEquals(
    (await resolveContextTarget("話しかけないで！", "話しかける", {
      partOfSpeech: ["v1"],
    }))?.markedHTML,
    "<mark>話しかけないで</mark>！",
  );
  assertEquals(
    (await resolveContextTarget("とぼけないでください。", "とぼける", {
      partOfSpeech: ["v1"],
    }))?.markedHTML,
    "<mark>とぼけないで</mark>ください。",
  );
  assertEquals(
    (await resolveContextTarget("割れんばかりの拍手", "割れる", {
      partOfSpeech: ["v1"],
    }))?.markedHTML,
    "<mark>割れん</mark>ばかりの拍手",
  );
  assertEquals(
    (await resolveContextTarget("症状が治まりましたら", "治まる", {
      partOfSpeech: ["v5r"],
    }))?.markedHTML,
    "症状が<mark>治まりましたら</mark>",
  );
  assertEquals(
    (await resolveContextTarget("たゆまざる努力", "たゆむ", {
      partOfSpeech: ["v5m"],
    }))?.markedHTML,
    "<mark>たゆまざる</mark>努力",
  );
});

Deno.test("resolveContextTarget leaves proposition-level modality outside the target", async () => {
  assertEquals(
    (await resolveContextTarget("取り締まるべきだ。", "取り締まる", {
      partOfSpeech: ["v5r"],
    }))?.markedHTML,
    "<mark>取り締まる</mark>べきだ。",
  );
  assertEquals(
    (await resolveContextTarget("接するべきである。", "接する", {
      partOfSpeech: ["vs-s"],
    }))?.markedHTML,
    "<mark>接する</mark>べきである。",
  );
  assertEquals(
    (await resolveContextTarget("変化をもたらすだろう。", "もたらす", {
      partOfSpeech: ["v5s"],
    }))?.markedHTML,
    "変化を<mark>もたらす</mark>だろう。",
  );
  assertEquals(
    (await resolveContextTarget("権利を与えられるべきだ。", "与える", {
      partOfSpeech: ["v1"],
    }))?.markedHTML,
    "権利を<mark>与えられる</mark>べきだ。",
  );
  assertEquals(
    (await resolveContextTarget("勝負は望むべくもない。", "望む", {
      partOfSpeech: ["v5m"],
    }))?.markedHTML,
    "勝負は<mark>望む</mark>べくもない。",
  );
});
