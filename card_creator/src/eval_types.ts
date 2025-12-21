/**
 * Types used by the eval system - shared between run_evals.ts and the evals viewer.
 */

import type { AIGeneratedFields } from "./types.ts";

export type { AIGeneratedFields };

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
  aiFields: AIGeneratedFields;
}

/**
 * The output from running an eval - the AI's actual response.
 */
export interface EvalOutput {
  inputId: string;
  model: string;
  timestamp: string;
  aiFields: AIGeneratedFields;
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

/**
 * The model IDs we support for evals.
 */
export const EVAL_MODEL_IDS = [
  "claude-opus-4-5",
  "gemini-3-pro-preview",
  "gpt-5.1",
] as const;

export type EvalModelId = typeof EVAL_MODEL_IDS[number];
