import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import type { AcceptedJMDictUsage } from "card_creator";
import { formatAcceptedReadingsForAnki } from "card_creator/accepted-reading";
import type { Key } from "card_model/keys";
import {
  decorateReadingAlternative,
  formatReading,
  type ParsedReadingAlternative,
  parseReading,
} from "card_model/reading";
import { parseAnkiFurigana } from "japanese_text";
import { splitAffixNotation } from "./affix_notation.ts";

interface ReadingValidationInput {
  key: Key;
  recognitionTarget: string;
  reading: string;
  entries: ReadonlyMap<string, JMdictWord>;
  /** Latest sense selections keyed by entry ID. An empty selection defers sense validation. */
  senseOverrides?: ReadonlyMap<string, readonly number[]>;
}

interface ReadingValidation {
  proposedReading: string | null;
  error: string | null;
}

function readingForAnkiFuriganaSurfaceSubstring(
  text: string,
  surfaceSubstring: string,
): string | null {
  const parsed = parseAnkiFurigana(text);
  if (parsed === null || surfaceSubstring === "") return null;

  const substringStart = parsed.surface.indexOf(surfaceSubstring);
  if (
    substringStart === -1 ||
    parsed.surface.indexOf(surfaceSubstring, substringStart + 1) !== -1
  ) return null;
  const substringEnd = substringStart + surfaceSubstring.length;

  let surfaceOffset = 0;
  let reading = "";
  for (const part of parsed.parts) {
    const surface = part.type === "plain" ? part.text : part.base;
    const partReading = part.type === "plain" ? part.text : part.reading;
    if (surface === "") {
      if (surfaceOffset > substringStart && surfaceOffset < substringEnd) {
        reading += partReading;
      } else if (surfaceOffset === substringStart || surfaceOffset === substringEnd) {
        return null;
      }
      continue;
    }

    const partStart = surfaceOffset;
    const partEnd = partStart + surface.length;
    surfaceOffset = partEnd;
    const overlapStart = Math.max(partStart, substringStart);
    const overlapEnd = Math.min(partEnd, substringEnd);
    if (overlapStart >= overlapEnd) continue;

    if (overlapStart === partStart && overlapEnd === partEnd) {
      reading += partReading;
    } else if (part.type === "plain") {
      reading += part.text.slice(overlapStart - partStart, overlapEnd - partStart);
    } else {
      return null;
    }
  }
  return reading || null;
}

/** Validates a card's Reading against its complete latest-JMDict recognition unit. */
export async function validateCardReading(
  input: ReadingValidationInput,
): Promise<ReadingValidation> {
  const { key, entries } = input;
  const recognitionTarget = input.recognitionTarget || key.spelling;
  const resolvedEntries: JMdictWord[] = [];
  for (const usage of key.usages) {
    const entry = entries.get(usage.jmdictId);
    if (entry === undefined) {
      return {
        proposedReading: null,
        error: `The Key refers to missing JMDict entry ${usage.jmdictId}.`,
      };
    }
    resolvedEntries.push(entry);
  }

  const usesReadingField = resolvedEntries[0].kanji.some(({ text }) => text === key.spelling);
  for (let index = 1; index < resolvedEntries.length; ++index) {
    const entryUsesReadingField = resolvedEntries[index].kanji.some(({ text }) =>
      text === key.spelling
    );
    if (entryUsesReadingField !== usesReadingField) {
      return {
        proposedReading: null,
        error: `JMDict entry ${key.usages[index].jmdictId} puts the Key spelling in a ` +
          "different reading-field category from the other entries.",
      };
    }
  }

  const acceptedUsages = acceptedJMDictUsages(key, resolvedEntries, input.senseOverrides);
  if (!usesReadingField) {
    if (input.reading !== "") {
      return {
        proposedReading: null,
        error: "Reading must be empty when the Key spelling is a kana form.",
      };
    }
    try {
      await formatAcceptedReadingsForAnki({
        recognitionTarget: key.spelling,
        jmdictUsages: acceptedUsages,
      });
    } catch (error) {
      return validationError(error);
    }
    return { proposedReading: null, error: null };
  }

  if (input.reading === "") {
    return {
      proposedReading: null,
      error: "Reading is required for a non-kana Key spelling.",
    };
  }
  const parsedReadings = parseCardReadingAlternatives(
    input.reading,
    recognitionTarget,
    key.spelling,
  );
  if (parsedReadings === null) {
    return {
      proposedReading: null,
      error:
        "Reading alternatives must use canonical Miwake syntax and contain the Key spelling exactly once at independently readable boundaries.",
    };
  }

  let formattedVariants: readonly string[] | null;
  try {
    formattedVariants = await formatAcceptedReadingsForAnki({
      recognitionTarget: key.spelling,
      kanaReadings: parsedReadings.map(({ kanaReading }) => kanaReading) as [
        string,
        ...string[],
      ],
      jmdictUsages: acceptedUsages,
    });
  } catch (error) {
    return validationError(error);
  }
  if (formattedVariants === null) return { proposedReading: null, error: null };

  const targetAffix = splitAffixNotation(recognitionTarget);
  let canonicalAlternatives: readonly string[];
  if (targetAffix.content === key.spelling) {
    const prefix = targetAffix.notation === "leading" ? targetAffix.decoration.trim() : "";
    const suffix = targetAffix.notation === "trailing" ? targetAffix.decoration.trim() : "";
    canonicalAlternatives = formattedVariants.map((formatted) =>
      decorateReadingAlternative(formatted, prefix, suffix)
    );
  } else {
    const canonicalReadings = parseReading(formatReading(formattedVariants), key.spelling)!;
    const alternativesByKanaReading = new Map(
      parsedReadings.map(({ formatted, kanaReading }) => [kanaReading, formatted]),
    );
    canonicalAlternatives = canonicalReadings.map(({ kanaReading }) =>
      alternativesByKanaReading.get(kanaReading)!
    );
  }

  const formattedReading = formatReading(canonicalAlternatives);
  return {
    proposedReading: formattedReading === input.reading ? null : formattedReading,
    error: null,
  };
}

/** Recovers Key-spelling pronunciations while preserving each complete displayed alternative. */
export function parseCardReadingAlternatives(
  reading: string,
  recognitionTarget: string,
  keySpelling: string,
): ParsedReadingAlternative[] | null {
  const targetAffix = splitAffixNotation(recognitionTarget);
  const displayedAlternatives = parseReading(reading, recognitionTarget);
  if (displayedAlternatives === null) return null;
  if (targetAffix.content !== keySpelling) {
    const projected: ParsedReadingAlternative[] = [];
    for (const { formatted } of displayedAlternatives) {
      const kanaReading = readingForAnkiFuriganaSurfaceSubstring(formatted, keySpelling);
      if (kanaReading === null) return null;
      projected.push({ formatted, kanaReading });
    }
    return projected;
  }

  const undecoratedAlternatives: string[] = [];
  for (const { formatted } of displayedAlternatives) {
    if (targetAffix.notation === "none") {
      undecoratedAlternatives.push(formatted);
      continue;
    }
    const readingAffix = splitAffixNotation(formatted);
    if (readingAffix.notation !== targetAffix.notation) return null;
    undecoratedAlternatives.push(readingAffix.content);
  }
  const keyAlternatives = parseReading(formatReading(undecoratedAlternatives), keySpelling);
  if (keyAlternatives === null) return null;
  return keyAlternatives.map(({ kanaReading }, index) => ({
    formatted: displayedAlternatives[index].formatted,
    kanaReading,
  }));
}

function validationError(error: unknown): ReadingValidation {
  return {
    proposedReading: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

function acceptedJMDictUsages(
  key: Key,
  entries: readonly JMdictWord[],
  senseOverrides: ReadonlyMap<string, readonly number[]> = new Map(),
): readonly [AcceptedJMDictUsage, ...AcceptedJMDictUsage[]] {
  const usages = entries.map((entry, index): AcceptedJMDictUsage => {
    const keyUsage = key.usages[index];
    const selectedSenseNumbers = senseOverrides.has(keyUsage.jmdictId)
      ? senseOverrides.get(keyUsage.jmdictId)!
      : keyUsage.senseNumbers ?? entry.sense.map((_, senseIndex) => senseIndex + 1);
    return {
      entry,
      // An empty override means old targets could not all be aligned. The retargeting flow must
      // inspect every structurally compatible sense instead of validating a stale subset.
      ...(selectedSenseNumbers.length === 0
        ? {}
        : { applicableSenseNumbers: selectedSenseNumbers }),
    };
  });
  return usages as [AcceptedJMDictUsage, ...AcceptedJMDictUsage[]];
}
