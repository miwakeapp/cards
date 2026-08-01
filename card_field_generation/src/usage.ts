import type { LanguageModelUsage } from "ai";

/** Aggregate token counts across all paid attempts in a generation. */
export interface GenerationUsage {
  /** All input tokens billed or reported by the provider. */
  inputTokens: number;
  /** Input tokens that received no provider prompt-cache discount. */
  noCacheInputTokens: number;
  /** Input tokens read from the provider's prompt cache. */
  cacheReadInputTokens: number;
  /** Input tokens written to the provider's prompt cache. */
  cacheWriteInputTokens: number;
  /**
   * Input tokens included in `inputTokens` which the provider did not classify into any of the
   * preceding cache-detail buckets.
   *
   * Omission means zero, keeping complete fresh breakdowns concise.
   */
  unclassifiedInputTokens?: number;
  /** Whether any provider usage total or detail needed for this breakdown was unavailable. */
  providerUsageIncomplete?: true;
  /**
   * Whether provider totals and detail buckets contradicted each other.
   *
   * Counts are normalized upward so that their structural invariants remain useful, but they may
   * then overstate or understate actual usage.
   */
  providerUsageInconsistent?: true;
  /** All generated output tokens. */
  outputTokens: number;
  /** Output tokens used for hidden or summarized reasoning. */
  reasoningOutputTokens: number;
}

/** Complete zero usage, suitable for cache hits and reduction identities. */
export const EMPTY_GENERATION_USAGE: Readonly<GenerationUsage> = Object.freeze({
  inputTokens: 0,
  noCacheInputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

/** Normalizes the AI SDK's provider telemetry into the package's exact usage partition. */
export function generationUsageFromAI(
  usage: LanguageModelUsage | undefined,
): GenerationUsage {
  if (usage === undefined) {
    return { ...EMPTY_GENERATION_USAGE, providerUsageIncomplete: true };
  }
  const reportedInputTokens = usage.inputTokens;
  const reportedNoCacheInputTokens = usage.inputTokenDetails.noCacheTokens;
  const reportedCacheReadInputTokens = usage.inputTokenDetails.cacheReadTokens;
  const reportedCacheWriteInputTokens = usage.inputTokenDetails.cacheWriteTokens;
  const noCacheInputTokens = reportedNoCacheInputTokens ?? 0;
  const cacheReadInputTokens = reportedCacheReadInputTokens ?? 0;
  const cacheWriteInputTokens = reportedCacheWriteInputTokens ?? 0;
  const classifiedInputTokens = noCacheInputTokens + cacheReadInputTokens +
    cacheWriteInputTokens;
  const inputTokens = Math.max(reportedInputTokens ?? 0, classifiedInputTokens);
  const unclassifiedInputTokens = Math.max(
    0,
    (reportedInputTokens ?? 0) - classifiedInputTokens,
  );
  const reportedTextOutputTokens = usage.outputTokenDetails.textTokens;
  const reportedReasoningOutputTokens = usage.outputTokenDetails.reasoningTokens;
  const textOutputTokens = reportedTextOutputTokens ?? 0;
  const reasoningOutputTokens = reportedReasoningOutputTokens ?? 0;
  const detailedOutputTokens = textOutputTokens + reasoningOutputTokens;
  const reportedOutputTokens = usage.outputTokens;
  const outputTokens = Math.max(reportedOutputTokens ?? 0, detailedOutputTokens);
  const inputDetailsIncomplete = reportedNoCacheInputTokens === undefined ||
    reportedCacheReadInputTokens === undefined ||
    reportedCacheWriteInputTokens === undefined;
  const outputDetailsIncomplete = reportedTextOutputTokens === undefined ||
    reportedReasoningOutputTokens === undefined;
  const providerUsageIncomplete = reportedInputTokens === undefined ||
    inputDetailsIncomplete ||
    reportedOutputTokens === undefined ||
    outputDetailsIncomplete;
  // A larger total can be explained by omitted nonnegative detail buckets. A smaller total cannot.
  // Once every detail is present, any disagreement is internally contradictory in either direction.
  const providerUsageInconsistent = (
    reportedInputTokens !== undefined &&
    (classifiedInputTokens > reportedInputTokens ||
      (!inputDetailsIncomplete && classifiedInputTokens !== reportedInputTokens))
  ) || (
    reportedOutputTokens !== undefined &&
    (detailedOutputTokens > reportedOutputTokens ||
      (!outputDetailsIncomplete && detailedOutputTokens !== reportedOutputTokens))
  );
  return {
    inputTokens,
    noCacheInputTokens,
    cacheReadInputTokens,
    cacheWriteInputTokens,
    ...(unclassifiedInputTokens === 0 ? {} : { unclassifiedInputTokens }),
    ...(providerUsageIncomplete ? { providerUsageIncomplete: true as const } : {}),
    ...(providerUsageInconsistent ? { providerUsageInconsistent: true as const } : {}),
    outputTokens,
    reasoningOutputTokens,
  };
}

/** Adds two usage records while preserving provider-telemetry provenance. */
export function addGenerationUsage(
  left: GenerationUsage,
  right: GenerationUsage,
): GenerationUsage {
  const unclassifiedInputTokens = (left.unclassifiedInputTokens ?? 0) +
    (right.unclassifiedInputTokens ?? 0);
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    noCacheInputTokens: left.noCacheInputTokens + right.noCacheInputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    ...(unclassifiedInputTokens === 0 ? {} : { unclassifiedInputTokens }),
    ...(left.providerUsageIncomplete === true || right.providerUsageIncomplete === true
      ? { providerUsageIncomplete: true as const }
      : {}),
    ...(left.providerUsageInconsistent === true || right.providerUsageInconsistent === true
      ? { providerUsageInconsistent: true as const }
      : {}),
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens: left.reasoningOutputTokens + right.reasoningOutputTokens,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredCount(value: Record<string, unknown>, name: keyof GenerationUsage): number {
  const count = value[name];
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new RangeError(
      `GenerationUsage.${name} must be a nonnegative safe integer; got ${count}`,
    );
  }
  return count as number;
}

/** Validates runtime usage, including its exact input-token partition. */
export function assertGenerationUsage(value: unknown): asserts value is GenerationUsage {
  if (!isRecord(value)) {
    throw new TypeError("GenerationUsage must be a non-null object");
  }
  const inputTokens = requiredCount(value, "inputTokens");
  const noCacheInputTokens = requiredCount(value, "noCacheInputTokens");
  const cacheReadInputTokens = requiredCount(value, "cacheReadInputTokens");
  const cacheWriteInputTokens = requiredCount(value, "cacheWriteInputTokens");
  const outputTokens = requiredCount(value, "outputTokens");
  const reasoningOutputTokens = requiredCount(value, "reasoningOutputTokens");
  const unclassifiedInputTokens = value.unclassifiedInputTokens === undefined
    ? 0
    : requiredCount(value, "unclassifiedInputTokens");
  if (value.providerUsageIncomplete !== undefined && value.providerUsageIncomplete !== true) {
    throw new TypeError(
      `GenerationUsage.providerUsageIncomplete must be true or omitted; got ${value.providerUsageIncomplete}`,
    );
  }
  if (
    value.providerUsageInconsistent !== undefined &&
    value.providerUsageInconsistent !== true
  ) {
    throw new TypeError(
      `GenerationUsage.providerUsageInconsistent must be true or omitted; got ${value.providerUsageInconsistent}`,
    );
  }
  const detailedInputTokens = noCacheInputTokens + cacheReadInputTokens +
    cacheWriteInputTokens + unclassifiedInputTokens;
  if (inputTokens !== detailedInputTokens) {
    throw new Error(
      `GenerationUsage.inputTokens (${inputTokens}) does not equal its uncached, cache-write, cache-read, and unclassified breakdown (${detailedInputTokens})`,
    );
  }
  if (reasoningOutputTokens > outputTokens) {
    throw new Error(
      `GenerationUsage.reasoningOutputTokens (${reasoningOutputTokens}) exceeds outputTokens (${outputTokens})`,
    );
  }
}

/** Whether `value` is valid runtime generation usage. */
export function isGenerationUsage(value: unknown): value is GenerationUsage {
  try {
    assertGenerationUsage(value);
    return true;
  } catch {
    return false;
  }
}
