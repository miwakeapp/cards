/** AI generation for card facts not resolved deterministically. */

import type { LanguageModel } from "ai";
import { z } from "zod";
import type { JMDictWord } from "data";
import type { FewShotExample } from "./examples.ts";
import { cardFieldsSystemPrompt, senseAndHintSystemPrompt } from "./prompts.ts";

// Keep these imports lazy so metadata-only consumers do not load the AI SDK or JMDict fixtures,
// while ensuring concurrent first calls share one import operation.
let generationDependenciesPromise:
  | Promise<[
    typeof import("ai"),
    typeof import("./examples.ts"),
  ]>
  | undefined;

function generationDependencies() {
  generationDependenciesPromise ??= Promise.all([
    import("ai"),
    import("./examples.ts"),
  ]);
  return generationDependenciesPromise;
}

/** Evidence supplied to the combined card-field prompt. */
export interface CardFieldGenerationInput {
  /** Japanese source context containing the targeted usage. */
  context: string;

  /** The JMDict spelling being learned, as presented to the prompt. */
  recognitionTarget: string;

  /** The JMDict entry against which readings and senses are resolved. */
  jmdictEntry: JMDictWord;

  /** An optional unprocessed source label for the prompt to clean. */
  source?: string;

  /** An optional source URL for the prompt to classify as public and permanent or not. */
  sourceURL?: string;

  /**
   * An exact JMDict kana form already selected for this usage.
   *
   * When supplied, the model does not infer another reading. Callers should normally also supply
   * `compatibleSenseNumbers`, after applying JMDict's spelling and reading restrictions.
   */
  kanaReading?: string;

  /** The 1-indexed senses left after deterministic JMDict spelling and reading restrictions. */
  compatibleSenseNumbers?: readonly number[];
}

/** The model found no compatible dictionary sense describing the usage. */
export interface NoApplicableSense {
  /** `null` indicates that the selected JMDict entry does not describe the usage. */
  applicableSenses: null;

  /** No hint can be generated for a usage outside the selected JMDict entry. */
  hint: null;
}

/** Every compatible dictionary sense describes the usage. */
export interface AllCompatibleSenses {
  /** The canonical representation meaning that every compatible sense applies. */
  applicableSenses: [];

  /** No hint is needed when the card does not select a proper subset of compatible senses. */
  hint: null;
}

/** A proper subset of compatible dictionary senses describes the usage. */
export interface SelectedApplicableSenses {
  /** The selected 1-indexed sense numbers, sorted in ascending order. */
  applicableSenses: [number, ...number[]];

  /** A short Japanese phrase containing the recognition target and clarifying the selected sense. */
  hint: string;
}

/** A validated sense selection and its optional disambiguating hint. */
export type GeneratedSenseAndHint =
  | NoApplicableSense
  | AllCompatibleSenses
  | SelectedApplicableSenses;

/** Card fields returned when at least one compatible dictionary sense applies. */
export interface GeneratedApplicableCardFields {
  /**
   * The inferred kana reading, omitted when the input supplied `kanaReading`.
   */
  reading?: string;

  /** The exact source-context substring corresponding to the recognition target. */
  targetInContext: string;

  /** Shortened context preserving the usage, or `null` when shortening is not useful. */
  minimizedContext: string | null;

  /** A cleaned source label, or `null` when no useful source was supplied. */
  cleanedSource: string | null;

  /** Whether the supplied source URL appears public and permanent. */
  sourceURLIsPublic: boolean;
}

/**
 * Facts returned by the combined card-field prompt.
 *
 * A no-match result is terminal and deliberately contains no other generated fields. Callers must
 * select a different JMDict entry or defer the usage rather than consuming speculative card data.
 */
export type GeneratedCardFields =
  | (NoApplicableSense & {
    reading?: never;
    targetInContext?: never;
    minimizedContext?: never;
    cleanedSource?: never;
    sourceURLIsPublic?: never;
  })
  | ((AllCompatibleSenses | SelectedApplicableSenses) & GeneratedApplicableCardFields);

/** Evidence needed when a caller only needs sense selection and an optional hint. */
export interface SenseAndHintGenerationInput {
  /** Japanese source context containing the targeted usage. */
  context: string;

  /** The exact JMDict spelling being learned. */
  recognitionTarget: string;

  /** The JMDict entry whose compatible senses are being considered. */
  jmdictEntry: JMDictWord;

  /** The exact JMDict kana form selected for this usage. */
  kanaReading: string;

  /** The nonempty 1-indexed senses allowed by the selected JMDict spelling and reading. */
  compatibleSenseNumbers: readonly number[];
}

type SenseAndHintPromptInput = Pick<
  CardFieldGenerationInput,
  "context" | "recognitionTarget" | "jmdictEntry" | "kanaReading" | "compatibleSenseNumbers"
>;

/**
 * Supported AI model IDs.
 */
export const MODEL_IDS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "claude-opus-5",
  "claude-opus-4-8",
  "gpt-5.6",
  "gpt-5.5",
] as const;

/** A supported model identifier for card field generation. */
export type ModelId = (typeof MODEL_IDS)[number];

/** The model used when a caller does not choose one explicitly. */
export const DEFAULT_MODEL_ID: ModelId = "claude-opus-4-8";

/**
 * Identifies the prompts, few-shot examples, and output contract used by this package.
 *
 * Persistent caches of generated fields must include this value in their cache key. Increment it
 * whenever a change could affect model output or the interpretation of cached output.
 */
export const CARD_FIELD_GENERATION_CACHE_VERSION = 1;

const applicableSensesSchema = z
  .array(z.number().int().positive())
  .nullable()
  .describe(
    "1-indexed compatible sense numbers that apply to this usage. Null if none apply; empty array if all apply.",
  );
const hintSchema = z
  .string()
  .nullable()
  .describe(
    "A minimal Japanese phrase for disambiguation when applicableSenses is a non-empty array; otherwise null.",
  );

/**
 * Raw model fields are optional because a no-match result needs only `applicableSenses` and
 * `hint`. Successful results are checked and narrowed before crossing the package boundary.
 */
const commonAIFieldsSchema = {
  applicableSenses: applicableSensesSchema,
  targetInContext: z
    .string()
    .optional()
    .describe(
      "The exact substring from the context that corresponds to the recognition target. May be a conjugated, nominalized, or otherwise inflected form (e.g. '後ろめたさ' for target '後ろめたい'). Must be a literal substring of the context.",
    ),
  hint: hintSchema,
  minimizedContext: z
    .string()
    .nullable()
    .optional()
    .describe(
      "A shortened version of the context that preserves meaning, or null if no useful shorter version exists.",
    ),
  cleanedSource: z
    .string()
    .nullable()
    .optional()
    .describe("A cleaned-up source name (book title, etc.), or null if not applicable."),
  sourceURLIsPublic: z
    .boolean()
    .optional()
    .describe("Whether the source URL appears to be publicly accessible and permanent."),
};

const senseAndHintSchema = z.object({
  applicableSenses: applicableSensesSchema,
  hint: hintSchema,
});

function aiFieldsSchema(needsReading: boolean) {
  return z.object({
    ...commonAIFieldsSchema,
    ...(needsReading
      ? {
        reading: z
          .string()
          .optional()
          .describe(
            "The correct kana reading for the recognition target in this context. Just the kana, no kanji.",
          ),
      }
      : {}),
  });
}

/**
 * Gets the appropriate model instance for the given model ID.
 */
async function getModel(modelId: ModelId): Promise<LanguageModel> {
  if (modelId.startsWith("gemini-")) {
    const { google } = await import("@ai-sdk/google");
    return google(modelId);
  }
  if (modelId.startsWith("claude-")) {
    const { anthropic } = await import("@ai-sdk/anthropic");
    return anthropic(modelId);
  }
  if (modelId.startsWith("gpt-")) {
    const { openai } = await import("@ai-sdk/openai");
    return openai(modelId);
  }
  throw new Error(`Unknown model ID: ${modelId}`);
}

function compatibleSenseNumbersForInput(
  input: Pick<CardFieldGenerationInput, "compatibleSenseNumbers" | "jmdictEntry">,
): number[] {
  const values = input.compatibleSenseNumbers ??
    input.jmdictEntry.sense.map((_, index) => index + 1);
  if (
    values.length === 0 ||
    values.some((value) =>
      !Number.isSafeInteger(value) || value < 1 || value > input.jmdictEntry.sense.length
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new RangeError(
      `compatibleSenseNumbers must contain one or more unique integers between 1 and ${input.jmdictEntry.sense.length}, inclusive, for JMDict entry ${
        JSON.stringify(input.jmdictEntry.id)
      }; received ${JSON.stringify(values)}`,
    );
  }
  return [...values].sort((left, right) => left - right);
}

export function senseAndHintUserPrompt(input: SenseAndHintPromptInput): string {
  const compatibleSenseNumbers = compatibleSenseNumbersForInput(input);
  const evidence = [
    `Recognition target: ${input.recognitionTarget}`,
    ...(input.kanaReading === undefined ? [] : [`Selected kana reading: ${input.kanaReading}`]),
    ...(input.compatibleSenseNumbers === undefined ? [] : [
      `Compatible sense numbers after JMDict spelling/reading restrictions: ${
        compatibleSenseNumbers.join(", ")
      }`,
    ]),
    `Context: ${input.context}`,
  ].join("\n\n");
  return `Analyze this Japanese word usage and generate flashcard fields.

${evidence}

Dictionary entry (JSON):
${JSON.stringify(input.jmdictEntry, undefined, 2)}`;
}

interface RawGeneratedSenseAndHint {
  applicableSenses: number[] | null;
  hint: string | null;
}

interface RawGeneratedCardFields extends RawGeneratedSenseAndHint {
  reading?: string;
  targetInContext?: string;
  minimizedContext?: string | null;
  cleanedSource?: string | null;
  sourceURLIsPublic?: boolean;
}

const MAX_HINT_ADDITIONAL_CHARACTERS = 6;

/**
 * Validates and canonicalizes the semantic relationship between a generated sense selection and
 * hint. Exported from this internal module for focused tests; it is not part of the package API.
 */
export function validateGeneratedSenseAndHint(
  input: SenseAndHintPromptInput,
  fields: RawGeneratedSenseAndHint,
): GeneratedSenseAndHint {
  const compatibleSenseNumbers = compatibleSenseNumbersForInput(input);
  if (fields.applicableSenses === null) {
    if (fields.hint !== null) {
      throw new Error(
        `AI returned no applicable sense for recognitionTarget ${
          JSON.stringify(input.recognitionTarget)
        }, but also returned hint ${JSON.stringify(fields.hint)}`,
      );
    }
    return { applicableSenses: null, hint: null };
  }

  const values = fields.applicableSenses;
  if (
    values.some((value) =>
      !Number.isSafeInteger(value) || !compatibleSenseNumbers.includes(value)
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      `AI returned applicableSenses ${JSON.stringify(values)} for recognitionTarget ${
        JSON.stringify(input.recognitionTarget)
      }; expected unique integers from compatibleSenseNumbers ${
        JSON.stringify(compatibleSenseNumbers)
      }`,
    );
  }
  const sorted = [...values].sort((left, right) => left - right);
  const allCompatible = sorted.length === 0 ||
    (
      sorted.length === compatibleSenseNumbers.length &&
      sorted.every((value, index) => value === compatibleSenseNumbers[index])
    );
  if (allCompatible) {
    if (fields.hint !== null) {
      throw new Error(
        `AI selected every compatible sense for recognitionTarget ${
          JSON.stringify(input.recognitionTarget)
        }, but also returned hint ${JSON.stringify(fields.hint)}`,
      );
    }
    return { applicableSenses: [], hint: null };
  }

  const hint = fields.hint;
  if (hint === null) {
    throw new Error(
      `AI selected applicableSenses ${JSON.stringify(sorted)} for recognitionTarget ${
        JSON.stringify(input.recognitionTarget)
      }, but returned no disambiguating hint`,
    );
  }
  if (!hint.includes(input.recognitionTarget)) {
    throw new Error(
      `AI hint ${JSON.stringify(hint)} does not contain recognitionTarget ${
        JSON.stringify(input.recognitionTarget)
      } exactly`,
    );
  }
  if (hint === input.recognitionTarget) {
    throw new Error(
      `AI hint ${JSON.stringify(hint)} repeats recognitionTarget without disambiguating it`,
    );
  }
  const hintLength = [...hint].length;
  const targetLength = [...input.recognitionTarget].length;
  if (hintLength > targetLength + MAX_HINT_ADDITIONAL_CHARACTERS) {
    throw new Error(
      `AI hint ${JSON.stringify(hint)} is ${hintLength - targetLength} characters longer than ` +
        `recognitionTarget ${JSON.stringify(input.recognitionTarget)}; at most ` +
        `${MAX_HINT_ADDITIONAL_CHARACTERS} additional characters are allowed`,
    );
  }
  return {
    applicableSenses: sorted as [number, ...number[]],
    hint,
  };
}

/** Formats a full card-field input for the user prompt. */
function formatUserPrompt(input: CardFieldGenerationInput): string {
  return `${senseAndHintUserPrompt(input)}

Source: ${input.source ?? "(none)"}
Source URL: ${input.sourceURL ?? "(none)"}`;
}

/**
 * Builds the few-shot messages array.
 */
function buildFewShotMessages(
  actualInput: CardFieldGenerationInput,
  examples: readonly FewShotExample[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Add few-shot examples
  for (const example of examples) {
    const input = projectExampleInput(example, actualInput);
    messages.push({
      role: "user",
      content: formatUserPrompt(input),
    });
    const output = actualInput.kanaReading === undefined
      ? example.output
      : withoutReading(example.output);
    messages.push({
      role: "assistant",
      content: JSON.stringify(output),
    });
  }

  // Add the actual input
  messages.push({
    role: "user",
    content: formatUserPrompt(actualInput),
  });

  return messages;
}

function projectExampleInput(
  example: FewShotExample,
  actualInput: CardFieldGenerationInput,
): CardFieldGenerationInput {
  return {
    ...example.input,
    ...(actualInput.kanaReading === undefined
      ? {}
      : { kanaReading: example.senseConstraints.kanaReading }),
    ...(actualInput.compatibleSenseNumbers === undefined
      ? {}
      : { compatibleSenseNumbers: example.senseConstraints.compatibleSenseNumbers }),
  };
}

function withoutReading(
  fields: GeneratedCardFields,
): Omit<GeneratedCardFields, "reading"> {
  const { reading: _reading, ...fieldsWithoutReading } = fields;
  return fieldsWithoutReading;
}

function senseAndHintOnly(fields: GeneratedCardFields): GeneratedSenseAndHint {
  if (fields.applicableSenses === null) {
    return { applicableSenses: null, hint: null };
  }
  if (fields.applicableSenses.length === 0) {
    return { applicableSenses: [], hint: null };
  }
  return {
    applicableSenses: fields.applicableSenses as [number, ...number[]],
    hint: fields.hint as string,
  };
}

export function buildSenseAndHintFewShotMessages(
  actualInput: SenseAndHintGenerationInput,
  examples: readonly FewShotExample[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const example of examples) {
    const input: SenseAndHintGenerationInput = {
      context: example.input.context,
      recognitionTarget: example.input.recognitionTarget,
      jmdictEntry: example.input.jmdictEntry,
      ...example.senseConstraints,
    };
    messages.push({
      role: "user",
      content: senseAndHintUserPrompt(input),
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(senseAndHintOnly(example.output)),
    });
  }
  messages.push({
    role: "user",
    content: senseAndHintUserPrompt(actualInput),
  });
  return messages;
}

/**
 * Generates AI-powered fields for a Miwake card.
 */
export async function generateCardFields(
  input: CardFieldGenerationInput,
  modelId: ModelId,
): Promise<GeneratedCardFields> {
  const [{ generateText, Output }, { FEW_SHOT_EXAMPLES }] = await generationDependencies();
  const model = await getModel(modelId);
  const needsReading = input.kanaReading === undefined;

  const result = await generateText({
    model,
    output: Output.object({ schema: aiFieldsSchema(needsReading) }),
    system: cardFieldsSystemPrompt(needsReading),
    messages: buildFewShotMessages(input, FEW_SHOT_EXAMPLES),
  });

  const fields = result.output as RawGeneratedCardFields;
  const senseAndHint = validateGeneratedSenseAndHint(
    input,
    fields,
  );
  if (senseAndHint.applicableSenses === null) return senseAndHint;
  if (
    fields.targetInContext === undefined ||
    fields.minimizedContext === undefined ||
    fields.cleanedSource === undefined ||
    fields.sourceURLIsPublic === undefined ||
    (needsReading && fields.reading === undefined)
  ) {
    throw new Error(
      `AI omitted required card fields for recognitionTarget ${
        JSON.stringify(input.recognitionTarget)
      }`,
    );
  }
  if (
    fields.targetInContext.length === 0 ||
    !input.context.includes(fields.targetInContext)
  ) {
    throw new Error(
      `AI targetInContext ${JSON.stringify(fields.targetInContext)} is not a nonempty literal ` +
        `substring of the supplied context`,
    );
  }
  return {
    ...senseAndHint,
    ...(needsReading ? { reading: fields.reading } : {}),
    targetInContext: fields.targetInContext,
    minimizedContext: fields.minimizedContext,
    cleanedSource: fields.cleanedSource,
    sourceURLIsPublic: fields.sourceURLIsPublic,
  };
}

/**
 * Generates only the sense selection and optional hint, using the same prompt wording and
 * projected few-shot examples as the evaluated combined card-field operation.
 */
export async function generateSenseAndHintFields(
  input: SenseAndHintGenerationInput,
  modelId: ModelId,
): Promise<GeneratedSenseAndHint> {
  const [{ generateText, Output }, { FEW_SHOT_EXAMPLES }] = await generationDependencies();
  const result = await generateText({
    model: await getModel(modelId),
    output: Output.object({ schema: senseAndHintSchema }),
    system: senseAndHintSystemPrompt(),
    messages: buildSenseAndHintFewShotMessages(input, FEW_SHOT_EXAMPLES),
  });
  return validateGeneratedSenseAndHint(input, result.output);
}
