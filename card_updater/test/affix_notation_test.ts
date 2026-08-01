import { assertEquals } from "@std/assert";
import { splitAffixNotation } from "../src/affix_notation.ts";

Deno.test("splitAffixNotation accepts every supported leading marker", () => {
  assertEquals(splitAffixNotation("~ 言葉"), {
    notation: "leading",
    content: "言葉",
    decoration: "~ ",
  });
  assertEquals(splitAffixNotation("〜言葉"), {
    notation: "leading",
    content: "言葉",
    decoration: "〜",
  });
  assertEquals(splitAffixNotation("～言葉"), {
    notation: "leading",
    content: "言葉",
    decoration: "～",
  });
});

Deno.test("splitAffixNotation accepts every supported trailing marker", () => {
  assertEquals(splitAffixNotation("曽 ~"), {
    notation: "trailing",
    content: "曽",
    decoration: " ~",
  });
  assertEquals(splitAffixNotation("曽〜"), {
    notation: "trailing",
    content: "曽",
    decoration: "〜",
  });
  assertEquals(splitAffixNotation("曽～"), {
    notation: "trailing",
    content: "曽",
    decoration: "～",
  });
});

Deno.test("splitAffixNotation leaves bilateral notation untouched", () => {
  assertEquals(splitAffixNotation("～ないし～"), {
    notation: "none",
    content: "～ないし～",
    decoration: "",
  });
});
