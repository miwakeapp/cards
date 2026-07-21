import { assertEquals, assertThrows } from "@std/assert";
import { importFurigana } from "../src/furigana_import.ts";

const source = `# Lorenzi's Jisho - Furigana Segmentation Data
# Generated: 2026-07-20T07:02:21.554Z
1399910;掻.き.集.める;か.き.あつ.める
1399910;搔.き.集.める;か.き.あつ.める
1686540;種.つけ;たね.つけ
1686540;種.付;たね.つけ
1686540;種.付.け;たね.つ.け
`;

Deno.test("importFurigana imports search-only spellings supplied upstream", () => {
  assertEquals(importFurigana(source), {
    "1399910|掻き集める|かきあつめる": "掻[か]き 集[あつ]める",
    "1399910|搔き集める|かきあつめる": "搔[か]き 集[あつ]める",
    "1686540|種つけ|たねつけ": "種[たね]つけ",
    "1686540|種付|たねつけ": "種[たね] 付[つけ]",
    "1686540|種付け|たねつけ": "種[たね] 付[つ]け",
  });
});

Deno.test("importFurigana rejects malformed source data", () => {
  assertThrows(
    () => importFurigana("1686540;種.付;たね\n"),
    Error,
    "Mismatched furigana segments on line 1",
  );
});

Deno.test("importFurigana safely coarsens zero-surface segments", () => {
  assertEquals(importFurigana("1791040;気..風;き.っ.ぷ\n"), {
    "1791040|気風|きっぷ": "気風[きっぷ]",
  });
});

Deno.test("importFurigana rejects unsafe fields", () => {
  for (
    const source of [
      "1;<b>食</b>;た\n",
      "2;食べる;たべる\t\n",
      "word;食;た\n",
      "3;;\n",
      "4;縦|線;たてせん\n",
    ]
  ) {
    assertThrows(() => importFurigana(source));
  }
});
