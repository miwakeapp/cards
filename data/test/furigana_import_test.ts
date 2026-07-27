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

Deno.test("importFurigana adds unambiguous aliases for Lorenzi-normalized readings", () => {
  assertEquals(
    importFurigana(
      [
        "1032910;Ｏ.Ｂ;オー.ビー",
        "1427810;張.子.のトラ;はり.こ.のトラ",
        "2195830;ドン.引.き;ドン.び.き",
        "2238240;アクの.強.い;アクの.つよ.い",
      ].join("\n"),
    ),
    {
      "1032910|ＯＢ|オービー": "Ｏ[オー] Ｂ[ビー]",
      "1032910|ＯＢ|おーびー": "Ｏ[オー] Ｂ[ビー]",
      "1427810|張子のトラ|はりこのトラ": "張[はり] 子[こ]のトラ",
      "1427810|張子のトラ|はりこのとら": "張[はり] 子[こ]のトラ",
      "2195830|ドン引き|ドンびき": "ドン 引[び]き",
      "2195830|ドン引き|どんびき": "ドン 引[び]き",
      "2238240|アクの強い|アクのつよい": "アクの 強[つよ]い",
      "2238240|アクの強い|あくのつよい": "アクの 強[つよ]い",
    },
  );
});

Deno.test("importFurigana omits ambiguous normalized aliases", () => {
  assertEquals(
    importFurigana("1;薔.薇;ボ.ん\n1;薔.薇;ぼ.ン\n"),
    {
      "1|薔薇|ボん": "薔[ボ] 薇[ん]",
      "1|薔薇|ぼン": "薔[ぼ] 薇[ン]",
    },
  );
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
