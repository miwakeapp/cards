import { assertEquals, assertRejects } from "@std/assert";
import type { JMDictWord } from "data";
import {
  buildSpellingIndex,
  deriveLookupSpellings,
  findEntriesBySpelling,
  findSurfaceFormOccurrencesForLookupSpelling,
  findSurfaceFormsForLookupSpelling,
  isGeneratedSurfaceFormForLookupSpelling,
} from "../src/recognition_target.ts";

function jmdictWord(id: string, kanji: string[], kana: string[]): JMDictWord {
  return {
    id,
    kanji: kanji.map((text) => ({ common: false, text, tags: [] })),
    kana: kana.map((text) => ({
      common: false,
      text,
      tags: [],
      appliesToKanji: ["*"],
    })),
    sense: [],
  };
}

Deno.test("spelling index keeps JMDict form categories distinct", () => {
  const kanjiEntry = jmdictWord("kanji", ["悪戯"], ["いたずら"]);
  const kanaCollision = jmdictWord("kana-collision", [], ["悪戯"]);
  const kanaEntry = jmdictWord("kana", [], ["おちゃめ"]);
  const index = buildSpellingIndex([kanjiEntry, kanaCollision, kanaEntry]);

  assertEquals(findEntriesBySpelling(index, "悪戯"), [kanjiEntry]);
  assertEquals(findEntriesBySpelling(index, "おちゃめ"), [kanaEntry]);
  assertEquals(findEntriesBySpelling(index, "不存在"), []);
});

Deno.test("deriveLookupSpellings resolves inflected verbs", async () => {
  const candidates = await deriveLookupSpellings(
    "この国は、昔から貿易によって潤ってきた。",
    "潤って",
  );

  assertEquals(candidates, ["潤う"]);
});

Deno.test("findSurfaceFormsForLookupSpelling locates inflected context targets", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "この国は、昔から貿易によって潤ってきた。",
      "潤う",
    ),
    ["潤って"],
  );
});

Deno.test("isGeneratedSurfaceFormForLookupSpelling validates an isolated inflection exactly", () => {
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("可愛がられる", "可愛がる", {
      partOfSpeech: ["v5r"],
    }),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("動自車", "自動車", { partOfSpeech: ["n"] }),
    false,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("アホタレ", "アホタレ"),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("あほたれ", "アホタレ"),
    false,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("アホタレ", "あほたれ"),
    false,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("来ます", "来る", { partOfSpeech: ["vk"] }),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("食べましょう", "食べる", {
      partOfSpeech: ["v1"],
    }),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("揺蕩いながら", "揺蕩う", {
      partOfSpeech: ["v5u"],
    }),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("頼ったり", "頼る", {
      partOfSpeech: ["v5r"],
    }),
    true,
  );
  // Productive desiderative morphology remains part of the encountered target form.
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("縫いたい", "縫う", {
      partOfSpeech: ["v5u"],
    }),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("麗しの", "麗しい", {
      partOfSpeech: ["adj-i"],
    }),
    true,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("高の", "高い", {
      partOfSpeech: ["adj-i"],
    }),
    false,
  );
  assertEquals(
    isGeneratedSurfaceFormForLookupSpelling("とろそうな", "とろい", {
      partOfSpeech: ["adj-i"],
    }),
    true,
  );
});

Deno.test("surface-form lookup rejects empty dictionary spellings", async () => {
  await assertRejects(
    () => findSurfaceFormOccurrencesForLookupSpelling("文脈。", ""),
    RangeError,
    "lookupSpelling must not be empty",
  );
  await assertRejects(
    () => findSurfaceFormsForLookupSpelling("文脈。", ""),
    RangeError,
    "lookupSpelling must not be empty",
  );
});

Deno.test("findSurfaceFormsForLookupSpelling reports distinct ambiguous forms", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("水で潤って、さらに油で潤った。", "潤う"),
    ["潤って", "潤った"],
  );
});

Deno.test("surface occurrence lookup excludes an identical suffix in another lexical item", async () => {
  const sentence = "彼の考えとは異なるが、結果はこうなる。";
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling(sentence, "なる", {
      partOfSpeech: ["v5r"],
    }),
    [{ start: 16, end: 18, surface: "なる" }],
  );

  // A string-only result would make a caller mark both `なる` occurrences, so the compatibility
  // API fails closed. Range-aware callers can retain the valid standalone occurrence above.
  assertEquals(
    await findSurfaceFormsForLookupSpelling(sentence, "なる", { partOfSpeech: ["v5r"] }),
    [],
  );
});

Deno.test("surface occurrence lookup retains genuine repeated uses", async () => {
  const sentence = "こうなる、そうなる。";
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling(sentence, "なる", {
      partOfSpeech: ["v5r"],
    }),
    [
      { start: 2, end: 4, surface: "なる" },
      { start: 7, end: 9, surface: "なる" },
    ],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(sentence, "なる", { partOfSpeech: ["v5r"] }),
    ["なる"],
  );
});

Deno.test("surface occurrence lookup merges exact and irregular 来る forms", async () => {
  const sentence = "明日来るし、昨日来た。";
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling(sentence, "来る", {
      partOfSpeech: ["vk"],
    }),
    [
      { start: 2, end: 4, surface: "来る" },
      { start: 8, end: 10, surface: "来た" },
    ],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(sentence, "来る", { partOfSpeech: ["vk"] }),
    ["来る", "来た"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("来年また会おう。", "来る", {
      partOfSpeech: ["vk"],
    }),
    [],
  );
});

Deno.test("surface occurrence lookup merges exact and suppletive ある forms", async () => {
  const sentence = "そこにあるが、以前はなかった。";
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling(sentence, "ある", {
      partOfSpeech: ["v5r-i"],
    }),
    [
      { start: 3, end: 5, surface: "ある" },
      { start: 10, end: 14, surface: "なかった" },
    ],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(sentence, "ある", { partOfSpeech: ["v5r-i"] }),
    ["ある", "なかった"],
  );
});

Deno.test("surface occurrence lookup does not treat another verb's negative as ある", async () => {
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling("食べなかったが、そこにはある。", "ある", {
      partOfSpeech: ["v5r-i"],
    }),
    [{ start: 12, end: 14, surface: "ある" }],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling inflects the final verb in an expression", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("悪魔は腹を抱えて笑っている。", "腹を抱える"),
    ["腹を抱えて"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("白と黒が混じり合った。", "混じり合う"),
    ["混じり合った"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling is stable across misleading surrounding tokens", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "のび太は喜び勇んでその帽子をかぶり、",
      "喜び勇む",
      { partOfSpeech: ["v5m"] },
    ),
    ["喜び勇んで"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "皆口をそろえて小鳥がかわいそうだ",
      "口をそろえる",
      { partOfSpeech: ["exp", "v1"] },
    ),
    ["口をそろえて"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "それでも、俺は叩きのめされたよ。",
      "叩きのめす",
      { partOfSpeech: ["v5s"] },
    ),
    ["叩きのめされた"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling handles compound inflection chains", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "アレックスを救う言葉を紡ぎ出せなかった。",
      "紡ぎ出す",
      { partOfSpeech: ["v5s"] },
    ),
    ["紡ぎ出せなかった"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("女性にいちばんウザがられるタイプだぞ", "ウザがる", {
      partOfSpeech: ["v5r"],
    }),
    ["ウザがられる"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "なんかパンダみたいだぞ、クリームを拭き取れよ",
      "拭き取る",
      {
        partOfSpeech: ["v5r"],
      },
    ),
    ["拭き取れ"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "残っていたわずかな店が立ち退かされた後は何も進展していない。",
      "立ち退く",
      { partOfSpeech: ["v5k", "vi"] },
    ),
    ["立ち退かされた"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "長く冷や飯を食わされてきた。",
      "冷や飯を食う",
      { partOfSpeech: ["exp", "v5u"] },
    ),
    ["冷や飯を食わされて"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling handles suru and fixed negative forms", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("厳しい罰を死者に科してはいない。", "科する", {
      partOfSpeech: ["vs-s"],
    }),
    ["科して"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "どうしようもない状況をこよなく愛し、",
      "こよなく愛する",
      {
        partOfSpeech: ["exp", "vs-s"],
      },
    ),
    ["こよなく愛し"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("ユイ本人は異常など意に介せぬふうで、", "意に介する", {
      partOfSpeech: ["exp", "vs-s"],
    }),
    ["意に介せぬ"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "見かけにそぐわず意外と育ちはローカルタイプだ。",
      "そぐわない",
      {
        partOfSpeech: ["adj-i"],
      },
    ),
    ["そぐわず"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling handles zuru verb forms", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "民族のアイデンティティーを賭けた戦いでも、奉じた神々への殉教でもない。",
      "奉ずる",
      { partOfSpeech: ["vz", "vt"] },
    ),
    ["奉じた"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling keeps finite target morphology", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("その件、承りました。", "承る", {
      partOfSpeech: ["v5r", "vt"],
    }),
    ["承りました"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("いつか自分で着物を縫いたいと思う。", "縫う", {
      partOfSpeech: ["v5u", "vt"],
    }),
    ["縫いたい"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("わたしが決着をつけなきゃいけない。", "決着をつける", {
      partOfSpeech: ["exp", "v1"],
    }),
    ["決着をつけなきゃ"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("説明が諄くて困る。", "諄い", {
      partOfSpeech: ["adj-i"],
    }),
    ["諄くて"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("議論がかみ合わなくて困る。", "かみ合う", {
      partOfSpeech: ["v5u", "vi"],
    }),
    ["かみ合わなくて"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("それも忘れ去られました。", "忘れ去る", {
      partOfSpeech: ["v5r", "vt"],
    }),
    ["忘れ去られました"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("明日来ますか。", "来る", {
      partOfSpeech: ["vk"],
    }),
    ["来ます"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("一緒に食べましょう。", "食べる", {
      partOfSpeech: ["v1"],
    }),
    ["食べましょう"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("これは業だ。", "業", {
      partOfSpeech: ["n"],
    }),
    ["業"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling keeps productive suffixes with the target", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("麗しの友よ。", "麗しい", {
      partOfSpeech: ["adj-i"],
    }),
    ["麗しの"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("音の中を揺蕩いながら歩く。", "揺蕩う", {
      partOfSpeech: ["v5u"],
    }),
    ["揺蕩いながら"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("ちょっととろそうな人だ。", "とろい", {
      partOfSpeech: ["adj-i"],
    }),
    ["とろそうな"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling accepts kana-script-only source differences", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "大使館付のラングレー要員になったアホタレだ",
      "あほたれ",
    ),
    ["アホタレ"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling can require exact source kana scripts", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("アホタレだ", "あほたれ", {
      requireExactKanaScript: true,
    }),
    [],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("ひどくどん引キした。", "ドン引き", {
      partOfSpeech: ["n", "vs"],
      requireExactKanaScript: true,
    }),
    [],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("昨日はサボった。", "サボる", {
      partOfSpeech: ["v5r"],
      requireExactKanaScript: true,
    }),
    ["サボった"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling recognizes conjunctive derivations", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("憑きものがすとんと落ちたみたいに", "憑く", {
      partOfSpeech: ["v5k"],
    }),
    ["憑き"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("憎悪の表情を剥き出しにした。", "剥き出す", {
      partOfSpeech: ["v5s"],
    }),
    ["剥き出し"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling recognizes i-adjective げ derivations", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling(
      "その決意に他人が賢しげに説教なんかできるものじゃないわ。",
      "賢しい",
      { partOfSpeech: ["adj-i"] },
    ),
    ["賢しげ"],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling rejects stems embedded in another lexical item", async () => {
  assertEquals(
    await findSurfaceFormsForLookupSpelling("好きな食べ物は寿司だ。", "食べる", {
      partOfSpeech: ["v1"],
    }),
    [],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("食べてから、食べ物を片づけた。", "食べる", {
      partOfSpeech: ["v1"],
    }),
    ["食べて"],
  );
  assertEquals(
    await findSurfaceFormsForLookupSpelling("食べ、好きな食べ物の話をした。", "食べる", {
      partOfSpeech: ["v1"],
    }),
    [],
  );
});

Deno.test("surface occurrence lookup rejects finite forms embedded in another lexical item", async () => {
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling("焼け跡を見た。", "焼く", {
      partOfSpeech: ["v5k"],
    }),
    [],
  );
  assertEquals(
    await findSurfaceFormOccurrencesForLookupSpelling("それを焼け。", "焼く", {
      partOfSpeech: ["v5k"],
    }),
    [{ start: 3, end: 5, surface: "焼け" }],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling does not match inside a larger token", async () => {
  assertEquals(await findSurfaceFormsForLookupSpelling("生活を改善する。", "生"), []);
  assertEquals(
    await findSurfaceFormsForLookupSpelling("フライパンを買った。", "パン", {
      partOfSpeech: ["n"],
    }),
    [],
  );
});

Deno.test("findSurfaceFormsForLookupSpelling accepts multi-character words inside compounds", async () => {
  assertEquals(await findSurfaceFormsForLookupSpelling("色とりどりの切手。", "とりどり"), [
    "とりどり",
  ]);
  assertEquals(await findSurfaceFormsForLookupSpelling("安全圏内だった。", "安全圏"), ["安全圏"]);
});

Deno.test("deriveLookupSpellings resolves conjunctive verb stems", async () => {
  const candidates = await deriveLookupSpellings(
    "話し合いは平行線をたどり、結局一致点を見いだせなかった。",
    "たどり",
  );

  assertEquals(candidates, ["たどる"]);
});

Deno.test("deriveLookupSpellings does not surface-trim verb te-forms", async () => {
  const candidates = await deriveLookupSpellings(
    "葉書が届いたが、雨でインクが少しにじんで、読みにくかった。",
    "にじんで",
  );

  assertEquals(candidates, ["にじむ"]);
});

Deno.test("deriveLookupSpellings resolves passive verb suffixes", async () => {
  const candidates = await deriveLookupSpellings(
    "開発のために、古いビルが次々と壊されている。",
    "壊されて",
  );

  assertEquals(candidates, ["壊す"]);
});

Deno.test("deriveLookupSpellings resolves inflected adjectives", async () => {
  const candidates = await deriveLookupSpellings(
    "オリンピックが華々しく開幕した。",
    "華々しく",
  );

  assertEquals(candidates, ["華々しい"]);
});

Deno.test("deriveLookupSpellings resolves sahen suru forms to suru and noun candidates", async () => {
  const candidates = await deriveLookupSpellings(
    "相手と競争している。",
    "競争して",
  );

  assertEquals(candidates, ["競争する", "競争"]);
});

Deno.test("deriveLookupSpellings resolves plain noun suru forms to suru and noun candidates", async () => {
  const candidates = await deriveLookupSpellings(
    "時間をロスしてしまった。",
    "ロスして",
  );

  assertEquals(candidates, ["ロスする", "ロス"]);
});

Deno.test("deriveLookupSpellings resolves passive sahen forms to suru and noun candidates", async () => {
  const candidates = await deriveLookupSpellings(
    "山田先生に触発されて、画家の道を志しました。",
    "触発されて",
  );

  assertEquals(candidates, ["触発する", "触発"]);
});

Deno.test("deriveLookupSpellings resolves noun ni-suru forms", async () => {
  const candidates = await deriveLookupSpellings(
    "時間を無駄にしてしまった。",
    "無駄にして",
  );

  assertEquals(candidates, ["無駄にする"]);
});

Deno.test("deriveLookupSpellings extends stem targets followed by suru", async () => {
  const candidates = await deriveLookupSpellings(
    "どんな厳しい状況でも任務をまっとうする覚悟がある。",
    "まっとう",
  );

  assertEquals(candidates, ["まっとうする"]);
});

Deno.test("deriveLookupSpellings resolves noun targets with adnominal particles", async () => {
  const candidates = await deriveLookupSpellings(
    "あれは不慮の事故だったとしか言いようがない。",
    "不慮の",
  );

  assertEquals(candidates, ["不慮"]);
});

Deno.test("deriveLookupSpellings preserves expression stems before adnominal particles", async () => {
  const candidates = await deriveLookupSpellings(
    "山田氏は著書で、これまでの経営戦略について意見を述べている。",
    "これまでの",
  );

  assertEquals(candidates, ["これまで", "これ"]);
});

Deno.test("deriveLookupSpellings resolves noun targets with adverbial particles", async () => {
  const candidates = await deriveLookupSpellings(
    "調査データは、地球の温暖化を如実に示した。",
    "如実に",
  );

  assertEquals(candidates, ["如実"]);
});

Deno.test("deriveLookupSpellings resolves noun targets with copular wrappers", async () => {
  const candidates = await deriveLookupSpellings(
    "衣装はいつも自前である。",
    "自前である",
  );

  assertEquals(candidates, ["自前"]);
});

Deno.test("deriveLookupSpellings resolves adverb targets with light suru wrappers", async () => {
  const candidates = await deriveLookupSpellings(
    "彼は今ごろ、ゆっくりしているだろう。",
    "ゆっくりして",
  );

  assertEquals(candidates, ["ゆっくり"]);
});

Deno.test("deriveLookupSpellings resolves adverbial noun modifiers before verbs", async () => {
  const candidates = await deriveLookupSpellings(
    "最近、仕事が順調に進んでいる。",
    "順調に進んでいる",
  );

  assertEquals(candidates, ["順調"]);
});

Deno.test("deriveLookupSpellings resolves to-adverb suru wrappers", async () => {
  const candidates = await deriveLookupSpellings(
    "高橋さんの主張は漠然としていた。",
    "漠然としていた",
  );

  assertEquals(candidates, ["漠然と", "漠然"]);
});

Deno.test("deriveLookupSpellings resolves verb yasui suffixes", async () => {
  const candidates = await deriveLookupSpellings(
    "崩れやすいので、運ぶときは気をつけてください。",
    "崩れやすい",
  );

  assertEquals(candidates, ["崩れる"]);
});

Deno.test("deriveLookupSpellings resolves adjective adverbial forms with tokenizer stems", async () => {
  const candidates = await deriveLookupSpellings(
    "憧れの歌手に会った時、緊張して動作がぎこちなくなってしまった。",
    "ぎこちなく",
  );

  assertEquals(candidates, ["ぎこち", "ぎこちない"]);
});

Deno.test("deriveLookupSpellings resolves adjective naru wrappers", async () => {
  const candidates = await deriveLookupSpellings(
    "この様子だと、新薬の発売はかなり遅くなりそうだそうだ。",
    "遅くなりそうだ",
  );

  assertEquals(candidates, ["遅い"]);
});

Deno.test("deriveLookupSpellings resolves verb souda wrappers", async () => {
  const candidates = await deriveLookupSpellings(
    "この様子だと、新薬の発売はかなりずれ込みそうだ。",
    "ずれ込みそうだ",
  );

  assertEquals(candidates, ["ずれ込む"]);
});

Deno.test("deriveLookupSpellings resolves na-adjective forms", async () => {
  const candidates = await deriveLookupSpellings(
    "アナウンサーの朗らかな声が響いた。",
    "朗らかな",
  );

  assertEquals(candidates, ["朗らか"]);
});

Deno.test("deriveLookupSpellings does not guess multiword phrases", async () => {
  const candidates = await deriveLookupSpellings(
    "ある日、わが家にうれしい知らせが届いた。",
    "うれしい知らせ",
  );

  assertEquals(candidates, []);
});
