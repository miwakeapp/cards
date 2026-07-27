/**
 * Deterministic Miwake Card rendering.
 */

import { escape } from "@std/html/entities";
import { renderEntry } from "jmdict_to_html";
import { processContextHTML } from "./context.ts";
import { formatReadingForAnki } from "./format_reading_for_anki.ts";
import { resolveJMDictUsage } from "./jmdict_usage.ts";
import { formatMiwakeKey } from "./keys.ts";
import { formatSourceHTML } from "./source.ts";
import type { CreateCardInput, MiwakeCard } from "./types.ts";

function assertNonemptyTrimmedText(value: string, fieldName: string): void {
  if (value === "") {
    throw new Error(`${fieldName} ${JSON.stringify(value)} must not be empty`);
  }
  if (value !== value.trim()) {
    throw new Error(
      `${fieldName} ${JSON.stringify(value)} must not have surrounding whitespace`,
    );
  }
  if (value.includes("\u00a0") || value.includes("\u202f")) {
    throw new Error(`${fieldName} ${JSON.stringify(value)} must not contain nonbreaking spaces`);
  }
}

async function processContextField(
  fieldName: "fullContext" | "minimizedContext",
  html: string,
  spelling: string,
  reading: string,
): Promise<string> {
  try {
    return await processContextHTML(html, spelling, reading);
  } catch (cause) {
    if (!(cause instanceof Error)) throw cause;
    throw new Error(`${fieldName}: ${cause.message}`, { cause });
  }
}

/**
 * Validates fully resolved card content and deterministically renders all Miwake Card fields.
 *
 * This function performs no network access and resolves no semantic or pedagogical choices. In
 * particular, it does not select a JMDict entry, deinflect source text, choose context or senses,
 * choose a kana reading, generate a hint, minimize context, or clean source metadata. Callers must
 * resolve those decisions first.
 */
export async function createCard(input: CreateCardInput): Promise<MiwakeCard> {
  assertNonemptyTrimmedText(input.recognitionTarget, "recognitionTarget");
  if (input.hint !== undefined) assertNonemptyTrimmedText(input.hint, "hint");

  const usage = resolveJMDictUsage(
    input.jmdictEntry,
    input.recognitionTarget,
    input.kanaReading,
    input.applicableSenseNumbers,
  );
  const fullContext = await processContextField(
    "fullContext",
    input.fullContext,
    usage.spelling,
    usage.kanaReading,
  );
  const minimizedContext = input.minimizedContext === undefined ? null : await processContextField(
    "minimizedContext",
    input.minimizedContext,
    usage.spelling,
    usage.kanaReading,
  );

  let reading: string | null = null;
  if (usage.usesReadingField) {
    const formattedReading = await formatReadingForAnki(
      input.jmdictEntry,
      usage.spelling,
      usage.kanaReading,
    );
    if (formattedReading === null) {
      throw new Error(
        `No furigana placement data exists for recognitionTarget ${
          JSON.stringify(usage.spelling)
        } with kanaReading ${JSON.stringify(usage.kanaReading)} in jmdictEntry with id ` +
          `${JSON.stringify(input.jmdictEntry.id)}`,
      );
    }
    reading = `${usage.readingPrefix}${formattedReading}${usage.readingSuffix}`;
  }

  return {
    key: formatMiwakeKey(
      usage.spelling,
      input.jmdictEntry.id,
      usage.senseNumbers,
      input.jmdictEntry.sense.length,
    ),
    recognitionTarget: escape(usage.recognitionTarget),
    reading: reading === null ? null : escape(reading),
    hint: input.hint === undefined ? null : escape(input.hint),
    fullContext,
    minimizedContext,
    dictionaryEntry: renderEntry(input.jmdictEntry),
    source: formatSourceHTML(input.source),
  };
}
