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
