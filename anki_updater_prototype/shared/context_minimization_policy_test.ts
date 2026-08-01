import { assertEquals } from "@std/assert";
import { needsAIMinimizedContext } from "./context_minimization_policy.ts";

Deno.test("needsAIMinimizedContext measures visible front-side context text", () => {
  assertEquals(
    needsAIMinimizedContext(`<mark><ruby>${"短".repeat(48)}<rt>みじかい</rt></ruby></mark>`),
    false,
  );
  assertEquals(
    needsAIMinimizedContext(`<mark><ruby>${"長".repeat(51)}<rt>ながい</rt></ruby></mark>`),
    true,
  );
  assertEquals(needsAIMinimizedContext(`<mark>${"短".repeat(50)}</mark>`), false);
  assertEquals(needsAIMinimizedContext(`<mark>${"𠮷".repeat(50)}</mark>`), false);
});

Deno.test("needsAIMinimizedContext understands Anki furigana without deleting bracketed prose", () => {
  assertEquals(
    needsAIMinimizedContext(`<mark>${"漢".repeat(26)}[かん]</mark> ${"字".repeat(24)}[じ]`),
    false,
  );
  assertEquals(
    needsAIMinimizedContext(`<mark>${"漢".repeat(26)}[かん]</mark> ${"字".repeat(25)}[じ]`),
    true,
  );
  assertEquals(needsAIMinimizedContext(`<mark>${"短".repeat(48)}</mark>［補足］`), true);
});
