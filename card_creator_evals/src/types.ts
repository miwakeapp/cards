/**
 * Types used by the eval system - shared between scripts and the viewer.
 */

import type { GeneratedCardFields } from "card_field_generation";

export type { GeneratedCardFields };

/**
 * An eval input - the data we feed to the AI for testing.
 */
export interface EvalInput {
  id: string;
  context: string;
  jmdictId: string;
  recognitionTarget: string;
  source?: string;
  sourceURL?: string;
}

/**
 * A golden (expected) result for an eval input.
 */
export interface EvalGolden {
  inputId: string;
  aiFields: GeneratedCardFields;
}

/**
 * The output from running an eval - the AI's actual response.
 */
export interface EvalOutput {
  inputId: string;
  model: string;
  timestamp: string;
  aiFields: GeneratedCardFields;
}

/**
 * A diff between golden and actual output.
 */
export interface EvalDiff {
  inputId: string;
  field: string;
  golden: unknown;
  current: unknown;
}
