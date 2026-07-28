import { assertEquals, assertThrows } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import {
  applyDisplayTargetOverride,
  disambiguationHintForJMDictUsage,
  hasBoundaryNotation,
  normalizeNotationMarkers,
  removeBoundaryNotation,
} from "./display_target.ts";

Deno.test("normalizeNotationMarkers canonicalizes only boundary notation", () => {
  assertEquals(normalizeNotationMarkers("~まがい"), "～まがい");
  assertEquals(normalizeNotationMarkers("曽〜"), "曽～");
  assertEquals(normalizeNotationMarkers("～ないし~"), "～ないし～");
  assertEquals(normalizeNotationMarkers("A~B"), "A~B");
  assertEquals(hasBoundaryNotation("～まがい"), true);
  assertEquals(hasBoundaryNotation("A~B"), false);
  assertEquals(removeBoundaryNotation("～～ないし～～"), "ないし");
  assertEquals(removeBoundaryNotation("A~B"), "A~B");
});

Deno.test("disambiguationHintForJMDictUsage requires notation to resolve every ambiguity", () => {
  const entry = {
    id: "1111111",
    kanji: [],
    kana: [{ text: "ヅラ", common: false, tags: [], appliesToKanji: ["*"] }],
    sense: [{
      partOfSpeech: ["n-suf"],
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [{ lang: "eng", gender: null, type: null, text: "test gloss" }],
    }],
  } satisfies JMdictWord;
  const competingNoun = {
    ...structuredClone(entry),
    id: "2222222",
    sense: [{ ...entry.sense[0], partOfSpeech: ["n"] }],
  };
  const competingSuffix = {
    ...structuredClone(entry),
    id: "3333333",
  };

  assertEquals(
    disambiguationHintForJMDictUsage("野武士ヅラ", "～ヅラ", "ヅラ", entry, [1], [
      entry,
      competingNoun,
    ]),
    undefined,
  );
  assertEquals(
    disambiguationHintForJMDictUsage("野武士ヅラ", "～ヅラ", "ヅラ", entry, [1], [
      entry,
      competingSuffix,
    ]),
    "野武士ヅラ",
  );
  assertEquals(
    disambiguationHintForJMDictUsage(
      "十ないし二十",
      "～ないし～",
      "ないし",
      {
        ...entry,
        id: "4444444",
        kana: [{ ...entry.kana[0], text: "ないし" }],
        sense: [
          { ...entry.sense[0], partOfSpeech: ["conj"] },
          { ...entry.sense[0], partOfSpeech: ["conj"] },
        ],
      },
      [1],
      [],
    ),
    "十ないし二十",
  );
});

Deno.test("applyDisplayTargetOverride transfers precise furigana into a user edit", () => {
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "～然", reading: "～然[ぜん]" },
      "然",
      "～然とする",
    ),
    {
      recognitionTarget: "～然とする",
      reading: "～然[ぜん]とする",
    },
  );
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "～まがい", reading: null },
      "まがい",
      "～まがい",
    ),
    {
      recognitionTarget: "～まがい",
      reading: null,
    },
  );
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "然", reading: "然[ぜん]" },
      "然",
      "～然とする<script>",
    ),
    {
      recognitionTarget: "～然とする&lt;script&gt;",
      reading: "～然[ぜん]とする&lt;script&gt;",
    },
  );
});

Deno.test("applyDisplayTargetOverride leaves automatic notation alone without an override", () => {
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "曽～", reading: "曽[そう]～" },
      "曽",
      undefined,
    ),
    {
      recognitionTarget: "曽～",
      reading: "曽[そう]～",
    },
  );
});

Deno.test("applyDisplayTargetOverride requires exactly one key spelling", () => {
  assertThrows(
    () =>
      applyDisplayTargetOverride(
        { recognitionTarget: "然", reading: "然[ぜん]" },
        "然",
        "別",
      ),
    Error,
    "exactly once",
  );
});
