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
