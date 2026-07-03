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
  "gemini-3.1-pro-preview",
  "claude-opus-4-6",
  "gpt-5.2",
] as const;

export type ModelId = (typeof MODEL_IDS)[number];

export const DEFAULT_MODEL_ID: ModelId = "claude-opus-4-6";

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
  targetInContext: z
    .string()
    .describe(
      "The exact substring from the context that corresponds to the recognition target. May be a conjugated, nominalized, or otherwise inflected form (e.g. '後ろめたさ' for target '後ろめたい'). Must be a literal substring of the context.",
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
export function getModel(modelId: ModelId) {
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
   - Add EXACTLY 1 word (or compound) that clarifies the sense
   - Use compound style without の: 旅行鞄 (not 旅行の鞄)
   - WRONG: 本当に頭が切れる (too many words) → CORRECT: 頭が切れる
   - For verbs/する-nouns, include the verb: 値段が上がる (not 値段が上がり)
   - Maximum: 8 characters total

4. minimizedContext:
   - Return null if context is already ≤50 characters
   - If >50 characters, create a SHORT, self-contained sentence
   - Return null if the result would be substantially the same as the full context
   - Return null if the only difference would be removing furigana, ruby, or other markup
   - CUT trailing clauses after the core point:
     * "〜だったのに、結局うまくいかなかった" → "〜だった。"
     * "〜になってきて、最近は..." → "〜になった。"
   - RESTRUCTURE lists to isolate the target item:
     * "条件は、Xすること、Yすることの二つだ" → "条件はYすることだ。"
   - Keep LEADING context when it establishes the situation:
     * "疲れが溜まって、体調を崩した" (keep 疲れが溜まって - it explains why)
     * "努力が実って、合格できた" (keep both - they're connected)
   - Change conjugations to end naturally: "していて" → "していた"
   - MUST wrap recognition target in <mark></mark> tags
   - Keep balanced 「」 when target is in dialogue; never return unmatched quote brackets

5. reading: The kana reading for this context. Preserve the script (hiragana/katakana) of any kana already in the recognition target. For example, if the target is "ハンダ付け", return "ハンダづけ" (keeping ハンダ as katakana), not "はんだづけ".

6. cleanedSource: Extract book/work title from messy page titles. Remove site names, reader app cruft.

7. sourceURLIsPublic: false for reader apps, temporary URLs, auth-required; true for permanent public URLs.

8. targetInContext: The exact substring of the context that corresponds to the recognition target.
   - If the target appears literally in the context, return it unchanged: "増幅" → "増幅"
   - If the target is conjugated/inflected, return the inflected form: "後ろめたい" → "後ろめたさ", "浮かぶ" → "浮かんだ"
   - Return ONLY the word itself, not auxiliary verbs or grammatical attachments:
     * "はしゃぐ" in "はしゃいでいる" → "はしゃいで" (not "はしゃいでいる" — いる is a separate element)
     * "噛み締める" in "噛み締められる" → "噛み締められる" (potential is part of the verb)
   - Must be a literal substring of the context`;

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
