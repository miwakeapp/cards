import { assertEquals, assertThrows } from "@std/assert";
import { formatMiwakeKey, parseMiwakeKey } from "card_creator/keys";

Deno.test("parseMiwakeKey: all-senses form", () => {
  assertEquals(parseMiwakeKey("相性 | 1586070"), {
    spelling: "相性",
    jmdictId: "1586070",
    senseNumbers: null,
  });
});

Deno.test("parseMiwakeKey: specific senses", () => {
  assertEquals(parseMiwakeKey(" ひたと | 1430680 | 2, 3 "), {
    spelling: "ひたと",
    jmdictId: "1430680",
    senseNumbers: [2, 3],
  });
});

Deno.test("parseMiwakeKey: rejects malformed keys", () => {
  for (
    const key of [
      "",
      "相性",
      " | 1586070",
      "相性 | abc",
      "相性 | 0",
      "相性 | -1",
      "相性 | +1",
      "相性 | 01",
      "相性 | 1.0",
      "相性 | 1e0",
      "相性 | 9007199254740992",
      "相性 | 1586070 |",
      "相性 | 1586070 | 0",
      "相性 | 1586070 | -1",
      "相性 | 1586070 | +1",
      "相性 | 1586070 | 01",
      "相性 | 1586070 | 1.0",
      "相性 | 1586070 | 1e0",
      "相性 | 1586070 | 9007199254740992",
      "相性 | 1586070 | 1,",
      "相性 | 1586070 | 2,2",
      "相性 | 1586070 | 2 | 3",
    ]
  ) {
    assertEquals(parseMiwakeKey(key), null, key);
  }
});

Deno.test("formatMiwakeKey: formats and sorts valid selections", () => {
  const senses = [3, 1] as const;
  assertEquals(formatMiwakeKey("相性", "1586070", senses, 3), "相性 | 1586070 | 1,3");
});

Deno.test("formatMiwakeKey: collapses only empty and exact all-senses selections", () => {
  assertEquals(formatMiwakeKey("相性", "1586070", [], 3), "相性 | 1586070");
  assertEquals(formatMiwakeKey("相性", "1586070", [3, 1, 2], 3), "相性 | 1586070");
  assertThrows(
    () => formatMiwakeKey("相性", "1586070", [97, 98, 99], 3),
    Error,
    "senseNumbers",
  );
});

Deno.test("formatMiwakeKey: rejects invalid key spellings and JMDict IDs", () => {
  for (const spelling of ["", " 相性", "相性 ", "相|性"]) {
    assertThrows(
      () => formatMiwakeKey(spelling, "1586070", [], 3),
      Error,
      `spelling ${JSON.stringify(spelling)} must be nonempty, trimmed, and contain no | character`,
    );
  }
  for (
    const jmdictId of ["", "abc", "0", "-1", "+1", "01", "1.0", "1e0", "9007199254740992"]
  ) {
    assertThrows(
      () => formatMiwakeKey("相性", jmdictId, [], 3),
      Error,
      `jmdictId ${
        JSON.stringify(jmdictId)
      } must be a positive safe integer written with ASCII digits`,
    );
  }
});

Deno.test("formatMiwakeKey: rejects invalid sense bounds and selections", () => {
  for (const totalSenses of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assertThrows(
      () => formatMiwakeKey("相性", "1586070", [], totalSenses),
      Error,
      `totalSenses ${String(totalSenses)} must be a positive safe integer`,
    );
  }
  for (
    const senseNumbers of [
      [0],
      [-1],
      [1.5],
      [Number.MAX_SAFE_INTEGER + 1],
      [4],
      [2, 2],
    ]
  ) {
    assertThrows(
      () => formatMiwakeKey("相性", "1586070", senseNumbers, 3),
      Error,
      `senseNumbers [${
        senseNumbers.join(", ")
      }] must contain unique positive safe integers no greater than totalSenses 3`,
    );
  }
});
