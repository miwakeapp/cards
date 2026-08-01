import { assertGenerationUsage, type GenerationUsage, type ModelId } from "card_field_generation";

/** Date on which the first-party list prices in this module were verified. */
export const PRICING_AS_OF = "2026-07-29";

/** First-party pricing pages used to maintain the checked-in rates. */
export const PRICING_SOURCE_URLS = {
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  google: "https://ai.google.dev/gemini-api/docs/pricing",
  openai: "https://developers.openai.com/api/docs/pricing",
} as const;

/** Provider-keyed official pricing links embedded in each self-contained eval report. */
export type PricingSourceURLs = typeof PRICING_SOURCE_URLS;

/** Why an eval report's dollar amount must not be treated as invoice truth. */
export const COST_ESTIMATE_DISCLAIMER =
  "Estimated from provider-reported token counts and first-party standard API list prices; excludes negotiated discounts, free tiers, taxes, regional or data-residency uplifts, batch/flex/priority pricing, tools, and cache-storage charges.";

/** Standard API token rates in USD per million tokens. */
export interface TokenRatesPerMillion {
  uncachedInput: number;
  cacheWriteInput: number;
  cacheReadInput: number;
  output: number;
}

/** Auditable component and total cost estimate for one model's aggregate usage. */
export interface EstimatedUSDCost {
  ratesPerMillionTokens: TokenRatesPerMillion;
  breakdown: {
    uncachedInput: number;
    cacheWriteInput: number;
    cacheReadInput: number;
    /** Cost assigned to input tokens whose provider cache category was unavailable. */
    unclassifiedInput?: number;
    output: number;
  };
  total: number;
  /** Present when incomplete provider telemetry makes `total` a lower bound. */
  lowerBound?: true;
  /** Present when contradictory provider telemetry makes `total` uncertain in either direction. */
  uncertain?: true;
  pricingNote?: string;
}

interface ModelPricing {
  rates: TokenRatesPerMillion;
  note?: string;
}

function rates(
  uncachedInput: number,
  cacheWriteInput: number,
  cacheReadInput: number,
  output: number,
): TokenRatesPerMillion {
  return { uncachedInput, cacheWriteInput, cacheReadInput, output };
}

// These are first-party, standard synchronous API prices. `card_field_generation` uses Anthropic's
// 5-minute writes and OpenAI's 30-minute explicit writes, both billed at 1.25x input. Gemini uses
// implicit caching: reads receive the listed context-caching rate and cache creation has no
// separate surcharge, so a provider-reported write token is priced as ordinary input.
// Reasoning tokens are already included in `GenerationUsage.outputTokens` and are not charged twice.
const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  "gemini-3.6-flash": {
    rates: rates(1.5, 1.5, 0.15, 7.5),
    note:
      "Gemini implicit-cache reads use the context-caching rate; implicit cache creation has no separate write surcharge.",
  },
  "gemini-3.5-flash-lite": {
    rates: rates(0.3, 0.3, 0.03, 2.5),
    note:
      "Gemini implicit-cache reads use the context-caching rate; implicit cache creation has no separate write surcharge.",
  },
  "claude-haiku-4-5": { rates: rates(1, 1.25, 0.1, 5) },
  "claude-sonnet-5": {
    rates: rates(2, 2.5, 0.2, 10),
    note: "Uses Claude Sonnet 5 introductory pricing in effect through 2026-08-31.",
  },
  "claude-opus-5": { rates: rates(5, 6.25, 0.5, 25) },
  "claude-fable-5": { rates: rates(10, 12.5, 1, 50) },
  "gpt-5.6-luna": { rates: rates(1, 1.25, 0.1, 6) },
  "gpt-5.6-terra": { rates: rates(2.5, 3.125, 0.25, 15) },
  "gpt-5.6-sol": { rates: rates(5, 6.25, 0.5, 30) },
};

const SONNET_5_STANDARD_PRICING_START = Date.parse("2026-09-01T00:00:00Z");

function modelPricing(modelId: ModelId, effectiveDate: Date): ModelPricing {
  const effectiveTime = effectiveDate.valueOf();
  if (!Number.isFinite(effectiveTime)) {
    throw new RangeError(`effectiveDate must be a valid Date; received ${effectiveDate}`);
  }
  if (modelId !== "claude-sonnet-5" || effectiveTime < SONNET_5_STANDARD_PRICING_START) {
    return MODEL_PRICING[modelId];
  }
  return {
    rates: rates(3, 3.75, 0.3, 15),
    note: "Uses Claude Sonnet 5 standard pricing effective 2026-09-01.",
  };
}

function roundedUSD(value: number): number {
  return Number(value.toFixed(12));
}

function componentCost(tokens: number, ratePerMillion: number): number {
  return roundedUSD(tokens * ratePerMillion / 1_000_000);
}

/** Estimates standard API list-price cost at `effectiveDate` from provider-reported usage. */
export function estimateUSDCost(
  modelId: ModelId,
  usage: GenerationUsage,
  effectiveDate = new Date(),
): EstimatedUSDCost {
  assertGenerationUsage(usage);
  const pricing = modelPricing(modelId, effectiveDate);
  const unclassifiedInputTokens = usage.unclassifiedInputTokens ?? 0;
  const uncertain = usage.providerUsageInconsistent === true;
  const lowerBound = !uncertain &&
    (usage.providerUsageIncomplete === true || unclassifiedInputTokens > 0);
  const unclassifiedInputRate = Math.min(
    pricing.rates.uncachedInput,
    pricing.rates.cacheWriteInput,
    pricing.rates.cacheReadInput,
  );
  const breakdown = {
    uncachedInput: componentCost(
      usage.noCacheInputTokens,
      pricing.rates.uncachedInput,
    ),
    cacheWriteInput: componentCost(
      usage.cacheWriteInputTokens,
      pricing.rates.cacheWriteInput,
    ),
    cacheReadInput: componentCost(
      usage.cacheReadInputTokens,
      pricing.rates.cacheReadInput,
    ),
    ...(unclassifiedInputTokens === 0 ? {} : {
      unclassifiedInput: componentCost(unclassifiedInputTokens, unclassifiedInputRate),
    }),
    output: componentCost(usage.outputTokens, pricing.rates.output),
  };
  return {
    ratesPerMillionTokens: { ...pricing.rates },
    breakdown,
    total: roundedUSD(
      breakdown.uncachedInput + breakdown.cacheWriteInput +
        breakdown.cacheReadInput + (breakdown.unclassifiedInput ?? 0) + breakdown.output,
    ),
    ...(lowerBound ? { lowerBound: true as const } : {}),
    ...(uncertain ? { uncertain: true as const } : {}),
    ...(
      pricing.note === undefined && !lowerBound && !uncertain ? {} : {
        pricingNote: [
          pricing.note,
          uncertain
            ? usage.providerUsageIncomplete === true
              ? "Provider usage telemetry was incomplete and internally inconsistent; normalized token counts and this cost estimate are uncertain and may overstate or understate actual usage and cost."
              : "Provider usage telemetry was internally inconsistent; normalized token counts and this cost estimate are uncertain and may overstate or understate actual usage and cost."
            : usage.providerUsageIncomplete === true
            ? "Provider usage telemetry was incomplete; reported token counts and this cost estimate are lower bounds."
            : undefined,
          unclassifiedInputTokens === 0
            ? undefined
            : `${unclassifiedInputTokens} input token(s) lacked provider cache classification and were priced at the lowest listed input-token rate ($${unclassifiedInputRate} per million).`,
        ].filter((note) => note !== undefined).join(" "),
      }
    ),
  };
}

/** Sums already-computed estimates without losing sub-cent eval costs. */
export function totalEstimatedUSDCost(
  estimates: readonly EstimatedUSDCost[],
): number {
  return roundedUSD(estimates.reduce((total, estimate) => total + estimate.total, 0));
}
