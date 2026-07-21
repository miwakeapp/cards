import "../../data/test/use_furigana_fixture.ts";

import { assertEquals } from "@std/assert";
import { parseAnkiReading, recomputeAnkiReading } from "../src/anki_reading.ts";

Deno.test("parseAnkiReading: recovers pronunciation from precise placement", () => {
  assertEquals(parseAnkiReading("大人[おとな] 買[が]い", "大人買い"), ["おとながい"]);
});

Deno.test("parseAnkiReading: supports multiple canonical alternatives", () => {
  assertEquals(parseAnkiReading("明日[あした] / 明日[あす]", "明日"), ["あした", "あす"]);
});

Deno.test("parseAnkiReading: recovers legacy zero-surface annotations", () => {
  assertEquals(parseAnkiReading("気[き] [っ] 風[ぷ]", "気風"), ["きっぷ"]);
});

Deno.test("parseAnkiReading: rejects markup, mismatched surfaces, and malformed brackets", () => {
  assertEquals(parseAnkiReading("<b>食[た]べる</b>", "食べる"), null);
  assertEquals(parseAnkiReading("食[た]べる", "喋る"), null);
  assertEquals(parseAnkiReading("食[]べる", "食べる"), null);
});

Deno.test("recomputeAnkiReading: changes placement without changing pronunciation", async () => {
  assertEquals(
    await recomputeAnkiReading(
      "大[お] 人[とな] 買[が]い",
      "大人買い",
      "2252350",
    ),
    "大人[おとな] 買[が]い",
  );
});

Deno.test("recomputeAnkiReading: replaces legacy zero-surface annotations", async () => {
  assertEquals(
    await recomputeAnkiReading(
      "大[お] 人[と] [な] 買[が]い",
      "大人買い",
      "2252350",
    ),
    "大人[おとな] 買[が]い",
  );
});

Deno.test("recomputeAnkiReading: resolves an upstream search-only spelling", async () => {
  assertEquals(
    await recomputeAnkiReading(
      "搔き集める[かきあつめる]",
      "搔き集める",
      "1399910",
    ),
    "搔[か]き 集[あつ]める",
  );
});

Deno.test("recomputeAnkiReading: returns null when the lookup record is missing", async () => {
  assertEquals(await recomputeAnkiReading("食べる[たべる]", "食べる", "9999999"), null);
  assertEquals(await recomputeAnkiReading("食[た]べる", "食べる", "9999999"), null);
});
