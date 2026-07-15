import { assertEquals } from "@std/assert";
import { needsAIMinimizedContext, normalizeMinimizedContext } from "../src/minimized_context.ts";

Deno.test("needsAIMinimizedContext uses plain-text length", () => {
  assertEquals(needsAIMinimizedContext(`<ruby>${"短".repeat(48)}<rt>みじかい</rt></ruby>`), false);
  assertEquals(needsAIMinimizedContext(`<ruby>${"長".repeat(51)}<rt>ながい</rt></ruby>`), true);
  assertEquals(needsAIMinimizedContext(`<mark>${"短".repeat(50)}</mark>`), false);
  assertEquals(needsAIMinimizedContext("𠮷".repeat(50)), false);
});

Deno.test("normalizeMinimizedContext drops markup-only differences", () => {
  assertEquals(
    normalizeMinimizedContext("これは<mark>対象[たいしょう]</mark>です。", "これは対象です。"),
    null,
  );
  assertEquals(
    normalizeMinimizedContext("これは長い<mark>対象</mark>の文章です。", "<mark>対象</mark>です。"),
    "<mark>対象</mark>です。",
  );
  assertEquals(
    normalizeMinimizedContext(
      "これは<ruby>対象<rt>たいしょう</rt></ruby>です。",
      "これは対象です。",
    ),
    null,
  );
  assertEquals(normalizeMinimizedContext("A&amp;B", "A&B"), null);
});
