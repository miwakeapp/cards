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
const SYSTEM_PROMPT =
  `You are an expert Japanese language learning assistant helping create Anki flashcards.

Your task is to analyze a Japanese word usage in context and generate appropriate flashcard fields.

Guidelines:
- For "applicableSenses": Identify which dictionary sense(s) match the usage. The senses in the JSON are 0-indexed, but return 1-indexed numbers (so the first sense is 1, not 0). Return empty array ONLY if genuinely all senses apply equally well.
- For "reading": Provide the correct kana reading. If the word has multiple readings, pick the one appropriate for this context.
- For "hint": Provide a hint when disambiguation is needed between senses. If the word has multiple senses but only one applies here, you usually need a hint. If the word only has one sense, you never need a hint. The hint MUST be a minimal Japanese phrase that contains the recognition target exactly as written, showing typical usage of this specific sense. Examples: "魂の番" to pick out the "pair (esp. of mated animals), brace, couple" sense for 番, or "思い出を彷彿とする" to pick out the する-verb "(bearing a) close resemblance, vivid reminder (e.g. of the past)" sense of 彷彿. IMPORTANT: The hint must contain the recognition target. If all senses are applicable, return null.
- For "minimizedContext": Shorten verbose context while preserving the key meaning. Keep it as a complete, natural Japanese sentence. IMPORTANT: Wrap the recognition target in <mark></mark> tags. Return null if the original is already concise (roughly under 50 characters).
- For "cleanedSource": Extract just the work title from messy page titles. Remove site names, navigation cruft, etc. "ソードアート・オンライン2 アインクラッド (電撃文庫) | ッツ Ebook Reader" becomes "ソードアート・オンライン2 アインクラッド".
- For "sourceURLIsPublic": Return false for reader apps (reader.ttsu.app), temporary URLs, or URLs that require authentication. Return true for permanent public URLs like news sites.`;

/**
 * Input for AI field generation - CardCreationInput with jmdictId replaced by the full entry.
 */
export type GenerateFieldsInput = Omit<CardCreationInput, "jmdictId"> & {
  jmdictEntry: JMdictWord;
};

/**
 * Generates AI-powered fields for a Miwake card.
 */
export async function generateCardFields(
  input: GenerateFieldsInput,
  modelId: ModelId,
): Promise<AIGeneratedFields> {
  const model = getModel(modelId);

  const userPrompt = `Analyze this Japanese word usage and generate flashcard fields.

Recognition target (the word being studied): ${input.recognitionTarget}

Context (HTML, the word appears in this text):
${input.context}

Dictionary entry (JSON):
${JSON.stringify(input.jmdictEntry, null, 2)}

Source: ${input.source ?? "(none)"}
Source URL: ${input.sourceURL ?? "(none)"}

Generate the appropriate flashcard fields.`;

  const result = await generateObject({
    model,
    schema: aiFieldsSchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  return result.object;
}
