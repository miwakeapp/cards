import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import type { AcceptedJMDictUsage } from "card_creator";
import { resolveAcceptedReadingsForAnki } from "card_creator/accepted-reading";
import type { Key } from "card_model/keys";
import {
  decorateReadingAlternative,
  formatReading,
  type ParsedReadingAlternative,
  parseReading,
} from "card_model/reading";
import { parseAnkiFurigana, toHiragana } from "japanese_text";
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
  acceptedKanaReadings: readonly string[];
}

interface ReadingFragment {
  text: string;
  /** Literal Key text is orthography, so its hiragana/katakana choice is not reading evidence. */
  literal: boolean;
}

interface ParsedCardReadingAlternative extends ParsedReadingAlternative {
  fragments: readonly ReadingFragment[];
}

function matchesReadingFragments(
  candidate: string,
  fragments: readonly ReadingFragment[],
): boolean {
  let offset = 0;
  for (const fragment of fragments) {
    const candidateFragment = candidate.slice(offset, offset + fragment.text.length);
    const matches = fragment.literal
      ? toHiragana(candidateFragment) === toHiragana(fragment.text)
      : candidateFragment === fragment.text;
    if (!matches) return false;
    offset += fragment.text.length;
  }
  return offset === candidate.length;
}

function jmdictReadingForDisplay(
  alternative: ParsedCardReadingAlternative,
  readings: ReadonlySet<string>,
): string {
  if (readings.has(alternative.kanaReading)) return alternative.kanaReading;

  const candidates = [...readings].filter((reading) =>
    matchesReadingFragments(reading, alternative.fragments)
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new Error(
      `Reading alternative ${JSON.stringify(alternative.formatted)} does not identify an exact ` +
        "JMDict reading.",
    );
  }
  throw new Error(
    `Reading alternative ${JSON.stringify(alternative.formatted)} is ambiguous between exact ` +
      `JMDict readings ${JSON.stringify(candidates)}.`,
  );
}

function readingFragmentsForAnkiFuriganaSurfaceSubstring(
  text: string,
  surfaceSubstring: string,
): ReadingFragment[] | null {
  const parsed = parseAnkiFurigana(text);
  if (parsed === null || surfaceSubstring === "") return null;

  const substringStart = parsed.surface.indexOf(surfaceSubstring);
  if (
    substringStart === -1 ||
    parsed.surface.indexOf(surfaceSubstring, substringStart + 1) !== -1
  ) return null;
  const substringEnd = substringStart + surfaceSubstring.length;

  let surfaceOffset = 0;
  const fragments: ReadingFragment[] = [];
  for (const part of parsed.parts) {
    const surface = part.type === "plain" ? part.text : part.base;
    const partReading = part.type === "plain" ? part.text : part.reading;
    if (surface === "") {
      if (surfaceOffset > substringStart && surfaceOffset < substringEnd) {
        fragments.push({ text: partReading, literal: false });
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
      fragments.push({ text: partReading, literal: part.type === "plain" });
    } else if (part.type === "plain") {
      fragments.push({
        text: part.text.slice(overlapStart - partStart, overlapEnd - partStart),
        literal: true,
      });
    } else {
      return null;
    }
  }
  return fragments.length === 0 ? null : fragments;
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
        acceptedKanaReadings: [],
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
        acceptedKanaReadings: [],
      };
    }
  }

  const acceptedUsages = acceptedJMDictUsages(key, resolvedEntries, input.senseOverrides);
  if (!usesReadingField) {
    if (input.reading !== "") {
      return {
        proposedReading: null,
        error: "Reading must be empty when the Key spelling is a kana form.",
        acceptedKanaReadings: [],
      };
    }
    try {
      await resolveAcceptedReadingsForAnki({
        recognitionTarget: key.spelling,
        jmdictUsages: acceptedUsages,
      });
    } catch (error) {
      return validationError(error);
    }
    return { proposedReading: null, error: null, acceptedKanaReadings: [key.spelling] };
  }

  if (input.reading === "") {
    return {
      proposedReading: null,
      error: "Reading is required for a non-kana Key spelling.",
      acceptedKanaReadings: [],
    };
  }
  const parsedReadings = parseCardReadingAlternativesWithFragments(
    input.reading,
    recognitionTarget,
    key.spelling,
  );
  if (parsedReadings === null) {
    return {
      proposedReading: null,
      error:
        "Reading alternatives must use canonical Miwake syntax and contain the Key spelling exactly once at independently readable boundaries.",
      acceptedKanaReadings: [],
    };
  }

  let requestedKanaReadings: readonly [string, ...string[]];
  let acceptedKanaReadings: readonly string[];
  let formattedVariants: readonly string[] | null;
  try {
    const jmdictReadings = new Set(
      resolvedEntries.flatMap((entry) => entry.kana.map(({ text }) => text)),
    );
    requestedKanaReadings = parsedReadings.map((alternative) =>
      jmdictReadingForDisplay(alternative, jmdictReadings)
    ) as [string, ...string[]];
    const resolved = await resolveAcceptedReadingsForAnki({
      recognitionTarget: key.spelling,
      kanaReadings: requestedKanaReadings,
      jmdictUsages: acceptedUsages,
    });
    if (resolved.kanaReadings === null) {
      throw new Error("A non-kana Key spelling unexpectedly resolved without kana readings.");
    }
    acceptedKanaReadings = resolved.kanaReadings;
    formattedVariants = resolved.formattedReadings;
  } catch (error) {
    return validationError(error);
  }
  if (formattedVariants === null) {
    return { proposedReading: null, error: null, acceptedKanaReadings };
  }

  const targetAffix = splitAffixNotation(recognitionTarget);
  let canonicalAlternatives: readonly string[];
  if (targetAffix.content === key.spelling) {
    const prefix = targetAffix.notation === "leading" ? targetAffix.decoration.trim() : "";
    const suffix = targetAffix.notation === "trailing" ? targetAffix.decoration.trim() : "";
    canonicalAlternatives = formattedVariants.map((formatted) =>
      decorateReadingAlternative(formatted, prefix, suffix)
    );
  } else {
    const alternativesByKanaReading = new Map(
      parsedReadings.map(({ formatted }, index) => [requestedKanaReadings[index], formatted]),
    );
    canonicalAlternatives = acceptedKanaReadings.map((kanaReading) =>
      alternativesByKanaReading.get(kanaReading)!
    );
  }

  const formattedReading = formatReading(canonicalAlternatives);
  return {
    proposedReading: formattedReading === input.reading ? null : formattedReading,
    error: null,
    acceptedKanaReadings,
  };
}

function parseCardReadingAlternativesWithFragments(
  reading: string,
  recognitionTarget: string,
  keySpelling: string,
): ParsedCardReadingAlternative[] | null {
  const targetAffix = splitAffixNotation(recognitionTarget);
  const displayedAlternatives = parseReading(reading, recognitionTarget);
  if (displayedAlternatives === null) return null;

  const parsed: ParsedCardReadingAlternative[] = [];
  for (const { formatted } of displayedAlternatives) {
    let projectedReading = formatted;
    if (targetAffix.content === keySpelling && targetAffix.notation !== "none") {
      const readingAffix = splitAffixNotation(formatted);
      if (readingAffix.notation !== targetAffix.notation) return null;
      projectedReading = readingAffix.content;
    }
    const fragments = readingFragmentsForAnkiFuriganaSurfaceSubstring(
      projectedReading,
      keySpelling,
    );
    if (fragments === null) return null;
    parsed.push({
      formatted,
      kanaReading: fragments.map(({ text }) => text).join(""),
      fragments,
    });
  }
  return parsed;
}

/** Recovers Key-spelling pronunciations while preserving each complete displayed alternative. */
export function parseCardReadingAlternatives(
  reading: string,
  recognitionTarget: string,
  keySpelling: string,
): ParsedReadingAlternative[] | null {
  return parseCardReadingAlternativesWithFragments(reading, recognitionTarget, keySpelling)?.map(
    ({ formatted, kanaReading }) => ({ formatted, kanaReading }),
  ) ?? null;
}

function validationError(error: unknown): ReadingValidation {
  return {
    proposedReading: null,
    error: error instanceof Error ? error.message : String(error),
    acceptedKanaReadings: [],
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
