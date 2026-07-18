import { assertEquals, assertThrows } from "@std/assert";
import type { JMDictWord } from "../src/jmdict_types.ts";
import { importFurigana } from "../scripts/download/furigana_import.ts";

function entry(
  kanji: JMDictWord["kanji"],
  kana: JMDictWord["kana"],
): JMDictWord {
  return {
    id: "1686540",
    kanji,
    kana,
    sense: [],
  };
}

const source = `# Lorenzi's Jisho - Furigana Segmentation Data
# Generated: 2026-07-08T11:01:56.423Z
1686540;種.付;たね.つけ
1686540;種.付.け;たね.つ.け
`;

Deno.test("importFurigana restores search-only kanji spellings", () => {
  const result = importFurigana(source, [
    entry(
      [
        { common: false, text: "種付け", tags: [] },
        { common: false, text: "種付", tags: [] },
        { common: false, text: "種つけ", tags: ["sK"] },
      ],
      [{ common: false, text: "たねつけ", tags: [], appliesToKanji: ["*"] }],
    ),
  ]);

  assertEquals(result.data, {
    "1686540|種付|たねつけ": "種[たね] 付[つけ]",
    "1686540|種付け|たねつけ": "種[たね] 付[つ]け",
    "1686540|種つけ|たねつけ": "種[たね]つけ",
  });
  assertEquals(result.stats, {
    sourceRows: 2,
    derivedSearchOnlyKanjiRows: 1,
    unresolvedSearchOnlyKanjiRows: 0,
  });
});

Deno.test("importFurigana leaves ordinary missing spellings unresolved", () => {
  const result = importFurigana(source, [
    entry(
      [{ common: false, text: "種つけ", tags: [] }],
      [{ common: false, text: "たねつけ", tags: [], appliesToKanji: ["*"] }],
    ),
  ]);

  assertEquals(result.data["1686540|種つけ|たねつけ"], undefined);
  assertEquals(result.stats.derivedSearchOnlyKanjiRows, 0);
  assertEquals(result.stats.unresolvedSearchOnlyKanjiRows, 0);
});

Deno.test("importFurigana requires a complete unambiguous transfer", () => {
  const incomplete = importFurigana(
    source,
    [
      entry(
        [{ common: false, text: "種つき", tags: ["sK"] }],
        [{ common: false, text: "たねつけ", tags: [], appliesToKanji: ["*"] }],
      ),
    ],
  );

  assertEquals(incomplete.data["1686540|種つき|たねつけ"], undefined);
  assertEquals(incomplete.stats.unresolvedSearchOnlyKanjiRows, 1);

  const ambiguous = importFurigana(
    "1686540;甲乙.丙;あいう.い\n1686540;甲.乙.丁;あ.いう.い\n",
    [
      entry(
        [{ common: false, text: "甲乙い", tags: ["sK"] }],
        [{ common: false, text: "あいうい", tags: [], appliesToKanji: ["*"] }],
      ),
    ],
  );
  assertEquals(ambiguous.data["1686540|甲乙い|あいうい"], undefined);
  assertEquals(ambiguous.stats.unresolvedSearchOnlyKanjiRows, 1);
});

Deno.test("importFurigana keeps an upstream row instead of deriving it", () => {
  const result = importFurigana(
    `${source}1686540;種.つけ;たね.つけ\n`,
    [
      entry(
        [{ common: false, text: "種つけ", tags: ["sK"] }],
        [{ common: false, text: "たねつけ", tags: [], appliesToKanji: ["*"] }],
      ),
    ],
  );

  assertEquals(result.data["1686540|種つけ|たねつけ"], "種[たね]つけ");
  assertEquals(result.stats.derivedSearchOnlyKanjiRows, 0);
});

Deno.test("importFurigana rejects malformed source data", () => {
  assertThrows(
    () => importFurigana("1686540;種.付;たね\n", []),
    Error,
    "Mismatched furigana segments on line 1",
  );
});
