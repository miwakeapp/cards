import { assertEquals } from "@std/assert";
import { needsAIMinimizedContext } from "../src/minimized_context.ts";

Deno.test("needsAIMinimizedContext uses plain-text length", () => {
  assertEquals(needsAIMinimizedContext(`<ruby>${"短".repeat(48)}<rt>みじかい</rt></ruby>`), false);
  assertEquals(needsAIMinimizedContext(`<ruby>${"長".repeat(51)}<rt>ながい</rt></ruby>`), true);
  assertEquals(needsAIMinimizedContext(`<mark>${"短".repeat(50)}</mark>`), false);
  assertEquals(needsAIMinimizedContext("𠮷".repeat(50)), false);
});
