import { assertEquals, assertThrows } from "@std/assert";
import type { ModelId } from "card_field_generation";
import { estimateUSDCost, PRICING_AS_OF, totalEstimatedUSDCost } from "../src/pricing.ts";

const usage = {
  inputTokens: 4_000_000,
  noCacheInputTokens: 1_000_000,
  cacheWriteInputTokens: 1_000_000,
  cacheReadInputTokens: 2_000_000,
  outputTokens: 1_000_000,
  reasoningOutputTokens: 250_000,
};

const PROMOTIONAL_PRICING_DATE = new Date("2026-07-29T00:00:00Z");

Deno.test("zero usage has zero estimated cost", () => {
  assertEquals(PRICING_AS_OF, "2026-07-29");
  const estimate = estimateUSDCost("gpt-5.6-luna", {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  assertEquals(estimate.total, 0);
});

Deno.test("Anthropic cost uses 5-minute writes, cache reads, and output once", () => {
  assertEquals(estimateUSDCost("claude-haiku-4-5", usage), {
    ratesPerMillionTokens: {
      uncachedInput: 1,
      cacheWriteInput: 1.25,
      cacheReadInput: 0.1,
      output: 5,
    },
    breakdown: {
      uncachedInput: 1,
      cacheWriteInput: 1.25,
      cacheReadInput: 0.2,
      output: 5,
    },
    total: 7.45,
  });
});

Deno.test("Claude Sonnet 5 uses its current introductory pricing", () => {
  assertEquals(estimateUSDCost("claude-sonnet-5", usage, PROMOTIONAL_PRICING_DATE), {
    ratesPerMillionTokens: {
      uncachedInput: 2,
      cacheWriteInput: 2.5,
      cacheReadInput: 0.2,
      output: 10,
    },
    breakdown: {
      uncachedInput: 2,
      cacheWriteInput: 2.5,
      cacheReadInput: 0.4,
      output: 10,
    },
    total: 14.9,
    pricingNote: "Uses Claude Sonnet 5 introductory pricing in effect through 2026-08-31.",
  });
});

Deno.test("Claude Sonnet 5 switches to announced standard pricing after the promotion", () => {
  assertEquals(
    estimateUSDCost("claude-sonnet-5", usage, new Date("2026-09-01T00:00:00Z")),
    {
      ratesPerMillionTokens: {
        uncachedInput: 3,
        cacheWriteInput: 3.75,
        cacheReadInput: 0.3,
        output: 15,
      },
      breakdown: {
        uncachedInput: 3,
        cacheWriteInput: 3.75,
        cacheReadInput: 0.6,
        output: 15,
      },
      total: 22.35,
      pricingNote: "Uses Claude Sonnet 5 standard pricing effective 2026-09-01.",
    },
  );
});

Deno.test("OpenAI cost uses 30-minute write and read discounts", () => {
  assertEquals(estimateUSDCost("gpt-5.6-luna", usage), {
    ratesPerMillionTokens: {
      uncachedInput: 1,
      cacheWriteInput: 1.25,
      cacheReadInput: 0.1,
      output: 6,
    },
    breakdown: {
      uncachedInput: 1,
      cacheWriteInput: 1.25,
      cacheReadInput: 0.2,
      output: 6,
    },
    total: 8.45,
  });
});

Deno.test("Gemini implicit-cache reads use context-caching pricing", () => {
  const estimate = estimateUSDCost("gemini-3.6-flash", usage);
  assertEquals(estimate.ratesPerMillionTokens, {
    uncachedInput: 1.5,
    cacheWriteInput: 1.5,
    cacheReadInput: 0.15,
    output: 7.5,
  });
  assertEquals(estimate.breakdown, {
    uncachedInput: 1.5,
    cacheWriteInput: 1.5,
    cacheReadInput: 0.3,
    output: 7.5,
  });
  assertEquals(estimate.total, 10.8);
});

Deno.test("every supported model exposes its audited per-token rates", () => {
  const zeroUsage = {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  const ratesFor = (modelId: ModelId) =>
    estimateUSDCost(modelId, zeroUsage, PROMOTIONAL_PRICING_DATE).ratesPerMillionTokens;

  assertEquals(ratesFor("gemini-3.6-flash"), {
    uncachedInput: 1.5,
    cacheWriteInput: 1.5,
    cacheReadInput: 0.15,
    output: 7.5,
  });
  assertEquals(ratesFor("gemini-3.5-flash-lite"), {
    uncachedInput: 0.3,
    cacheWriteInput: 0.3,
    cacheReadInput: 0.03,
    output: 2.5,
  });
  assertEquals(ratesFor("claude-haiku-4-5"), {
    uncachedInput: 1,
    cacheWriteInput: 1.25,
    cacheReadInput: 0.1,
    output: 5,
  });
  assertEquals(ratesFor("claude-sonnet-5"), {
    uncachedInput: 2,
    cacheWriteInput: 2.5,
    cacheReadInput: 0.2,
    output: 10,
  });
  assertEquals(ratesFor("claude-opus-5"), {
    uncachedInput: 5,
    cacheWriteInput: 6.25,
    cacheReadInput: 0.5,
    output: 25,
  });
  assertEquals(ratesFor("claude-fable-5"), {
    uncachedInput: 10,
    cacheWriteInput: 12.5,
    cacheReadInput: 1,
    output: 50,
  });
  assertEquals(ratesFor("gpt-5.6-luna"), {
    uncachedInput: 1,
    cacheWriteInput: 1.25,
    cacheReadInput: 0.1,
    output: 6,
  });
  assertEquals(ratesFor("gpt-5.6-terra"), {
    uncachedInput: 2.5,
    cacheWriteInput: 3.125,
    cacheReadInput: 0.25,
    output: 15,
  });
  assertEquals(ratesFor("gpt-5.6-sol"), {
    uncachedInput: 5,
    cacheWriteInput: 6.25,
    cacheReadInput: 0.5,
    output: 30,
  });
});

Deno.test("pricing rejects malformed usage instead of silently misestimating", () => {
  assertThrows(
    () => estimateUSDCost("gpt-5.6-luna", { ...usage, inputTokens: 3_999_999 }),
    Error,
    "does not equal its uncached, cache-write, cache-read, and unclassified breakdown",
  );
  assertThrows(
    () =>
      estimateUSDCost("gpt-5.6-luna", {
        ...usage,
        noCacheInputTokens: -1,
        inputTokens: 2_999_999,
      }),
    RangeError,
    "must be a nonnegative safe integer",
  );
  assertThrows(
    () => estimateUSDCost("gpt-5.6-luna", usage, new Date("invalid")),
    RangeError,
    "effectiveDate must be a valid Date",
  );
});

Deno.test("pricing lower-bounds input tokens without cache classification", () => {
  assertEquals(
    estimateUSDCost("gpt-5.6-luna", {
      inputTokens: 4_000_000,
      noCacheInputTokens: 1_000_000,
      cacheWriteInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      unclassifiedInputTokens: 1_000_000,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    }),
    {
      ratesPerMillionTokens: {
        uncachedInput: 1,
        cacheWriteInput: 1.25,
        cacheReadInput: 0.1,
        output: 6,
      },
      breakdown: {
        uncachedInput: 1,
        cacheWriteInput: 1.25,
        cacheReadInput: 0.1,
        unclassifiedInput: 0.1,
        output: 0,
      },
      total: 2.45,
      lowerBound: true,
      pricingNote:
        "1000000 input token(s) lacked provider cache classification and were priced at the lowest listed input-token rate ($0.1 per million).",
    },
  );
});

Deno.test("pricing identifies zero reported usage as an incomplete lower bound", () => {
  assertEquals(
    estimateUSDCost("gpt-5.6-luna", {
      inputTokens: 0,
      noCacheInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: 0,
      providerUsageIncomplete: true,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    }),
    {
      ratesPerMillionTokens: {
        uncachedInput: 1,
        cacheWriteInput: 1.25,
        cacheReadInput: 0.1,
        output: 6,
      },
      breakdown: {
        uncachedInput: 0,
        cacheWriteInput: 0,
        cacheReadInput: 0,
        output: 0,
      },
      total: 0,
      lowerBound: true,
      pricingNote:
        "Provider usage telemetry was incomplete; reported token counts and this cost estimate are lower bounds.",
    },
  );
});

Deno.test("pricing labels normalized contradictory usage as uncertain, not a lower bound", () => {
  assertEquals(
    estimateUSDCost("gpt-5.6-luna", {
      inputTokens: 4_000_000,
      noCacheInputTokens: 1_000_000,
      cacheWriteInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
      unclassifiedInputTokens: 1_000_000,
      providerUsageInconsistent: true,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    }),
    {
      ratesPerMillionTokens: {
        uncachedInput: 1,
        cacheWriteInput: 1.25,
        cacheReadInput: 0.1,
        output: 6,
      },
      breakdown: {
        uncachedInput: 1,
        cacheWriteInput: 1.25,
        cacheReadInput: 0.1,
        unclassifiedInput: 0.1,
        output: 0,
      },
      total: 2.45,
      uncertain: true,
      pricingNote:
        "Provider usage telemetry was internally inconsistent; normalized token counts and this cost estimate are uncertain and may overstate or understate actual usage and cost. 1000000 input token(s) lacked provider cache classification and were priced at the lowest listed input-token rate ($0.1 per million).",
    },
  );
});

Deno.test("inconsistent telemetry overrides incomplete telemetry's lower-bound label", () => {
  assertEquals(
    estimateUSDCost("gpt-5.6-luna", {
      inputTokens: 0,
      noCacheInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheReadInputTokens: 0,
      providerUsageIncomplete: true,
      providerUsageInconsistent: true,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    }),
    {
      ratesPerMillionTokens: {
        uncachedInput: 1,
        cacheWriteInput: 1.25,
        cacheReadInput: 0.1,
        output: 6,
      },
      breakdown: {
        uncachedInput: 0,
        cacheWriteInput: 0,
        cacheReadInput: 0,
        output: 0,
      },
      total: 0,
      uncertain: true,
      pricingNote:
        "Provider usage telemetry was incomplete and internally inconsistent; normalized token counts and this cost estimate are uncertain and may overstate or understate actual usage and cost.",
    },
  );
});

Deno.test("whole-run totals retain small costs", () => {
  const first = estimateUSDCost("gpt-5.6-luna", {
    inputTokens: 1,
    noCacheInputTokens: 1,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  const second = estimateUSDCost("claude-haiku-4-5", {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheWriteInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 1,
    reasoningOutputTokens: 1,
  });
  assertEquals(totalEstimatedUSDCost([first, second]), 0.000006);
});
