import { assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { normalizeRecognitionTarget, resolveCSVRows } from "./csv_resolution.ts";

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
