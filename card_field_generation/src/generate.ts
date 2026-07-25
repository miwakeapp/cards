/** AI generation for card facts not resolved deterministically. */

import type { LanguageModel } from "ai";
import { z } from "zod";
import type { JMDictWord } from "data";
import type { FewShotExample } from "./examples.ts";
import { cardFieldsSystemPrompt, senseAndHintSystemPrompt } from "./prompts.ts";

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

  /** A source-backed reading that the model must not replace. */
  readingFromContext?: string;
}

/** Facts returned by the combined card-field prompt. */
export interface GeneratedCardFields {
  /** Applicable 1-indexed senses, or an empty array when all senses apply. */
  applicableSenses: number[];

  /** The inferred kana reading, omitted when the input supplied `readingFromContext`. */
  reading?: string;

  /** The exact source-context substring corresponding to the recognition target. */
  targetInContext: string;

  /** A minimal Japanese disambiguation phrase, or `null` when no hint is needed. */
  hint: string | null;

  /** Shortened context preserving the usage, or `null` when shortening is not useful. */
  minimizedContext: string | null;

  /** A cleaned source label, or `null` when no useful source was supplied. */
  cleanedSource: string | null;

  /** Whether the supplied source URL appears public and permanent. */
  sourceURLIsPublic: boolean;
}

/** Evidence needed when a caller only needs sense selection and an optional hint. */
export type SenseAndHintGenerationInput = Pick<
  CardFieldGenerationInput,
  "context" | "recognitionTarget" | "jmdictEntry"
>;

/** The sense selection and optional hint projected from the combined card-field task. */
export type GeneratedSenseAndHint = Pick<
  GeneratedCardFields,
  "applicableSenses" | "hint"
>;

/**
 * Supported AI model IDs.
 */
export const MODEL_IDS = [
  "gemini-3.5-flash",
  "claude-opus-4-8",
  "gpt-5.5",
] as const;

/** A supported model identifier for card field generation. */
export type ModelId = (typeof MODEL_IDS)[number];

/** The model used when a caller does not choose one explicitly. */
export const DEFAULT_MODEL_ID: ModelId = "claude-opus-4-8";

const applicableSensesSchema = z
  .array(z.number())
  .describe(
    "1-indexed sense numbers that apply to this usage. Empty array if ALL senses apply.",
  );
const hintSchema = z
  .string()
  .nullable()
  .describe(
    "A minimal Japanese phrase for disambiguation, or null if the word meaning is unambiguous.",
  );

/** Schema fields shared by the full card-field operation. */
const commonAIFieldsSchema = {
  applicableSenses: applicableSensesSchema,
  targetInContext: z
    .string()
    .describe(
      "The exact substring from the context that corresponds to the recognition target. May be a conjugated, nominalized, or otherwise inflected form (e.g. '後ろめたさ' for target '後ろめたい'). Must be a literal substring of the context.",
    ),
  hint: hintSchema,
  minimizedContext: z
    .string()
    .nullable()
    .describe(
      "A shortened version of the context that preserves meaning, or null if no useful shorter version exists.",
    ),
  cleanedSource: z
    .string()
    .nullable()
    .describe("A cleaned-up source name (book title, etc.), or null if not applicable."),
  sourceURLIsPublic: z
    .boolean()
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

function senseAndHintUserPrompt(input: SenseAndHintGenerationInput): string {
  return `Analyze this Japanese word usage and generate flashcard fields.

Recognition target: ${input.recognitionTarget}

Context: ${input.context}

Dictionary entry (JSON):
${JSON.stringify(input.jmdictEntry, undefined, 2)}`;
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
    messages.push({
      role: "user",
      content: formatUserPrompt(example.input),
    });
    const output = actualInput.readingFromContext === undefined
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

function withoutReading(
  fields: GeneratedCardFields,
): Omit<GeneratedCardFields, "reading"> {
  const { reading: _reading, ...fieldsWithoutReading } = fields;
  return fieldsWithoutReading;
}

function senseAndHintOnly(fields: GeneratedCardFields): GeneratedSenseAndHint {
  return {
    applicableSenses: fields.applicableSenses,
    hint: fields.hint,
  };
}

function buildSenseAndHintFewShotMessages(
  actualInput: SenseAndHintGenerationInput,
  examples: readonly FewShotExample[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const example of examples) {
    messages.push({
      role: "user",
      content: senseAndHintUserPrompt(example.input),
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
  const [{ generateText, Output }, { FEW_SHOT_EXAMPLES }] = await Promise.all([
    import("ai"),
    import("./examples.ts"),
  ]);
  const model = await getModel(modelId);
  const needsReading = input.readingFromContext === undefined;

  const result = await generateText({
    model,
    output: Output.object({ schema: aiFieldsSchema(needsReading) }),
    system: cardFieldsSystemPrompt(needsReading),
    messages: buildFewShotMessages(input, FEW_SHOT_EXAMPLES),
  });

  return result.output as GeneratedCardFields;
}

/**
 * Generates only the sense selection and optional hint, using the same prompt wording and
 * projected few-shot examples as the evaluated combined card-field operation.
 */
export async function generateSenseAndHintFields(
  input: SenseAndHintGenerationInput,
  modelId: ModelId,
): Promise<GeneratedSenseAndHint> {
  const [{ generateText, Output }, { FEW_SHOT_EXAMPLES }] = await Promise.all([
    import("ai"),
    import("./examples.ts"),
  ]);
  const result = await generateText({
    model: await getModel(modelId),
    output: Output.object({ schema: senseAndHintSchema }),
    system: senseAndHintSystemPrompt(),
    messages: buildSenseAndHintFewShotMessages(input, FEW_SHOT_EXAMPLES),
  });
  return result.output;
}
