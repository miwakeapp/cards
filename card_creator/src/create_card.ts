/**
 * Main card creation logic.
 * Takes input and produces a complete MiwakeCard.
 */

import type { JMDictWord } from "data";
import { unescape } from "@std/html/entities";
import { toHiragana } from "japanese_text";
import { renderEntry } from "jmdict_to_html";
import { formatReadingForAnki } from "jmdict_to_html/format-reading-for-anki";
import { prepareContextRuby, resolveContextReading } from "./context_reading.ts";
import { formatMiwakeKey } from "./keys.ts";
import { normalizeMinimizedContext } from "./minimized_context.ts";
import type {
  AIGeneratedFields,
  CardCreationInput,
  GenerateFieldsInput,
  MiwakeCard,
} from "./types.ts";

/**
 * Options for card creation.
 */
export interface CreateCardOptions {
  /** The input data for the card. */
  input: CardCreationInput;

  /** The JMDict entry for the word. */
  jmdictEntry: JMDictWord;

  /**
   * Function to generate AI fields.
   * Inject this to allow mocking in tests or to select different AI models.
   */
  generateFields: (input: GenerateFieldsInput) => Promise<AIGeneratedFields>;
}

const htmlTagRegex = /<\/?[a-z][^>]*>/iu;
const htmlCharacterReferenceRegex = /&(?:#(?:x[\da-f]+|\d+)|[\da-z]+);/giu;
const hasHTMLCharacterReferenceRegex = /&(?:#(?:x[\da-f]+|\d+)|[\da-z]+);/iu;

function normalizeNonBreakingSpaces(text: string): string {
  return text
    .replace(
      htmlCharacterReferenceRegex,
      (reference) => unescape(reference) === "\u00a0" ? " " : reference,
    )
    .replace(/[\u00a0\u202f]/gu, " ");
}

function assertPlainTarget(target: string, fieldName: string): void {
  if (target === "") {
    throw new Error(`${fieldName} must not be empty`);
  }
  if (target !== target.trim()) {
    throw new Error(`${fieldName} must not have surrounding whitespace`);
  }
  if (target.includes("\u00a0") || target.includes("\u202f")) {
    throw new Error(`${fieldName} must not contain nonbreaking spaces`);
  }
  if (htmlTagRegex.test(target)) {
    throw new Error(`${fieldName} must not contain HTML markup`);
  }
  if (hasHTMLCharacterReferenceRegex.test(target)) {
    throw new Error(`${fieldName} must not contain HTML character references`);
  }
}

/** Wraps the target occurrence in `<mark>`, accounting for Anki-style ruby. */
function markContextTarget(
  context: string,
  recognitionTarget: string,
  targetInContext: string,
): string {
  let processed = context;
  // Wrap target in <mark>. Use a furigana-aware pattern that matches the target
  // even when bracket annotations are interspersed (e.g. "瓦解" → " 瓦[が] 解[かい]").
  if (!processed.includes("<mark>")) {
    for (const markTarget of new Set([targetInContext, recognitionTarget])) {
      const chars = [...markTarget];
      const furiganaAwarePattern = chars
        .map((c) => `${RegExp.escape(c)}(?:\\[[^\\]]+\\])?`)
        .join("\\s?");
      const pattern = new RegExp(`(${furiganaAwarePattern})`, "g");
      const marked = processed.replace(pattern, "<mark>$1</mark>");
      if (marked !== processed) {
        processed = marked;
        break;
      }
    }
  }

  return processed;
}

/**
 * Determines if a recognition target contains any kanji.
 */
function containsKanji(text: string): boolean {
  return /\p{Script=Han}/v.test(text);
}

function differsOnlyByKanaScript(left: string, right: string): boolean {
  return left !== right && toHiragana(left) === toHiragana(right);
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
  assertPlainTarget(input.recognitionTarget, "recognitionTarget");
  const inputContext = normalizeNonBreakingSpaces(input.context);
  const preparedContextRuby = prepareContextRuby(
    inputContext,
    input.recognitionTarget,
    jmdictEntry,
  );
  const readingFromContext = preparedContextRuby.reading ?? undefined;

  // Generate AI fields
  const aiFields = await generateFields({
    context: inputContext,
    recognitionTarget: input.recognitionTarget,
    jmdictEntry,
    source: input.source,
    sourceURL: input.sourceURL,
    readingFromContext,
  });

  assertPlainTarget(aiFields.targetInContext, "targetInContext");
  const targetInContext = aiFields.targetInContext;
  const recognitionTarget = differsOnlyByKanaScript(
      input.recognitionTarget,
      targetInContext,
    )
    ? targetInContext
    : input.recognitionTarget;

  // Process the context HTML (needs targetInContext from AI fields)
  let processedContext = markContextTarget(
    preparedContextRuby.context,
    recognitionTarget,
    targetInContext,
  );
  const contextReading = resolveContextReading(
    processedContext,
    preparedContextRuby,
    recognitionTarget,
    jmdictEntry,
  );
  processedContext = contextReading.context;

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

  const readingKana = contextReading.reading ?? aiFields.reading;

  let reading: string | null = null;
  if (containsKanji(recognitionTarget)) {
    if (readingKana === undefined) {
      throw new Error(`No reading was supplied for ${JSON.stringify(recognitionTarget)}`);
    }
    reading = await formatReadingForAnki(jmdictEntry.id, recognitionTarget, readingKana);
    // Fallback if formatReadingForAnki returns null (not in furigana database)
    if (reading === null) {
      reading = contextReading.formattedReading ?? `${recognitionTarget}[${readingKana}]`;
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
  const minimizedContext = normalizeMinimizedContext(
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
