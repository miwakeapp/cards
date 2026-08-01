import { assertEquals, assertThrows } from "@std/assert";
import {
  contextMinimizationMessages,
  validateContextMinimization,
} from "../src/context_minimization.ts";

Deno.test("contextMinimizationMessages sends rendered text rather than source HTML", () => {
  const messages = contextMinimizationMessages({
    fullContext:
      "<p>前置き。</p><p><ruby>頼<rt>たよ</rt></ruby>って、<mark><ruby>頼<rt>たよ</rt></ruby>られた</mark>。</p>",
  });
  assertEquals(
    messages.at(-1),
    {
      role: "user",
      content:
        'Quoted full source context (JSON string):\n"前置き。\\n\\n頼って、⟪target:0⟫頼られた⟪/target:0⟫。"',
    },
  );
});

Deno.test("validateContextMinimization restores safe HTML", () => {
  assertEquals(
    validateContextMinimization(
      {
        fullContext: "<p>長い前置き。</p><p>&lt;危険&gt;&amp;<mark>対象</mark>の説明が続いた。</p>",
      },
      {
        minimizedText: "<危険>&⟪target:0⟫対象⟪/target:0⟫。",
      },
    ),
    "&lt;危険&gt;&amp;<mark>対象</mark>。",
  );
});

Deno.test("validateContextMinimization rejects changed target surfaces", () => {
  assertThrows(
    () =>
      validateContextMinimization(
        {
          fullContext: "<p>長い前置きのあとで、<mark>対象</mark>を選んだ。</p>",
        },
        {
          minimizedText: "⟪target:0⟫別物⟪/target:0⟫を選んだ。",
        },
      ),
    Error,
    "changed target surface for occurrence ID 0",
  );
});
