/** Shared, evaluated AI generation for card fields that callers cannot resolve deterministically. */

export {
  CARD_FIELD_GENERATION_CACHE_VERSION,
  DEFAULT_MODEL_ID,
  generateCardFields,
  generateSenseAndHintFields,
  MODEL_IDS,
} from "./generate.ts";
export type {
  AllCompatibleSenses,
  CardFieldGenerationInput,
  GeneratedApplicableCardFields,
  GeneratedCardFields,
  GeneratedSenseAndHint,
  ModelId,
  NoApplicableSense,
  SelectedApplicableSenses,
  SenseAndHintGenerationInput,
} from "./generate.ts";
export { needsAIMinimizedContext } from "./minimized_context.ts";
