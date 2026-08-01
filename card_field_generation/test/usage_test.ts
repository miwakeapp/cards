import { assert, assertEquals, assertThrows } from "@std/assert";
import type { LanguageModelUsage } from "ai";
import {
  addGenerationUsage,
  assertGenerationUsage,
  EMPTY_GENERATION_USAGE,
  generationUsageFromAI,
  isGenerationUsage,
} from "../src/usage.ts";

const COMPLETE_USAGE = {
  inputTokens: 10,
  noCacheInputTokens: 7,
  cacheReadInputTokens: 2,
  cacheWriteInputTokens: 1,
  outputTokens: 4,
  reasoningOutputTokens: 1,
};

Deno.test("provider usage normalization preserves missing and contradictory telemetry", () => {
  const cases: readonly {
    name: string;
    input: LanguageModelUsage | undefined;
    expected: ReturnType<typeof generationUsageFromAI>;
  }[] = [
    {
      name: "no usage object",
      input: undefined,
      expected: {
        ...EMPTY_GENERATION_USAGE,
        providerUsageIncomplete: true,
      },
    },
    {
      name: "complete consistent totals and details",
      input: {
        inputTokens: 100,
        inputTokenDetails: { noCacheTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 0 },
        outputTokens: 10,
        outputTokenDetails: { textTokens: 8, reasoningTokens: 2 },
        totalTokens: 110,
      },
      expected: {
        inputTokens: 100,
        noCacheInputTokens: 80,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 0,
        outputTokens: 10,
        reasoningOutputTokens: 2,
      },
    },
    {
      name: "known total with missing cache classifications",
      input: {
        inputTokens: 100,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: 20,
          cacheWriteTokens: undefined,
        },
        outputTokens: 10,
        outputTokenDetails: { textTokens: 8, reasoningTokens: 2 },
        totalTokens: 110,
      },
      expected: {
        inputTokens: 100,
        noCacheInputTokens: 0,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 0,
        unclassifiedInputTokens: 80,
        providerUsageIncomplete: true,
        outputTokens: 10,
        reasoningOutputTokens: 2,
      },
    },
    {
      name: "complete details below provider totals",
      input: {
        inputTokens: 110,
        inputTokenDetails: { noCacheTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 0 },
        outputTokens: 12,
        outputTokenDetails: { textTokens: 8, reasoningTokens: 2 },
        totalTokens: 122,
      },
      expected: {
        inputTokens: 110,
        noCacheInputTokens: 80,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 0,
        unclassifiedInputTokens: 10,
        providerUsageInconsistent: true,
        outputTokens: 12,
        reasoningOutputTokens: 2,
      },
    },
    {
      name: "complete details above provider totals",
      input: {
        inputTokens: 90,
        inputTokenDetails: { noCacheTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 0 },
        outputTokens: 9,
        outputTokenDetails: { textTokens: 8, reasoningTokens: 2 },
        totalTokens: 99,
      },
      expected: {
        inputTokens: 100,
        noCacheInputTokens: 80,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 0,
        providerUsageInconsistent: true,
        outputTokens: 10,
        reasoningOutputTokens: 2,
      },
    },
    {
      name: "all provider counts unavailable",
      input: {
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        totalTokens: undefined,
      },
      expected: {
        ...EMPTY_GENERATION_USAGE,
        providerUsageIncomplete: true,
      },
    },
  ];

  for (const { name, input, expected } of cases) {
    const actual = generationUsageFromAI(input);
    assertGenerationUsage(actual);
    assertEquals(actual, expected, name);
  }
});

Deno.test("usage validation accepts complete records and enforces exact integer counts", () => {
  assertGenerationUsage(COMPLETE_USAGE);
  assert(isGenerationUsage(COMPLETE_USAGE));
  assert(isGenerationUsage({ ...COMPLETE_USAGE, unclassifiedInputTokens: 0 }));
  assert(isGenerationUsage({ ...COMPLETE_USAGE, providerUsageInconsistent: true }));
  assertEquals(isGenerationUsage({ ...COMPLETE_USAGE, inputTokens: 9 }), false);
  assertEquals(isGenerationUsage({ ...COMPLETE_USAGE, inputTokens: 10.5 }), false);
  assertEquals(isGenerationUsage({ ...COMPLETE_USAGE, noCacheInputTokens: -1 }), false);
  assertEquals(isGenerationUsage({ ...COMPLETE_USAGE, providerUsageIncomplete: false }), false);
  assertEquals(isGenerationUsage({ ...COMPLETE_USAGE, providerUsageInconsistent: false }), false);

  assertThrows(
    () => assertGenerationUsage({ ...COMPLETE_USAGE, inputTokens: 9 }),
    Error,
    "does not equal its uncached, cache-write, cache-read, and unclassified breakdown",
  );
});

Deno.test("usage aggregation treats a cache-hit zero as complete and preserves provider provenance", () => {
  const incomplete = {
    ...COMPLETE_USAGE,
    providerUsageIncomplete: true as const,
  };
  const inconsistent = {
    ...COMPLETE_USAGE,
    providerUsageInconsistent: true as const,
  };

  assertEquals(addGenerationUsage({ ...EMPTY_GENERATION_USAGE }, incomplete), incomplete);
  assertEquals(addGenerationUsage(incomplete, inconsistent), {
    inputTokens: 20,
    noCacheInputTokens: 14,
    cacheReadInputTokens: 4,
    cacheWriteInputTokens: 2,
    providerUsageIncomplete: true,
    providerUsageInconsistent: true,
    outputTokens: 8,
    reasoningOutputTokens: 2,
  });
  assertEquals(addGenerationUsage(COMPLETE_USAGE, COMPLETE_USAGE), {
    inputTokens: 20,
    noCacheInputTokens: 14,
    cacheReadInputTokens: 4,
    cacheWriteInputTokens: 2,
    outputTokens: 8,
    reasoningOutputTokens: 2,
  });
});
