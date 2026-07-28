import { MINIMIZED_CONTEXT_LENGTH_THRESHOLD } from "./minimized_context.ts";

const SYSTEM_PROMPT_PREAMBLE =
  `You are an expert Japanese language learning assistant helping create Anki flashcards.

Your task is to analyze a Japanese word usage in context and generate appropriate flashcard fields.`;

const HINT_FORMAT_RULES = `- MUST contain the recognition target exactly as written
   - Add one short word or compound that clarifies the sense
   - Use compound style without の: 旅行鞄 (not 旅行の鞄)
   - WRONG: 本当に頭が切れる (too many words) → CORRECT: 頭が切れる
   - For verbs/する-nouns, include the verb: 値段が上がる (not 値段が上がり)
   - If the context uses a derived form, restore the exact recognition target: 賢しげに説教 → 賢しい口出し
   - Add no more than 6 Unicode characters beyond the recognition target's length`;

const SENSE_AND_HINT_RULES =
  `1. applicableSenses: Select only senses compatible with the supplied spelling and reading restrictions, when such a list is provided.
   Return null when none of the compatible dictionary senses describes the usage in context. This includes text that merely mentions the spelling as an opaque string or name without using a dictionary sense. A word inside a title or name still counts when that larger expression uses the word's ordinary meaning compositionally, such as 木綿 in 木綿のハンカチーフ. Metalinguistic context that explains, illustrates, or contrasts the word's meaning is semantic evidence and also counts as a usage. Do not force a match merely because the spelling appears. When returning null, return only applicableSenses and hint; the usage cannot produce other card fields.
   Treat dictionary field, register, dialect, usage, and restriction tags as applicability evidence, not optional decoration. A shared English gloss does not make a specialized sense applicable outside its tagged domain; for example, a "pincer" sense tagged for the game of go does not describe an animal's claw.
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
   ${HINT_FORMAT_RULES}`;

const MINIMIZED_CONTEXT_RULES = `minimizedContext:
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
   - Keep balanced 「」 when target is in dialogue; never return unmatched quote brackets`;

const TARGET_IN_CONTEXT_RULES =
  `targetInContext: The exact substring of the context that corresponds to the recognition target.
   - If the target appears literally in the context, return it unchanged: "増幅" → "増幅"
   - If the target is conjugated/inflected, return the inflected form: "後ろめたい" → "後ろめたさ", "浮かぶ" → "浮かんだ"
   - Return ONLY the word itself, not auxiliary verbs or grammatical attachments:
     * "はしゃぐ" in "はしゃいでいる" → "はしゃいで" (not "はしゃいでいる" — いる is a separate element)
     * "噛み締める" in "噛み締められる" → "噛み締められる" (potential is part of the verb)
   - Must be a literal substring of the context`;

/** The evaluated sense-and-hint prompt, also embedded in the combined legacy operation. */
export function senseAndHintSystemPrompt(): string {
  return `${SYSTEM_PROMPT_PREAMBLE}

## Critical Rules

${SENSE_AND_HINT_RULES}`;
}

/** The context-minimization rules shared with the evaluated combined prompt. */
export function minimizedContextSystemPrompt(): string {
  return `${SYSTEM_PROMPT_PREAMBLE}

## Critical Rules

1. ${MINIMIZED_CONTEXT_RULES}`;
}

/** The target-surface rules shared with the evaluated combined prompt. */
export function targetInContextSystemPrompt(): string {
  return `${SYSTEM_PROMPT_PREAMBLE}

## Critical Rules

1. ${TARGET_IN_CONTEXT_RULES}`;
}

/** The prompt for a hint needed only to distinguish same-spelling JMDict entries. */
export function contrastiveHintSystemPrompt(): string {
  return `${SYSTEM_PROMPT_PREAMBLE}

The JMDict entry and senses for this usage have already been selected using deterministic reading evidence and semantic analysis. Generate a hint only when a short Japanese phrase can distinguish the selected meaning from the contrasting same-spelling entries. The hint must add semantic information that would be inapplicable to at least one contrasting entry; merely copying a natural collocation from the context is not enough. Return null when the entries are paraphrases whose only useful distinction is pronunciation, spelling convention, register, or age; do not invent a distinction from pronunciation alone.

## Critical Rules

1. hint format:
   ${HINT_FORMAT_RULES}`;
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
    TARGET_IN_CONTEXT_RULES,
  ].map((rule, index) => `${index + 5}. ${rule}`).join("\n\n");

  return `${senseAndHintSystemPrompt()}

4. ${MINIMIZED_CONTEXT_RULES}

${additionalRules}`;
}
