import { assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { normalizeRecognitionTarget, resolveCSVRows } from "./csv_resolution.ts";
import { deriveLookupSpellings } from "./recognition_target_lookup.ts";

function jmdictWord(
  kanji: Array<{ text: string; common?: boolean }>,
  kana: Array<{ text: string; common?: boolean }>,
  options: { id?: string; partOfSpeech?: string[] } = {},
): JMdictWord {
  return {
    id: options.id ?? "test",
    kanji: kanji.map((item) => ({
      common: item.common ?? false,
      text: item.text,
      tags: [],
    })),
    kana: kana.map((item) => ({
      common: item.common ?? false,
      text: item.text,
      tags: [],
      appliesToKanji: ["*"],
    })),
    sense: options.partOfSpeech
      ? [{
        partOfSpeech: options.partOfSpeech,
        appliesToKanji: ["*"],
        appliesToKana: ["*"],
        related: [],
        antonym: [],
        field: [],
        dialect: [],
        misc: [],
        info: [],
        languageSource: [],
        gloss: [],
      }]
      : [],
  };
}

Deno.test("deriveLookupSpellings resolves inflected verbs", async () => {
  const candidates = await deriveLookupSpellings(
    "この国は、昔から貿易によって潤ってきた。",
    "潤って",
  );

  assertEquals(candidates, ["潤う"]);
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

Deno.test("normalizeRecognitionTarget strips contained function-particle suffixes", async () => {
  const target = await normalizeRecognitionTarget(
    "今日の会議で出た意見は、ありきたりのものが多かった。",
    "ありきたりの",
    jmdictWord([{ text: "在り来たり" }], [{ text: "ありきたり" }]),
  );

  assertEquals(target, "ありきたり");
});

Deno.test("normalizeRecognitionTarget falls back to script-compatible dictionary spelling", async () => {
  const target = await normalizeRecognitionTarget(
    "佐藤さんは少しとまどっているようだった。",
    "とまどって",
    jmdictWord([{ text: "戸惑う", common: true }], [{ text: "とまどう", common: true }]),
  );

  assertEquals(target, "とまどう");
});

Deno.test("resolveCSVRows prefers suru-capable entries for noun suru deinflections", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "時間をロスしてしまった。",
      source: "",
      recognitionTarget: "ロスして",
    }],
    new Map([
      [
        "loss",
        jmdictWord([], [{ text: "ロス" }], {
          id: "loss",
          partOfSpeech: ["n", "vs", "vt"],
        }),
      ],
      [
        "los-angeles",
        jmdictWord([], [{ text: "ロス" }], {
          id: "los-angeles",
          partOfSpeech: ["n"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "loss", recognitionTarget: "ロス" }],
  );
});

Deno.test("resolveCSVRows prefers contextual verbs over exact noun collisions", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "話し合いは平行線をたどり、結局一致点を見いだせなかった。",
      source: "",
      recognitionTarget: "たどり",
    }],
    new Map([
      [
        "follow",
        jmdictWord([{ text: "辿る" }], [{ text: "たどる" }], {
          id: "follow",
          partOfSpeech: ["v5r", "vt"],
        }),
      ],
      [
        "photo",
        jmdictWord([{ text: "他撮り" }], [{ text: "たどり" }], {
          id: "photo",
          partOfSpeech: ["n", "vs"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "follow", recognitionTarget: "たどる" }],
  );
});

Deno.test("resolveCSVRows keeps exact matches when no context is available", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "いたって",
      source: "",
      recognitionTarget: "いたって",
    }],
    new Map([
      [
        "very",
        jmdictWord([], [{ text: "いたって" }], {
          id: "very",
          partOfSpeech: ["adv"],
        }),
      ],
      [
        "arrive",
        jmdictWord([{ text: "至る" }], [{ text: "いたる" }], {
          id: "arrive",
          partOfSpeech: ["v5r", "vi"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "very", recognitionTarget: "いたって" }],
  );
});

Deno.test("resolveCSVRows prefers longer expressions present in context", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "どんな苦難に直面しても、最善を尽くすよう努めている。",
      source: "",
      recognitionTarget: "尽くす",
    }],
    new Map([
      [
        "do-ones-utmost",
        jmdictWord([{ text: "尽くす" }], [{ text: "つくす" }], {
          id: "do-ones-utmost",
          partOfSpeech: ["v5s", "vt"],
        }),
      ],
      [
        "do-ones-best",
        jmdictWord([{ text: "最善を尽くす" }], [{ text: "さいぜんをつくす" }], {
          id: "do-ones-best",
          partOfSpeech: ["exp", "v5s"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "do-ones-best", recognitionTarget: "最善を尽くす" }],
  );
});

Deno.test("resolveCSVRows prefers longer expressions with inflected targets in context", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "コーヒーを飲んだら、目がさえてしまって、眠れない。",
      source: "",
      recognitionTarget: "さえて",
    }],
    new Map([
      [
        "awake",
        jmdictWord([{ text: "冴える" }], [{ text: "さえる" }], {
          id: "awake",
          partOfSpeech: ["v1", "vi"],
        }),
      ],
      [
        "wide-awake",
        jmdictWord([{ text: "目が冴える" }], [{ text: "目がさえる" }], {
          id: "wide-awake",
          partOfSpeech: ["exp", "v1"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "wide-awake", recognitionTarget: "目がさえる" }],
  );
});

Deno.test("resolveCSVRows ignores expression substrings embedded in larger words", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "この小説の主人公は、歴史上の人物をモデルにしている。",
      source: "",
      recognitionTarget: "上",
    }],
    new Map([
      [
        "above",
        jmdictWord([{ text: "上" }], [{ text: "うえ" }], {
          id: "above",
          partOfSpeech: ["n"],
        }),
      ],
      [
        "boss",
        jmdictWord([{ text: "上の人" }], [{ text: "うえのひと" }], {
          id: "boss",
          partOfSpeech: ["exp", "n"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "above", recognitionTarget: "上" }],
  );
});

Deno.test("resolveCSVRows allows expression matches after honorific prefixes", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "お気に障ることを申し上げてしまったようで、申し訳ありません。",
      source: "",
      recognitionTarget: "障る",
    }],
    new Map([
      [
        "hinder",
        jmdictWord([{ text: "障る" }], [{ text: "さわる" }], {
          id: "hinder",
          partOfSpeech: ["v5r", "vi"],
        }),
      ],
      [
        "offend",
        jmdictWord([{ text: "気に障る" }], [{ text: "きにさわる" }], {
          id: "offend",
          partOfSpeech: ["exp", "v5r"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "offend", recognitionTarget: "気に障る" }],
  );
});

Deno.test("resolveCSVRows uses contextual suru candidates to break exact ambiguity", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "どんな厳しい状況でも任務をまっとうする覚悟がある。",
      source: "",
      recognitionTarget: "まっとう",
    }],
    new Map([
      [
        "proper",
        jmdictWord([{ text: "全う" }], [{ text: "まっとう" }], {
          id: "proper",
          partOfSpeech: ["adj-na", "adv"],
        }),
      ],
      [
        "fulfill",
        jmdictWord([{ text: "全うする" }], [{ text: "まっとうする" }], {
          id: "fulfill",
          partOfSpeech: ["exp", "vs-i", "vt"],
        }),
      ],
      [
        "last-place",
        jmdictWord([{ text: "末等" }], [{ text: "まっとう" }], {
          id: "last-place",
          partOfSpeech: ["n"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "fulfill", recognitionTarget: "まっとうする" }],
  );
});

Deno.test("resolveCSVRows prefers contextual suru candidates over non-suru exact matches", async () => {
  const { resolved, issues } = await resolveCSVRows(
    [{
      sentence: "どんな厳しい状況でも任務を全うする覚悟がある。",
      source: "",
      recognitionTarget: "全う",
    }],
    new Map([
      [
        "proper",
        jmdictWord([{ text: "全う" }], [{ text: "まっとう" }], {
          id: "proper",
          partOfSpeech: ["adj-na", "adv"],
        }),
      ],
      [
        "fulfill",
        jmdictWord([{ text: "全うする" }], [{ text: "まっとうする" }], {
          id: "fulfill",
          partOfSpeech: ["exp", "vs-i", "vt"],
        }),
      ],
    ]),
  );

  assertEquals(issues, []);
  assertEquals(
    resolved.map(({ entry, recognitionTarget }) => ({
      id: entry.id,
      recognitionTarget,
    })),
    [{ id: "fulfill", recognitionTarget: "全うする" }],
  );
});
