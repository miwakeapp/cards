/**
 * AI provider abstraction using Vercel AI SDK.
 * Supports Anthropic, Google, and OpenAI models.
 */

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import type { AIGeneratedFields, CardCreationInput } from "./types.ts";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { FEW_SHOT_EXAMPLES } from "./few_shot_examples.ts";

/**
 * Supported AI model IDs.
 */
export const MODEL_IDS = [
  "gemini-3-pro-preview",
  "claude-opus-4-5",
  "gpt-5.1",
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

/**
 * Schema for AI-generated card fields.
 */
const aiFieldsSchema = z.object({
  applicableSenses: z
    .array(z.number())
    .describe(
      "1-indexed sense numbers that apply to this usage. Empty array if ALL senses apply.",
    ),
  reading: z
    .string()
    .describe(
      "The correct kana reading for the recognition target in this context. Just the kana, no kanji.",
    ),
  hint: z
    .string()
    .nullable()
    .describe(
      "A minimal Japanese phrase for disambiguation, or null if the word meaning is unambiguous.",
    ),
  minimizedContext: z
    .string()
    .nullable()
    .describe(
      "A shortened version of the context that preserves meaning, or null if already short enough.",
    ),
  cleanedSource: z
    .string()
    .nullable()
    .describe("A cleaned-up source name (book title, etc.), or null if not applicable."),
  sourceURLIsPublic: z
    .boolean()
    .describe("Whether the source URL appears to be publicly accessible and permanent."),
});

/**
 * Gets the appropriate model instance for the given model ID.
 */
function getModel(modelId: ModelId) {
  if (modelId.startsWith("gemini-")) {
    return google(modelId);
  }
  if (modelId.startsWith("claude-")) {
    return anthropic(modelId);
  }
  if (modelId.startsWith("gpt-")) {
    return openai(modelId);
  }
  throw new Error(`Unknown model ID: ${modelId}`);
}

/**
 * The system prompt for card field generation.
 */
const SYSTEM_PROMPT = `You are an expert Japanese language learning assistant helping create Anki flashcards.

Your task is to analyze a Japanese word usage in context and generate appropriate flashcard fields.

## Critical Rules

1. applicableSenses: Return [] (empty array) when:
   - The word has only one sense
   - All senses are essentially the same meaning (e.g., grammatical variants like noun vs adjective)
   - The context genuinely fits all senses equally
   Return specific sense numbers (1-indexed) only when disambiguation is clearly needed.

2. hint ↔ applicableSenses relationship:
   - If applicableSenses is [] → hint MUST be null
   - If applicableSenses is non-empty → hint SHOULD be provided

3. hint format:
   - MUST contain the recognition target exactly as written
   - Should be a minimal Japanese phrase (ideally 3-6 characters + target)
   - Prefer drawing from or adapting the input context
   - Example: "無垢な顔" to distinguish the "innocent" sense from "pure material" or "kimono"

4. minimizedContext:
   - Return null if context is already ≤50 characters
   - If >50 characters, shorten to essential clause containing the target word
   - MUST wrap recognition target in <mark></mark> tags
   - Keep as a complete, natural Japanese sentence

5. reading: The kana reading for this context. Preserve the script (hiragana/katakana) of any kana already in the recognition target. For example, if the target is "ハンダ付け", return "ハンダづけ" (keeping ハンダ as katakana), not "はんだづけ".

6. cleanedSource: Extract book/work title from messy page titles. Remove site names, reader app cruft.

7. sourceURLIsPublic: false for reader apps, temporary URLs, auth-required; true for permanent public URLs.`;


/**
 * Input for AI field generation - CardCreationInput with jmdictId replaced by the full entry.
 */
export type GenerateFieldsInput = Omit<CardCreationInput, "jmdictId"> & {
  jmdictEntry: JMdictWord;
};

/**
 * Formats an input for the user prompt.
 */
function formatUserPrompt(input: GenerateFieldsInput): string {
  return `Analyze this Japanese word usage and generate flashcard fields.

Recognition target: ${input.recognitionTarget}

Context: ${input.context}

Dictionary entry (JSON):
${JSON.stringify(input.jmdictEntry, null, 2)}

Source: ${input.source ?? "(none)"}
Source URL: ${input.sourceURL ?? "(none)"}`;
}

/**
 * Builds the few-shot messages array.
 */
function buildFewShotMessages(
  actualInput: GenerateFieldsInput,
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Add few-shot examples
  for (const example of FEW_SHOT_EXAMPLES) {
    messages.push({
      role: "user",
      content: formatUserPrompt(example.input),
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(example.output),
    });
  }

  // Add the actual input
  messages.push({
    role: "user",
    content: formatUserPrompt(actualInput),
  });

  return messages;
}

/**
 * Generates AI-powered fields for a Miwake card.
 */
export async function generateCardFields(
  input: GenerateFieldsInput,
  modelId: ModelId,
): Promise<AIGeneratedFields> {
  const model = getModel(modelId);

  const result = await generateObject({
    model,
    schema: aiFieldsSchema,
    system: SYSTEM_PROMPT,
    messages: buildFewShotMessages(input),
  });

  return result.object;
}
