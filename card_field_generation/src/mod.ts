/** Shared, evaluated AI generation for card fields that callers cannot resolve deterministically. */

export {
  CARD_FIELD_GENERATION_CACHE_VERSION,
  DEFAULT_MODEL_ID,
  generateCardFields,
  generateContrastiveHint,
  generateMinimizedContext,
  generateSenseAndHintFields,
  generateTargetInContext,
  MODEL_IDS,
} from "./generate.ts";
export type {
  AllCompatibleSenses,
  CardFieldGenerationInput,
  ContrastiveHintGenerationInput,
  GeneratedApplicableCardFields,
  GeneratedCardFields,
  GeneratedSenseAndHint,
  MinimizedContextGenerationInput,
  ModelId,
  NoApplicableSense,
  SelectedApplicableSenses,
  SenseAndHintGenerationInput,
  TargetInContextGenerationInput,
} from "./generate.ts";
export { needsAIMinimizedContext } from "./minimized_context.ts";
