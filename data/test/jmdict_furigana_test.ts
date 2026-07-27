import "./use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { jmdictFuriganaFor } from "../src/mod.ts";

Deno.test("jmdictFuriganaFor resolves Lorenzi-equivalent ＯＢ readings", async () => {
  const expected = "Ｏ[オー] Ｂ[ビー]";

  // This is the exact reading exported by Lorenzi, so it finds the original imported key.
  assertEquals(await jmdictFuriganaFor("1032910", "ＯＢ", "オービー"), expected);

  // The importer also stores this normalized alias for the exact Lorenzi reading.
  assertEquals(await jmdictFuriganaFor("1032910", "ＯＢ", "おーびー"), expected);

  // This is JMDict's reading. Lookup normalization removes the separator and converts the result
  // to hiragana, allowing it to find the importer's normalized alias.
  assertEquals(await jmdictFuriganaFor("1032910", "ＯＢ", "オー・ビー"), expected);

  // This follows the same lookup path as JMDict's reading but isolates separator removal from
  // kana-script normalization.
  assertEquals(await jmdictFuriganaFor("1032910", "ＯＢ", "おー・びー"), expected);
});
