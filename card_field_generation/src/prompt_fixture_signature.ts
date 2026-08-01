/** A prompt example's selected JMDict usage, reduced to eval-stable identity. */
export interface PromptFixtureUsageSignatureInput {
  /** Stable JMDict sequence identifier. */
  jmdictId: string;
  /** Nonempty 1-indexed senses represented by the usage. */
  senseNumbers: readonly number[];
}

/** Builds the semantic input signature used to link a context-minimization few-shot to an eval. */
export function contextMinimizationPromptFixtureSignature(fullText: string): string {
  return semanticSignature({ fullText: promptFixtureSurfaceText(fullText) });
}

/** Builds the output signature used to link a minimization few-shot to accepted eval output. */
export function contextMinimizationPromptOutputSignature(
  minimizedText: string | null,
): string {
  return semanticSignature({ minimizedText });
}

/** Builds the semantic input signature used to link a hint few-shot to an eval. */
export function hintPromptFixtureSignature(input: {
  recognitionTarget: string;
  context: string;
  selectedUsage: PromptFixtureUsageSignatureInput;
}): string {
  return semanticSignature({ ...input, context: promptFixtureSurfaceText(input.context) });
}

/** Builds the output signature used to link a hint few-shot to accepted eval output. */
export function hintPromptOutputSignature(output: {
  disposition: "generated" | "not-needed" | "source-insufficient";
  hint?: string;
}): string {
  return semanticSignature(output);
}

/** Builds the semantic input signature used to link a sense-selection few-shot to an eval. */
export function senseSelectionPromptFixtureSignature(input: {
  recognitionTarget: string;
  context: string;
  jmdictId: string;
  compatibleSenseNumbers: readonly number[];
}): string {
  return semanticSignature({ ...input, context: promptFixtureSurfaceText(input.context) });
}

/** Builds the output signature used to link a sense-selection few-shot to its eval outcome. */
export function senseSelectionPromptOutputSignature(outcome: unknown): string {
  return semanticSignature(outcome);
}

/** Builds a change-detection signature for the complete JMDict projection sent to a model. */
export function promptJMDictProjectionSignature(entry: unknown): string {
  return semanticSignature(entry);
}

// Furigana is useful provider context but not part of the semantic identity linking a prompt
// example to its source fixture. Prompt examples may omit it for readability.
/** Removes presentation-only Anki furigana while preserving target sentinels and source text. */
export function promptFixtureSurfaceText(text: string): string {
  return text
    .replaceAll(/ (?=[^\s\[\]]+\[[^\[\]]+\])/gu, "")
    .replaceAll(/\[[^\[\]]+\]/gu, "");
}

// This is a compact change detector rather than a security boundary. Including the serialized
// length alongside FNV-1a makes accidental fixture relabeling conspicuous without exposing prompt
// source text through the narrow eval-metadata subpath.
function semanticSignature(value: unknown): string {
  const json = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; ++index) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${json.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** An eval fixture and the semantic prompt input derived from it. */
export interface PromptFixtureLink {
  /** Eval fixture from which the production few-shot was derived. */
  fixtureId: string;
  /** Compact signature of the operation-specific semantic prompt input. */
  inputSignature: string;
  /** UTF-16 length of the normalized prompt context used to locate its source excerpt. */
  contextLength: number;
  /** Compact signature of the operation-specific few-shot result. */
  outputSignature: string;
  /** Selected JMDict evidence actually included in a hint or sense-selection prompt. */
  selectedJMDictProjection?: PromptJMDictEntry;
  /** Change-detection signature of {@link selectedJMDictProjection}. */
  selectedJMDictProjectionSignature?: string;
  /** Contrasting JMDict evidence actually included in a hint prompt. */
  contrastingJMDictProjections?: readonly PromptJMDictEntry[];
  /** Change-detection signatures corresponding to {@link contrastingJMDictProjections}. */
  contrastingJMDictProjectionSignatures?: readonly string[];
}
import type { PromptJMDictEntry } from "./jmdict_prompt.ts";
