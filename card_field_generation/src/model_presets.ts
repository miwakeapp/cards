/** Provider-independent reasoning effort requested by a caller or eval. */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/** Provider-effective reasoning setting after normalizing unsupported or equivalent requests. */
export type EffectiveReasoningEffort = ReasoningEffort | "disabled";

/** Models useful for production generation and comparative evaluation. */
export const MODEL_IDS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "claude-haiku-4-5",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-fable-5",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
] as const;

/** A supported provider model identifier. */
export type ModelId = (typeof MODEL_IDS)[number];

/**
 * Normalizes a requested reasoning effort to the setting the provider actually receives.
 *
 * The providers expose overlapping but different scales. In particular, GPT-5.6 omits `minimal`,
 * Gemini omits `none`, `xhigh`, and `max`, Anthropic omits `minimal`, and Haiku 4.5 exposes none of
 * these controls. Keeping this normalization beside the model registry gives caches, eval
 * matrices, and reports one provider-effective identity for equivalent requests.
 */
export function effectiveReasoningEffort(
  modelId: ModelId,
  requestedEffort: ReasoningEffort,
): EffectiveReasoningEffort {
  if (modelId === "claude-haiku-4-5") return "disabled";
  if (modelId.startsWith("claude-")) {
    if (requestedEffort === "none") return "disabled";
    if (requestedEffort === "minimal") return "low";
    return requestedEffort;
  }
  if (modelId.startsWith("gemini-")) {
    if (requestedEffort === "none") return "minimal";
    if (requestedEffort === "xhigh" || requestedEffort === "max") return "high";
    return requestedEffort;
  }
  if (requestedEffort === "minimal") return "none";
  return requestedEffort;
}

/** Focused operations with configured production baselines. */
export const FIELD_GENERATION_OPERATIONS = [
  "context-minimization",
  "hint",
  "reading-selection",
  "sense-selection",
] as const;

/** Stable operation identity shared by generation metadata, caches, and eval artifacts. */
export type FieldGenerationOperation = (typeof FIELD_GENERATION_OPERATIONS)[number];

/** Current model and reasoning baseline for one operation. */
export interface ProductionGenerationConfiguration {
  /** Provider model preset. */
  modelId: ModelId;
  /** Provider reasoning effort. */
  reasoningEffort: ReasoningEffort;
}

/**
 * Production settings for each focused operation.
 *
 * Callers should omit `modelId` and `reasoningEffort` to use these settings. This map is public so
 * command-line tools and the eval runner can describe the actual defaults without duplicating
 * them.
 */
export const PRODUCTION_GENERATION_CONFIGURATIONS = {
  "context-minimization": {
    modelId: "claude-opus-5",
    reasoningEffort: "low",
  },
  hint: {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
  },
  "reading-selection": {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
  },
  "sense-selection": {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
  },
} as const satisfies Record<FieldGenerationOperation, ProductionGenerationConfiguration>;
