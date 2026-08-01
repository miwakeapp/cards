import {
  CONTEXT_MINIMIZATION_PROMPT_FIXTURE_IDS,
  CONTEXT_MINIMIZATION_PROMPT_FIXTURE_LINKS,
  type ContextMinimizationInput,
  contextMinimizationMessages,
} from "./context_minimization.ts";
import { type HintGenerationInput, hintMessages } from "./hint.ts";
import { HINT_PROMPT_FIXTURE_IDS, HINT_PROMPT_FIXTURE_LINKS } from "./hint_few_shots.ts";
import {
  type PromptJMDictEntry,
  promptJMDictEntry,
  type PromptJMDictSense,
} from "./jmdict_prompt.ts";
import {
  contextMinimizationPromptFixtureSignature,
  contextMinimizationPromptOutputSignature,
  hintPromptFixtureSignature,
  hintPromptOutputSignature,
  type PromptFixtureLink,
  promptFixtureSurfaceText,
  type PromptFixtureUsageSignatureInput,
  promptJMDictProjectionSignature,
  senseSelectionPromptFixtureSignature,
  senseSelectionPromptOutputSignature,
} from "./prompt_fixture_signature.ts";
import { type SenseSelectionInput, senseSelectionMessages } from "./sense_selection.ts";
import {
  SENSE_SELECTION_PROMPT_FIXTURE_IDS,
  SENSE_SELECTION_PROMPT_FIXTURE_LINKS,
} from "./sense_selection_few_shots.ts";
import type { FieldGenerationOperation } from "./model_presets.ts";

export type { FieldGenerationOperation } from "./model_presets.ts";

/**
 * Semantic links computed from the actual few-shots used in each production prompt.
 *
 * Eval infrastructure checks these links against the tracked fixture corpus. Keeping the
 * provider-free few-shot definitions as the only source of truth avoids mirroring prompt examples
 * or their signatures in test code.
 */
export const PROMPT_FEW_SHOT_FIXTURE_LINKS: Readonly<
  Record<FieldGenerationOperation, readonly PromptFixtureLink[]>
> = Object.freeze({
  "context-minimization": CONTEXT_MINIMIZATION_PROMPT_FIXTURE_LINKS,
  hint: HINT_PROMPT_FIXTURE_LINKS,
  "sense-selection": SENSE_SELECTION_PROMPT_FIXTURE_LINKS,
});

/** Exact eval fixture IDs represented by {@link PROMPT_FEW_SHOT_FIXTURE_LINKS}. */
export const PROMPT_FEW_SHOT_FIXTURE_IDS: Readonly<
  Record<FieldGenerationOperation, readonly string[]>
> = Object.freeze({
  "context-minimization": CONTEXT_MINIMIZATION_PROMPT_FIXTURE_IDS,
  hint: HINT_PROMPT_FIXTURE_IDS,
  "sense-selection": SENSE_SELECTION_PROMPT_FIXTURE_IDS,
});

export {
  contextMinimizationPromptFixtureSignature,
  contextMinimizationPromptOutputSignature,
  hintPromptFixtureSignature,
  hintPromptOutputSignature,
  promptFixtureSurfaceText,
  promptJMDictEntry,
  promptJMDictProjectionSignature,
  senseSelectionPromptFixtureSignature,
  senseSelectionPromptOutputSignature,
};
export type {
  PromptFixtureLink,
  PromptFixtureUsageSignatureInput,
  PromptJMDictEntry,
  PromptJMDictSense,
};

/** Exercises the production pre-provider validation path for a minimization eval input. */
export function assertContextMinimizationInput(input: ContextMinimizationInput): void {
  contextMinimizationMessages(input);
}

/** Exercises the production pre-provider validation path for a hint eval input. */
export async function assertHintGenerationInput(input: HintGenerationInput): Promise<void> {
  await hintMessages(input);
}

/** Exercises the production pre-provider validation path for a sense-selection eval input. */
export async function assertSenseSelectionInput(input: SenseSelectionInput): Promise<void> {
  await senseSelectionMessages(input);
}
