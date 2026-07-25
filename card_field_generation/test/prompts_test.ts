import { assertEquals, assertStringIncludes } from "@std/assert";
import { cardFieldsSystemPrompt, senseAndHintSystemPrompt } from "../src/prompts.ts";

const EXPECTED_SENSE_AND_HINT_PROMPT =
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
   - Maximum: 8 characters total`;

Deno.test("sense-and-hint generation preserves the evaluated prompt wording", () => {
  assertEquals(senseAndHintSystemPrompt(), EXPECTED_SENSE_AND_HINT_PROMPT);
});

Deno.test("full generation extends the same evaluated sense-and-hint prompt", () => {
  const prompt = cardFieldsSystemPrompt(false);

  assertStringIncludes(prompt, `${EXPECTED_SENSE_AND_HINT_PROMPT}\n\n4. minimizedContext:`);
  assertStringIncludes(prompt, "5. cleanedSource:");
  assertStringIncludes(prompt, "6. sourceURLIsPublic:");
  assertStringIncludes(prompt, "7. targetInContext:");
});

Deno.test("full generation adds reading without renumbering the shared rules", () => {
  const prompt = cardFieldsSystemPrompt(true);

  assertStringIncludes(prompt, `${EXPECTED_SENSE_AND_HINT_PROMPT}\n\n4. minimizedContext:`);
  assertStringIncludes(prompt, "5. reading:");
  assertStringIncludes(prompt, "6. cleanedSource:");
  assertStringIncludes(prompt, "7. sourceURLIsPublic:");
  assertStringIncludes(prompt, "8. targetInContext:");
});
