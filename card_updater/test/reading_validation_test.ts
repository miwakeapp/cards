import { assertEquals } from "@std/assert";
import { parseCardReadingAlternatives } from "../src/reading_validation.ts";

Deno.test("parseCardReadingAlternatives projects a unique readable Key spelling", () => {
  assertEquals(
    parseCardReadingAlternatives("その 異[い] 名[みょう]", "その異名", "異名"),
    [{ formatted: "その 異[い] 名[みょう]", kanaReading: "いみょう" }],
  );
  assertEquals(
    parseCardReadingAlternatives("～ 然[ぜん]とする", "～然とする", "然"),
    [{ formatted: "～ 然[ぜん]とする", kanaReading: "ぜん" }],
  );
});

Deno.test("parseCardReadingAlternatives rejects ambiguous or split ruby bases", () => {
  assertEquals(
    parseCardReadingAlternatives(
      "異[い] 名[みょう]と 異[い] 名[めい]",
      "異名と異名",
      "異名",
    ),
    null,
  );
  assertEquals(parseCardReadingAlternatives("大人[おとな]", "大人", "大"), null);
});
