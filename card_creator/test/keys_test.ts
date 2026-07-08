import { assertEquals } from "@std/assert";
import { formatMiwakeKey, parseMiwakeKey } from "../src/keys.ts";

Deno.test("parseMiwakeKey: all-senses form", () => {
  assertEquals(parseMiwakeKey("相性 | 1586070"), {
    recognitionTarget: "相性",
    jmdictId: "1586070",
    senseNumbers: null,
  });
});

Deno.test("parseMiwakeKey: specific senses", () => {
  assertEquals(parseMiwakeKey("ひたと | 1430680 | 2,3"), {
    recognitionTarget: "ひたと",
    jmdictId: "1430680",
    senseNumbers: [2, 3],
  });
});

Deno.test("parseMiwakeKey: rejects malformed keys", () => {
  assertEquals(parseMiwakeKey(""), null);
  assertEquals(parseMiwakeKey("相性"), null);
  assertEquals(parseMiwakeKey("相性 | abc"), null);
  assertEquals(parseMiwakeKey(" | 1586070"), null);
  assertEquals(parseMiwakeKey("相性 | 1586070 | 0"), null);
  assertEquals(parseMiwakeKey("相性 | 1586070 | 2,2"), null);
  assertEquals(parseMiwakeKey("相性 | 1586070 | 2 | 3"), null);
});

Deno.test("formatMiwakeKey: collapses all-senses selections", () => {
  assertEquals(formatMiwakeKey("相性", "1586070", [], 3), "相性 | 1586070");
  assertEquals(formatMiwakeKey("相性", "1586070", [1, 2, 3], 3), "相性 | 1586070");
  assertEquals(formatMiwakeKey("相性", "1586070", [3, 1], 3), "相性 | 1586070 | 1,3");
});
