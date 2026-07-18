import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import type { ModelId } from "card_creator/ai";

export const EPUB_CONTEXT_PROMPT_VERSION = 1;
/** Bump when either the selection prompt or its deterministic validation contract changes. */
export const EPUB_RELEVANCE_SELECTION_VERSION = 2;

function getModel(modelId: ModelId): LanguageModel {
  if (modelId.startsWith("gemini-")) return google(modelId);
  if (modelId.startsWith("claude-")) return anthropic(modelId);
  if (modelId.startsWith("gpt-")) return openai(modelId);
  throw new Error(`Unknown model ID: ${modelId}`);
}

export interface ExtractEPUBContextInput {
  windowHTML: string[];
  word: string;
  originalContext: string;
}

/** Selects a source-faithful complete context for Animecards conversion. */
export async function extractFullEPUBContext(
  input: ExtractEPUBContextInput,
  modelId: ModelId,
): Promise<string> {
  const result = await generateText({
    model: getModel(modelId),
    system: `You are extracting context for a Japanese language flashcard.

You will be given several paragraphs from a book. Expand the original excerpt to the appropriate full context for a flashcard about the given word.

Rules:
- The result MUST contain the complete original excerpt verbatim
- Always include a complete sentence (ending with 。 or closing quotation marks or other natural terminal punctuation)
- If the sentence is very short (under ~15 characters) or unclear on its own, include adjacent sentence(s) to clarify
- If the sentence is part of one- or two-sentence dialogue, include the whole dialogue exchange including 「」
- Never return unmatched Japanese quote brackets: if the selected text ends with 」, include the corresponding opening 「
- Do NOT include more context than necessary — usually one sentence is enough
- Copy text from the supplied paragraphs exactly; do not rewrite, correct, or invent anything
- Preserve all HTML tags exactly as they appear (especially <ruby> and <rt>)
- Return ONLY the selected HTML context, with no explanation or wrapping`,
    prompt: `Word: ${input.word}

Original excerpt (must be contained in the result):
${input.originalContext}

Paragraphs:
${input.windowHTML.map((html, index) => `[${index}] ${html}`).join("\n")}`,
  });
  return result.text.trim();
}

export interface SelectRelevantEPUBContextInput {
  restoredContext: string;
  word: string;
  originalContext: string;
}

/** Selects the smallest clear source span from an already-restored context. */
export async function selectRelevantEPUBContext(
  input: SelectRelevantEPUBContextInput,
  modelId: ModelId,
): Promise<string> {
  const result = await generateText({
    model: getModel(modelId),
    system: `You are selecting context for a Japanese language flashcard.

You will receive a source-faithful restored context, the shorter original flashcard excerpt, and the target word. Select the smallest contiguous source span that gives a reader clear context for the target.

Rules:
- The visible text MUST contain the complete original excerpt verbatim
- Include the complete sentence containing the original excerpt
- Include adjacent sentences only when needed to resolve a reference such as これ, それ, or そういう, explain a very short utterance, or otherwise make the target understandable
- Do not include unrelated sentences merely because they belong to the same quoted speech or dialogue
- Quote brackets do NOT need to balance; the caller will explicitly mark omitted dialogue
- Return one contiguous substring of the restored context
- Copy source text and HTML exactly; do not rewrite, correct, paraphrase, or add ellipses
- Preserve all HTML tags exactly as they appear, especially <ruby> and <rt>
- Return ONLY the selected HTML context, with no explanation or wrapping`,
    prompt: `Word: ${input.word}

Original excerpt (its complete visible text must be retained):
${input.originalContext}

Restored context:
${input.restoredContext}`,
  });
  return result.text.trim();
}
