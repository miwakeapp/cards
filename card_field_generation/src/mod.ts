/** Shared AI generation for card fields that callers cannot resolve deterministically. */

export { generationCacheKey, MemoryGenerationCache } from "./cache.ts";
export type { GenerationCache } from "./cache.ts";
export { minimizeContext } from "./context_minimization.ts";
export type { ContextMinimizationInput } from "./context_minimization.ts";
export { generateSourceGroundedHint } from "./hint.ts";
export type {
  HintGenerationInput,
  HintGenerationOutcome,
  InsufficientHintEvidence,
  JMDictUsageReference,
  NoHintNeeded,
  SourceGroundedHint,
} from "./hint.ts";
export {
  effectiveReasoningEffort,
  FIELD_GENERATION_OPERATIONS,
  MODEL_IDS,
  PRODUCTION_GENERATION_CONFIGURATIONS,
} from "./model_presets.ts";
export type {
  EffectiveReasoningEffort,
  FieldGenerationOperation,
  ModelId,
  ProductionGenerationConfiguration,
  ReasoningEffort,
} from "./model_presets.ts";
export { isAIQuotaError } from "./provider_error.ts";
export { GenerationAttemptsExhaustedError } from "./runner.ts";
export type {
  CachedGenerationMetadata,
  GenerationAttempt,
  GenerationFingerprints,
  GenerationMetadata,
  GenerationOptions,
  GenerationResult,
  GenerationSideEffectError,
} from "./runner.ts";
export {
  addGenerationUsage,
  assertGenerationUsage,
  EMPTY_GENERATION_USAGE,
  isGenerationUsage,
} from "./usage.ts";
export type { GenerationUsage } from "./usage.ts";
export { selectSensesForCard } from "./sense_selection.ts";
export type { SenseSelectionInput, SenseSelectionOutcome } from "./sense_selection.ts";
