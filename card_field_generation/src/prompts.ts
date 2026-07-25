import { MINIMIZED_CONTEXT_LENGTH_THRESHOLD } from "./minimized_context.ts";

const SYSTEM_PROMPT_PREAMBLE =
  `You are an expert Japanese language learning assistant helping create Anki flashcards.

Your task is to analyze a Japanese word usage in context and generate appropriate flashcard fields.`;

const SENSE_AND_HINT_RULES = `1. applicableSenses: Return [] (empty array) when:
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

/** The evaluated prompt prefix shared by both generation operations. */
export function senseAndHintSystemPrompt(): string {
  return `${SYSTEM_PROMPT_PREAMBLE}

## Critical Rules

${SENSE_AND_HINT_RULES}`;
}

/** The evaluated combined card-field prompt. */
export function cardFieldsSystemPrompt(needsReading: boolean): string {
  const additionalRules = [
    ...(needsReading
      ? [
        `reading: The kana reading for this context. Preserve the script (hiragana/katakana) of any kana already in the recognition target. For example, if the target is "ハンダ付け", return "ハンダづけ" (keeping ハンダ as katakana), not "はんだづけ".`,
      ]
      : []),
    "cleanedSource: Extract book/work title from messy page titles. Remove site names, reader app cruft.",
    "sourceURLIsPublic: false for reader apps, temporary URLs, auth-required; true for permanent public URLs.",
    `targetInContext: The exact substring of the context that corresponds to the recognition target.
   - If the target appears literally in the context, return it unchanged: "増幅" → "増幅"
   - If the target is conjugated/inflected, return the inflected form: "後ろめたい" → "後ろめたさ", "浮かぶ" → "浮かんだ"
   - Return ONLY the word itself, not auxiliary verbs or grammatical attachments:
     * "はしゃぐ" in "はしゃいでいる" → "はしゃいで" (not "はしゃいでいる" — いる is a separate element)
     * "噛み締める" in "噛み締められる" → "噛み締められる" (potential is part of the verb)
   - Must be a literal substring of the context`,
  ].map((rule, index) => `${index + 5}. ${rule}`).join("\n\n");

  return `${senseAndHintSystemPrompt()}

4. minimizedContext:
   - If >${MINIMIZED_CONTEXT_LENGTH_THRESHOLD} characters, create a SHORT, self-contained sentence
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

${additionalRules}`;
}
