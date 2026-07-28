import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import type { ModelId } from "card_field_generation";

/** Bump whenever the selection prompt or its deterministic validation contract changes. */
export const EPUB_CONTEXT_PROMPT_VERSION = 8;

function getModel(modelId: ModelId): LanguageModel {
  if (modelId.startsWith("gemini-")) return google(modelId);
  if (modelId.startsWith("claude-")) return anthropic(modelId);
  if (modelId.startsWith("gpt-")) return openai(modelId);
  throw new Error(`Unknown model ID: ${modelId}`);
}

export interface SelectFullEPUBContextInput {
  windowHTML: string[];
  word: string;
  requiredContext: string;
  previousValidationFailure?: string;
}

/** Selects the smallest clear source context that contains a deterministic required span. */
export async function selectFullEPUBContext(
  input: SelectFullEPUBContextInput,
  modelId: ModelId,
): Promise<string> {
  const result = await generateText({
    model: getModel(modelId),
    system: `You are selecting full context for a Japanese language flashcard.

You will be given several paragraphs from a book and a required source span containing the target word. The required span has already been expanded to complete sentence and dialogue boundaries and is presumed to be good flashcard context. Return it unchanged unless a small amount of immediately adjacent text is genuinely necessary to understand the target word's usage in that span.

Rules:
- The result MUST contain the complete required source span verbatim
- If the required span overlaps dialogue enclosed by 「…」 or 『…』, include that complete outer dialogue; it may already be present, and must never be shortened or elided
- "Enough context" means enough to understand how the target word is used, not enough to understand the surrounding story, argument, motivation, or scene
- If the target usage is understandable by itself, return the required span unchanged, even when neighboring text would make the narrative richer or smoother
- Expand only when an omitted referent, subject, cause, contrast, question, speech, action, or other setup makes the target usage itself confusing or materially misleading without it
- A grammatically dependent fragment must include its governing sentence; for example, a fragment ending in 「…何もかもに。」 needs the preceding sentence that supplies the verb
- A sentence describing a reaction may need the immediately preceding cause; do not add a reaction or consequence that merely follows an already-understandable target usage
- Add adjacent sentences or exchange turns one at a time, retaining each only if removing it would make the target usage confusing or materially misleading; normally the result should contain no more than two or three sentences
- Do not include mere attribution, scene mechanics, background, elaboration, or neighboring examples
- When uncertain whether more context is necessary, return the required span unchanged
- Always return naturally bounded context with balanced Japanese quote brackets
- Do not include neighboring text merely to make the result longer
- Copy text from the supplied paragraphs exactly; do not rewrite, correct, or invent anything
- Preserve all HTML tags exactly as they appear (especially <ruby> and <rt>)
- Return ONLY the selected HTML context, with no explanation or wrapping`,
    prompt: `Word: ${input.word}

Required source span (must be included verbatim):
${input.requiredContext}

Source paragraphs:
${input.windowHTML.map((html, index) => `[${index}] ${html}`).join("\n")}${
      input.previousValidationFailure === undefined
        ? ""
        : `\n\nYour previous answer was rejected by deterministic validation:\n${input.previousValidationFailure}\nReturn a different, valid source span.`
    }`,
  });
  return result.text.trim();
}
