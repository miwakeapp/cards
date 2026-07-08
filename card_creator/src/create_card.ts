/**
 * Main card creation logic.
 * Takes input and produces a complete MiwakeCard.
 */

import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { formatReadingForAnki, renderEntry } from "jmdict_to_html";
import type { GenerateFieldsInput } from "./ai_provider.ts";
import { formatMiwakeKey } from "./keys.ts";
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
 * Converts HTML <ruby> tags to Anki furigana format and wraps target in <mark>.
 * Also extracts furigana from context if present over the target word.
 *
 * Handles both single-reading ruby (`<ruby>瓦解<rt>がかい</rt></ruby>`)
 * and per-kanji ruby (`<ruby>瓦<rt>が</rt>解<rt>かい</rt></ruby>`).
 */
function processContext(
  context: string,
  recognitionTarget: string,
  targetInContext: string,
): { processedContext: string; contextReading: string | null } {
  let contextReading: string | null = null;

  // Extract reading for recognition target from ruby annotations.
  const rubyTagPattern = /<ruby>((?:[^<]+<rt>[^<]+<\/rt>)+)<\/ruby>/g;
  for (const match of context.matchAll(rubyTagPattern)) {
    const inner = match[1];
    const baseText = inner.replace(/<rt>[^<]+<\/rt>/g, "");
    if (baseText === recognitionTarget) {
      contextReading = [...inner.matchAll(/<rt>([^<]+)<\/rt>/g)]
        .map((m) => m[1])
        .join("");
      break;
    }
  }

  // Convert all <ruby> tags to Anki bracket format: " X[Y]"
  let processed = context.replace(
    rubyTagPattern,
    (_match, inner: string) => inner.replace(/([^<]+)<rt>([^<]+)<\/rt>/g, " $1[$2]"),
  );

  // Wrap target in <mark>. Use a furigana-aware pattern that matches the target
  // even when bracket annotations are interspersed (e.g. "瓦解" → " 瓦[が] 解[かい]").
  const markTarget = processed.includes(targetInContext) ? targetInContext : recognitionTarget;

  if (!processed.includes("<mark>")) {
    const chars = [...markTarget];
    const furiganaAwarePattern = chars
      .map((c) => `${RegExp.escape(c)}(?:\\[[^\\]]+\\])?`)
      .join("\\s?");
    const pattern = new RegExp(`(\\s?)(${furiganaAwarePattern})`, "g");
    processed = processed.replace(pattern, "<mark>$2</mark>");
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

function normalizeKanaScript(text: string): string {
  return [...text].map((char) => {
    const codePoint = char.codePointAt(0)!;
    if (codePoint >= 0x30A1 && codePoint <= 0x30F6) {
      return String.fromCodePoint(codePoint - 0x60);
    }
    return char;
  }).join("");
}

function differsOnlyByKanaScript(left: string, right: string): boolean {
  return left !== right && normalizeKanaScript(left) === normalizeKanaScript(right);
}

function normalizeContextForComparison(context: string): string {
  return context
    .replace(/<[^>]+>/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function postProcessMinimizedContext(
  fullContext: string,
  minimizedContext: string | null,
): string | null {
  if (minimizedContext === null) {
    return null;
  }

  const normalizedFull = normalizeContextForComparison(fullContext);
  const normalizedMinimized = normalizeContextForComparison(minimizedContext);

  if (normalizedMinimized === "" || normalizedMinimized === normalizedFull) {
    return null;
  }

  return minimizedContext;
}

function escapeHTML(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inferSourceLanguage(sourceText: string): "ja" | "en" {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/v.test(sourceText) ? "ja" : "en";
}

function formatSourceHTML(
  sourceText: string | null,
  sourceURL: string | null,
): string | null {
  if (sourceText === null && sourceURL === null) {
    return null;
  }

  const label = sourceText ?? sourceURL!;
  const lang = inferSourceLanguage(label);
  const escapedLabel = escapeHTML(label);

  if (sourceURL === null) {
    return `<span lang="${lang}">${escapedLabel}</span>`;
  }

  return `<a href="${escapeHTML(sourceURL)}" lang="${lang}">${escapedLabel}</a>`;
}

/**
 * Creates a complete MiwakeCard from the given input.
 */
export async function createCard(options: CreateCardOptions): Promise<MiwakeCard> {
  const { input, jmdictEntry, generateFields } = options;

  // Generate AI fields
  const aiFields = await generateFields({
    context: input.context,
    recognitionTarget: input.recognitionTarget,
    jmdictEntry,
    source: input.source,
    sourceURL: input.sourceURL,
  });

  const recognitionTarget = differsOnlyByKanaScript(
      input.recognitionTarget,
      aiFields.targetInContext,
    )
    ? aiFields.targetInContext
    : input.recognitionTarget;

  // Process the context HTML (needs targetInContext from AI fields)
  const { processedContext, contextReading } = processContext(
    input.context,
    recognitionTarget,
    aiFields.targetInContext,
  );

  // Post-process hints
  let hint = aiFields.hint;
  // Strip hint if all senses are applicable (no disambiguation needed)
  const allSensesApply = aiFields.applicableSenses.length === 0 ||
    aiFields.applicableSenses.length === jmdictEntry.sense.length;
  if (allSensesApply) {
    hint = null;
  }
  // Strip hint if it doesn't contain either recognition target spelling (invalid hint)
  if (
    hint !== null && !hint.includes(recognitionTarget) && !hint.includes(input.recognitionTarget)
  ) {
    hint = null;
  }

  // Determine the reading to use
  // Priority: context furigana > AI-determined reading
  const readingKana = contextReading ?? aiFields.reading;

  // Format reading with precise furigana placement
  let reading: string | null = null;
  if (containsKanji(recognitionTarget)) {
    reading = formatReadingForAnki(jmdictEntry.id, recognitionTarget, readingKana);
    // Fallback if formatReadingForAnki returns null (not in furigana database)
    if (reading === null) {
      // Simple fallback: just append reading in brackets
      reading = `${recognitionTarget}[${readingKana}]`;
    }
  }

  // Generate dictionary entry HTML
  const dictionaryEntry = renderEntry(jmdictEntry);

  // Build the key
  const key = formatMiwakeKey(
    recognitionTarget,
    input.jmdictId,
    aiFields.applicableSenses,
    jmdictEntry.sense.length,
  );

  // Determine source and URL
  const sourceText = aiFields.cleanedSource ?? input.source ?? null;
  const sourceURL = aiFields.sourceURLIsPublic ? (input.sourceURL ?? null) : null;
  const source = formatSourceHTML(sourceText, sourceURL);
  const minimizedContext = postProcessMinimizedContext(
    processedContext,
    aiFields.minimizedContext,
  );

  return {
    key,
    recognitionTarget,
    reading,
    hint,
    fullContext: processedContext,
    minimizedContext,
    dictionaryEntry,
    source,
  };
}
