import { assertEquals, assertThrows } from "@std/assert";
import { formatKey, parseKey } from "card_model/keys";

Deno.test("parseKey: one all-senses usage", () => {
  assertEquals(parseKey("相性 | 1586070"), {
    spelling: "相性",
    usages: [{ jmdictId: "1586070", senseNumbers: null }],
  });
});

Deno.test("parseKey: selected and equivalent usages", () => {
  assertEquals(parseKey("後々 | 1578610:1;2841372:2,3"), {
    spelling: "後々",
    usages: [
      { jmdictId: "1578610", senseNumbers: [1] },
      { jmdictId: "2841372", senseNumbers: [2, 3] },
    ],
  });
});

Deno.test("parseKey: rejects malformed and superseded syntax", () => {
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
      "相性 | 1586070:",
      "相性 | 1586070:0",
      "相性 | 1586070:-1",
      "相性 | 1586070:+1",
      "相性 | 1586070:01",
      "相性 | 1586070:1.0",
      "相性 | 1586070:1e0",
      "相性 | 1586070:9007199254740992",
      "相性 | 1586070:1,",
      "相性 | 1586070:2,2",
      "相性 | 1586070:2,1",
      "相性 | 1586070;",
      "相性 | 1586070;1586070:1",
      "後々 | 2841372:2,3;1578610:1",
      " 後々 | 1578610:1;2841372:2,3",
      "後々 | 1578610:1;2841372:2,3 ",
      "後々|1578610:1;2841372:2,3",
      "後々 | 1578610:1; 2841372:2,3",
      "後々 | 1578610:1;2841372:2, 3",
      "相性 | 1586070 | 1,2",
    ]
  ) {
    assertEquals(parseKey(key), null, key);
  }
});

Deno.test("formatKey: formats, sorts, and collapses valid selections", () => {
  assertEquals(
    formatKey("後々", [
      { jmdictId: "3000000", senseNumbers: [3, 1], totalSenses: 3 },
      { jmdictId: "2841372", senseNumbers: [1], totalSenses: 1 },
      { jmdictId: "1578610", senseNumbers: [1], totalSenses: 2 },
    ]),
    "後々 | 1578610:1;2841372;3000000:1,3",
  );
});

Deno.test("formatKey: collapses empty and exact all-senses selections", () => {
  assertEquals(
    formatKey("相性", [{ jmdictId: "1586070", senseNumbers: [], totalSenses: 3 }]),
    "相性 | 1586070",
  );
  assertEquals(
    formatKey("相性", [{
      jmdictId: "1586070",
      senseNumbers: [3, 1, 2],
      totalSenses: 3,
    }]),
    "相性 | 1586070",
  );
});

Deno.test("formatKey: rejects invalid inputs", () => {
  assertThrows(() => formatKey("相性", []), Error, "at least one JMDict usage");
  assertThrows(
    () =>
      formatKey("相性", [
        { jmdictId: "1586070", senseNumbers: [], totalSenses: 3 },
        { jmdictId: "1586070", senseNumbers: [1], totalSenses: 3 },
      ]),
    Error,
    "must not repeat",
  );
  for (const spelling of ["", " 相性", "相性 ", "相|性"]) {
    assertThrows(
      () =>
        formatKey(spelling, [{
          jmdictId: "1586070",
          senseNumbers: [],
          totalSenses: 3,
        }]),
      Error,
      "spelling",
    );
  }
  assertThrows(
    () =>
      formatKey("相性", [{
        jmdictId: "1586070",
        senseNumbers: [4],
        totalSenses: 3,
      }]),
    Error,
    "senseNumbers",
  );
});
