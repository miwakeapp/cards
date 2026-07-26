import { assertEquals, assertStringIncludes } from "@std/assert";
import type { JMDictWord } from "data";
import { senseAndHintUserPrompt } from "../src/generate.ts";
import { cardFieldsSystemPrompt, senseAndHintSystemPrompt } from "../src/prompts.ts";

const EXPECTED_SENSE_AND_HINT_PROMPT =
  `You are an expert Japanese language learning assistant helping create Anki flashcards.

Your task is to analyze a Japanese word usage in context and generate appropriate flashcard fields.

## Critical Rules

1. applicableSenses: Select only senses compatible with the supplied spelling and reading restrictions, when such a list is provided.
   Return null when none of the compatible dictionary senses describes the usage in context. This includes text that merely mentions the spelling as a string, title, or name without using a dictionary sense. Metalinguistic context that explains, illustrates, or contrasts the word's meaning is semantic evidence and does count as a usage. Do not force a match merely because the spelling appears. When returning null, return only applicableSenses and hint; the usage cannot produce other card fields.
   Return [] (empty array) when:
   - Only one compatible sense exists
   - All compatible senses are essentially the same meaning (e.g., grammatical variants like noun vs adjective)
   - The context genuinely fits all compatible senses equally
   Return specific sense numbers (1-indexed) only when disambiguation is clearly needed.
   A narrower or specialized sense does not apply merely because the context fails to rule it out. Require positive contextual evidence for that sense's defining condition; otherwise select the ordinary broader sense.

2. hint ↔ applicableSenses relationship:
   - If applicableSenses is null → hint MUST be null
   - If applicableSenses is [] → hint MUST be null
   - If applicableSenses is non-empty → hint MUST be provided and add disambiguating information

3. hint format:
   - MUST contain the recognition target exactly as written
   - Add one short word or compound that clarifies the sense
   - Use compound style without の: 旅行鞄 (not 旅行の鞄)
   - WRONG: 本当に頭が切れる (too many words) → CORRECT: 頭が切れる
   - For verbs/する-nouns, include the verb: 値段が上がる (not 値段が上がり)
   - Add no more than 6 Unicode characters beyond the recognition target's length`;

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

Deno.test("sense selection supplies the chosen reading and compatible senses as evidence", () => {
  const entry = {
    id: "1234567",
    kanji: [],
    kana: [],
    sense: [{}, {}, {}],
  } as unknown as JMDictWord;

  assertEquals(
    senseAndHintUserPrompt({
      context: "その異名を知っている。",
      recognitionTarget: "異名",
      jmdictEntry: entry,
      kanaReading: "いみょう",
      compatibleSenseNumbers: [1, 3],
    }),
    `Analyze this Japanese word usage and generate flashcard fields.

Recognition target: 異名

Selected kana reading: いみょう

Compatible sense numbers after JMDict spelling/reading restrictions: 1, 3

Context: その異名を知っている。

Dictionary entry (JSON):
${JSON.stringify(entry, undefined, 2)}`,
  );
});
