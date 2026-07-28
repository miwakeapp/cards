import { assertEquals, assertStringIncludes } from "@std/assert";
import type { JMDictWord } from "data";
import { senseAndHintUserPrompt } from "../src/generate.ts";
import { cardFieldsSystemPrompt, senseAndHintSystemPrompt } from "../src/prompts.ts";

Deno.test("full generation extends the same evaluated sense-and-hint prompt", () => {
  const prompt = cardFieldsSystemPrompt(false);

  assertStringIncludes(prompt, `${senseAndHintSystemPrompt()}\n\n4. minimizedContext:`);
  assertStringIncludes(prompt, "5. cleanedSource:");
  assertStringIncludes(prompt, "6. sourceURLIsPublic:");
  assertStringIncludes(prompt, "7. targetInContext:");
});

Deno.test("full generation adds reading without renumbering the shared rules", () => {
  const prompt = cardFieldsSystemPrompt(true);

  assertStringIncludes(prompt, `${senseAndHintSystemPrompt()}\n\n4. minimizedContext:`);
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
