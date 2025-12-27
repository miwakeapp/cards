/**
 * Main card creation logic.
 * Takes input and produces a complete MiwakeCard.
 */

import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { formatReadingForAnki, renderEntry } from "jmdict_to_html";
import type { GenerateFieldsInput } from "./ai_provider.ts";
import type { AIGeneratedFields, CardCreationInput, MiwakeCard } from "./types.ts";

/**
 * Options for card creation.
 */
export interface CreateCardOptions {
  /** The input data for the card. */
  input: CardCreationInput;

  /** The JMDict entry for the word. */
  jmdictEntry: JMdictWord;

  /**
   * Function to generate AI fields.
   * Inject this to allow mocking in tests or to select different AI models.
   */
  generateFields: (input: GenerateFieldsInput) => Promise<AIGeneratedFields>;
}

/**
 * Formats the card key from its components.
 * Format: "spelling | jmdictId" or "spelling | jmdictId | sense1,sense2"
 */
function formatKey(
  recognitionTarget: string,
  jmdictId: string,
  applicableSenses: number[],
  totalSenses: number,
): string {
  // Only include senses if not all senses apply
  if (applicableSenses.length === 0 || applicableSenses.length === totalSenses) {
    return `${recognitionTarget} | ${jmdictId}`;
  }
  return `${recognitionTarget} | ${jmdictId} | ${applicableSenses.join(",")}`;
}

/**
 * Converts HTML <ruby> tags to Anki furigana format and wraps target in <mark>.
 * Also extracts furigana from context if present over the target word.
 */
function processContext(
  context: string,
  recognitionTarget: string,
): { processedContext: string; contextReading: string | null } {
  // First, try to find if the recognition target has ruby annotation in context
  // Pattern: <ruby>認識対象<rt>reading</rt></ruby>
  const rubyPattern = new RegExp(
    `<ruby>${RegExp.escape(recognitionTarget)}<rt>([^<]+)</rt></ruby>`,
    "g",
  );
  let contextReading: string | null = null;
  const rubyMatch = rubyPattern.exec(context);
  if (rubyMatch) {
    contextReading = rubyMatch[1];
  }

  // Convert all <ruby>X<rt>Y</rt></ruby> to Anki format X[Y]
  let processed = context.replace(
    /<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>/g,
    " $1[$2]",
  );

  // Wrap the recognition target in <mark> if not already
  if (!processed.includes(`<mark>${recognitionTarget}</mark>`)) {
    // Try to mark the target, handling the case where it might have furigana
    const ankiFuriganaPattern = new RegExp(
      `(\\s?)${RegExp.escape(recognitionTarget)}(\\[[^\\]]+\\])?`,
      "g",
    );
    processed = processed.replace(ankiFuriganaPattern, `$1<mark>${recognitionTarget}$2</mark>`);
  }

  // Clean up any leading space before first character
  processed = processed.replace(/^\s+/, "");

  return { processedContext: processed, contextReading };
}

/**
 * Determines if a recognition target contains any kanji.
 */
function containsKanji(text: string): boolean {
  return /\p{Script=Han}/v.test(text);
}

/**
 * Creates a complete MiwakeCard from the given input.
 */
export async function createCard(options: CreateCardOptions): Promise<MiwakeCard> {
  const { input, jmdictEntry, generateFields } = options;

  // Process the context HTML
  const { processedContext, contextReading } = processContext(
    input.context,
    input.recognitionTarget,
  );

  // Generate AI fields
  const aiFields = await generateFields({
    context: input.context,
    recognitionTarget: input.recognitionTarget,
    jmdictEntry,
    source: input.source,
    sourceURL: input.sourceURL,
  });

  // Post-process hints
  let hint = aiFields.hint;
  // Strip hint if all senses are applicable (no disambiguation needed)
  const allSensesApply = aiFields.applicableSenses.length === 0 ||
    aiFields.applicableSenses.length === jmdictEntry.sense.length;
  if (allSensesApply) {
    hint = null;
  }
  // Strip hint if it doesn't contain the recognition target (invalid hint)
  if (hint !== null && !hint.includes(input.recognitionTarget)) {
    hint = null;
  }

  // Determine the reading to use
  // Priority: context furigana > AI-determined reading
  const readingKana = contextReading ?? aiFields.reading;

  // Format reading with precise furigana placement
  let reading: string | null = null;
  if (containsKanji(input.recognitionTarget)) {
    reading = formatReadingForAnki(jmdictEntry.id, input.recognitionTarget, readingKana);
    // Fallback if formatReadingForAnki returns null (not in furigana database)
    if (reading === null) {
      // Simple fallback: just append reading in brackets
      reading = `${input.recognitionTarget}[${readingKana}]`;
    }
  }

  // Generate dictionary entry HTML
  const dictionaryEntry = renderEntry(jmdictEntry);

  // Build the key
  const key = formatKey(
    input.recognitionTarget,
    input.jmdictId,
    aiFields.applicableSenses,
    jmdictEntry.sense.length,
  );

  // Determine source and URL
  const source = aiFields.cleanedSource ?? input.source ?? null;
  const sourceURL = aiFields.sourceURLIsPublic ? (input.sourceURL ?? null) : null;

  return {
    key,
    recognitionTarget: input.recognitionTarget,
    reading,
    hint,
    fullContext: processedContext,
    minimizedContext: aiFields.minimizedContext,
    dictionaryEntry,
    source,
    sourceURL,
  };
}
