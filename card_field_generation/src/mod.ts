/** Shared, evaluated AI generation for card fields that callers cannot resolve deterministically. */

export {
  DEFAULT_MODEL_ID,
  generateCardFields,
  generateSenseAndHintFields,
  MODEL_IDS,
} from "./generate.ts";
export type {
  CardFieldGenerationInput,
  GeneratedCardFields,
  GeneratedSenseAndHint,
  ModelId,
  SenseAndHintGenerationInput,
} from "./generate.ts";
export { needsAIMinimizedContext } from "./minimized_context.ts";
