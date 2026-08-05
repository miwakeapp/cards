/**
 * Deterministic Miwake Card rendering.
 */

import { escape } from "@std/html/entities";
import { renderDictionaryField } from "card_model/dictionary";
import { formatKey } from "card_model/keys";
import { formatReading } from "card_model/reading";
import type { CardFields } from "card_model";
import { formatResolvedReadingsForAnki, resolveAcceptedContent } from "./accepted_content.ts";
import { processContextHTML } from "./context.ts";
import { formatSourceHTML } from "./source.ts";
import type { CreateCardInput } from "./types.ts";

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
  readings: readonly string[],
  formattedTargetReadings: ReadonlyMap<string, string> | undefined,
): Promise<string> {
  try {
    return await processContextHTML(html, spelling, readings, { formattedTargetReadings });
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
export async function createCard(
  input: CreateCardInput,
): Promise<CardFields> {
  assertNonemptyTrimmedText(input.recognitionTarget, "recognitionTarget");
  if (input.hint !== undefined) assertNonemptyTrimmedText(input.hint, "hint");

  if (input.kanaReadings !== undefined) {
    for (const [index, kanaReading] of input.kanaReadings.entries()) {
      assertNonemptyTrimmedText(kanaReading, `kanaReadings[${index}]`);
    }
  }

  const resolved = resolveAcceptedContent(input);
  const contextReadings = resolved.kanaReadings ?? [resolved.spelling];
  let reading: string | null = null;
  let formattedTargetReadings: ReadonlyMap<string, string> | undefined;
  if (resolved.usesReadingField) {
    const formatting = await formatResolvedReadingsForAnki(resolved);
    if (formatting.formattedReadings === null) {
      const entryDescription = formatting.supportingEntryIds.length === 1
        ? `in jmdictEntry with id ${JSON.stringify(formatting.supportingEntryIds[0])}`
        : `in supporting jmdictEntries ${JSON.stringify(formatting.supportingEntryIds)}`;
      throw new Error(
        `No furigana placement data exists for recognitionTarget ${
          JSON.stringify(resolved.spelling)
        } with kanaReading ${
          JSON.stringify(formatting.unavailableKanaReading)
        } ${entryDescription}`,
      );
    }
    formattedTargetReadings = new Map(
      resolved.kanaReadings!.map((kanaReading, index) => [
        kanaReading,
        formatting.formattedReadings![index],
      ]),
    );
    const referenceUsage = resolved.usages[0].usage;
    reading = formatReading(
      formatting.formattedReadings.map((formatted) =>
        `${referenceUsage.readingPrefix}${formatted}${referenceUsage.readingSuffix}`
      ),
    );
  }

  const fullContext = await processContextField(
    "fullContext",
    input.fullContext,
    resolved.spelling,
    contextReadings,
    formattedTargetReadings,
  );
  const minimizedContext = input.minimizedContext === undefined ? null : await processContextField(
    "minimizedContext",
    input.minimizedContext,
    resolved.spelling,
    contextReadings,
    formattedTargetReadings,
  );

  return {
    key: formatKey(
      resolved.spelling,
      resolved.usages.map((candidate) => ({
        jmdictId: candidate.entry.id,
        senseNumbers: candidate.usage.senseNumbers,
        totalSenses: candidate.entry.sense.length,
      })),
    ),
    recognitionTarget: escape(resolved.recognitionTarget),
    reading,
    hint: input.hint === undefined ? null : escape(input.hint),
    fullContext,
    minimizedContext,
    dictionary: renderDictionaryField(
      resolved.usages.map(({ entry }) => entry),
    ),
    source: formatSourceHTML(input.source),
  };
}
