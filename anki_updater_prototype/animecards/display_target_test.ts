import { assertEquals, assertThrows } from "@std/assert";
import {
  applyDisplayTargetOverride,
  hasBoundaryNotation,
  normalizeNotationMarkers,
} from "./display_target.ts";

Deno.test("normalizeNotationMarkers canonicalizes only boundary notation", () => {
  assertEquals(normalizeNotationMarkers("~まがい"), "～まがい");
  assertEquals(normalizeNotationMarkers("曽〜"), "曽～");
  assertEquals(normalizeNotationMarkers("～ないし~"), "～ないし～");
  assertEquals(normalizeNotationMarkers("A~B"), "A~B");
  assertEquals(hasBoundaryNotation("～まがい"), true);
  assertEquals(hasBoundaryNotation("A~B"), false);
});

Deno.test("applyDisplayTargetOverride transfers precise furigana into a user edit", () => {
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "～然", reading: "～然[ぜん]" },
      "然",
      "～然とする",
    ),
    {
      recognitionTarget: "～然とする",
      reading: "～然[ぜん]とする",
    },
  );
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "～まがい", reading: null },
      "まがい",
      "～まがい",
    ),
    {
      recognitionTarget: "～まがい",
      reading: null,
    },
  );
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "然", reading: "然[ぜん]" },
      "然",
      "～然とする<script>",
    ),
    {
      recognitionTarget: "～然とする&lt;script&gt;",
      reading: "～然[ぜん]とする&lt;script&gt;",
    },
  );
});

Deno.test("applyDisplayTargetOverride leaves automatic notation alone without an override", () => {
  assertEquals(
    applyDisplayTargetOverride(
      { recognitionTarget: "曽～", reading: "曽[そう]～" },
      "曽",
      undefined,
    ),
    {
      recognitionTarget: "曽～",
      reading: "曽[そう]～",
    },
  );
});

Deno.test("applyDisplayTargetOverride requires exactly one key spelling", () => {
  assertThrows(
    () =>
      applyDisplayTargetOverride(
        { recognitionTarget: "然", reading: "然[ぜん]" },
        "然",
        "別",
      ),
    Error,
    "exactly once",
  );
});
