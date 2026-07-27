import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { preextractedJMDictEntry } from "data";
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
  const entry = await preextractedJMDictEntry("2252350");
  assertEquals(
    await recomputeAnkiReading(
      "大[お] 人[とな] 買[が]い",
      "大人買い",
      entry,
    ),
    "大人[おとな] 買[が]い",
  );
});

Deno.test("recomputeAnkiReading: replaces legacy zero-surface annotations", async () => {
  const entry = await preextractedJMDictEntry("2252350");
  assertEquals(
    await recomputeAnkiReading(
      "大[お] 人[と] [な] 買[が]い",
      "大人買い",
      entry,
    ),
    "大人[おとな] 買[が]い",
  );
});

Deno.test("recomputeAnkiReading: resolves an upstream search-only spelling", async () => {
  const entry = await preextractedJMDictEntry("1399910");
  assertEquals(
    await recomputeAnkiReading(
      "搔き集める[かきあつめる]",
      "搔き集める",
      entry,
    ),
    "搔[か]き 集[あつ]める",
  );
});

Deno.test("recomputeAnkiReading: returns null when the lookup record is missing", async () => {
  const entry = await preextractedJMDictEntry("1205330");
  assertEquals(
    await recomputeAnkiReading("恰好悪い[かっこわるい]", "恰好悪い", entry),
    null,
  );
  assertEquals(
    await recomputeAnkiReading("恰好[かっこ] 悪[わる]い", "恰好悪い", entry),
    null,
  );
});
