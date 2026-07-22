/**
 * card_creator module - Creates Miwake cards from context and JMDict entries.
 */

// Core card creation
export { createCard } from "./create_card.ts";
export type { CreateCardOptions } from "./create_card.ts";
export { needsAIMinimizedContext, normalizeMinimizedContext } from "./minimized_context.ts";
export { formatSourceHTML } from "./source.ts";

// Types
export type {
  AIGeneratedFields,
  CardCreationInput,
  GenerateFieldsInput,
  MiwakeCard,
} from "./types.ts";

// Card keys
export { formatMiwakeKey, parseMiwakeKey } from "./keys.ts";
export type { MiwakeKey } from "./keys.ts";
