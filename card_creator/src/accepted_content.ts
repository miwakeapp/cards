import type { AcceptedJMDictUsage } from "./types.ts";
import { type ResolvedJMDictUsage, resolveJMDictUsage } from "./jmdict_usage.ts";
import { formatReadingForAnki } from "./format_reading_for_anki.ts";

/** One accepted entry/sense usage after JMDict validation and canonical ordering. */
interface ResolvedAcceptedJMDictUsage {
  /** The accepted JMDict entry. */
  readonly entry: AcceptedJMDictUsage["entry"];
  /** A canonical direct spelling/reading/sense grounding for rendering this usage. */
  readonly usage: ResolvedJMDictUsage;
  /** Direct JMDict grounding for each accepted reading which supports this complete usage. */
  readonly supportedReadings: ReadonlyMap<string | undefined, ResolvedJMDictUsage>;
}

/** Canonically ordered, mechanically validated content shared by card creation and maintenance. */
interface ResolvedAcceptedContent {
  /** Accepted entry/sense usages in ascending numeric JMDict ID order. */
  readonly usages: readonly [
    ResolvedAcceptedJMDictUsage,
    ...ResolvedAcceptedJMDictUsage[],
  ];
  /** Canonical display order, or `null` for a kana recognition target. */
  readonly kanaReadings: readonly string[] | null;
  /** Exact undecorated JMDict spelling encoded in the Key. */
  readonly spelling: string;
  /** Front-side target, including any uniformly implied affix notation. */
  readonly recognitionTarget: string;
  /** Whether the selected JMDict form category requires the card's Reading field. */
  readonly usesReadingField: boolean;
}

interface UnresolvedAcceptedJMDictUsage {
  readonly entry: AcceptedJMDictUsage["entry"];
  readonly supportedReadings: ReadonlyMap<string | undefined, ResolvedJMDictUsage>;
}

function resolveInputUsage(
  input: AcceptedJMDictUsage,
  recognitionTarget: string,
  kanaReadings: readonly (string | undefined)[],
): UnresolvedAcceptedJMDictUsage {
  const structurallyCompatible = new Map<string | undefined, ResolvedJMDictUsage>();
  let firstStructuralError: unknown;
  for (const kanaReading of kanaReadings) {
    try {
      structurallyCompatible.set(
        kanaReading,
        resolveJMDictUsage(input.entry, recognitionTarget, kanaReading, undefined),
      );
    } catch (error) {
      firstStructuralError ??= error;
    }
  }
  if (structurallyCompatible.size === 0) throw firstStructuralError;

  const senseNumbers = input.applicableSenseNumbers ?? [
    ...new Set([...structurallyCompatible.values()].flatMap((usage) => usage.senseNumbers)),
  ];
  const supportedReadings = new Map<string | undefined, ResolvedJMDictUsage>();
  let firstSenseError: unknown;
  for (const kanaReading of structurallyCompatible.keys()) {
    try {
      supportedReadings.set(
        kanaReading,
        resolveJMDictUsage(input.entry, recognitionTarget, kanaReading, senseNumbers),
      );
    } catch (error) {
      firstSenseError ??= error;
    }
  }
  if (supportedReadings.size === 0) {
    if (input.applicableSenseNumbers !== undefined) throw firstSenseError;
    throw new Error(
      `The senses available through accepted readings for JMDict entry ${input.entry.id} cannot ` +
        "form one Key usage because no accepted reading supports all of them",
    );
  }

  return { entry: input.entry, supportedReadings };
}

function compareReadings(
  left: string,
  right: string,
  usages: readonly UnresolvedAcceptedJMDictUsage[],
): number {
  function rank(reading: string): readonly [number, number, string] {
    const supportingUsage = usages.find(({ supportedReadings }) => supportedReadings.has(reading))!;
    return [
      Number(supportingUsage.entry.id),
      supportingUsage.entry.kana.findIndex(({ text }) => text === reading),
      reading,
    ];
  }

  const leftRank = rank(left);
  const rightRank = rank(right);
  return leftRank[0] - rightRank[0] || leftRank[1] - rightRank[1] ||
    (leftRank[2] < rightRank[2] ? -1 : leftRank[2] > rightRank[2] ? 1 : 0);
}

/**
 * Mechanically validates the JMDict grounding for one already-reviewed recognition unit.
 *
 * Cross-entry semantic equivalence is a caller-owned judgment: every accepted reading is asserted
 * to be an acceptable response for every selected usage. This resolver verifies the evidence
 * available in JMDict—that every reading directly supports at least one complete usage and every
 * usage has at least one directly supporting reading—then supplies canonical entry and Reading
 * order independently of acquisition provenance.
 */
export function resolveAcceptedContent(input: {
  readonly jmdictUsages: readonly [AcceptedJMDictUsage, ...AcceptedJMDictUsage[]];
  readonly kanaReadings?: readonly [string, ...string[]];
  readonly recognitionTarget: string;
}): ResolvedAcceptedContent {
  if (input.jmdictUsages.length === 0) {
    throw new Error("jmdictUsages must contain at least one JMDict usage");
  }
  const entryIds = input.jmdictUsages.map(({ entry }) => entry.id);
  if (new Set(entryIds).size !== entryIds.length) {
    throw new Error("jmdictUsages must not repeat a JMDict entry");
  }
  if (input.kanaReadings !== undefined) {
    if (input.kanaReadings.length === 0) {
      throw new Error("kanaReadings must contain at least one reading when present");
    }
    if (new Set(input.kanaReadings).size !== input.kanaReadings.length) {
      throw new Error("kanaReadings must not repeat a reading");
    }
  }

  const requestedReadings: readonly (string | undefined)[] = input.kanaReadings ?? [undefined];
  const unresolvedUsages = input.jmdictUsages.map((usage) =>
    resolveInputUsage(usage, input.recognitionTarget, requestedReadings)
  ).toSorted((left, right) => Number(left.entry.id) - Number(right.entry.id));
  for (const kanaReading of requestedReadings) {
    if (!unresolvedUsages.some(({ supportedReadings }) => supportedReadings.has(kanaReading))) {
      throw new Error(
        `kanaReading ${JSON.stringify(kanaReading)} does not support any complete JMDict usage ` +
          "accepted by this card",
      );
    }
  }

  const kanaReadings = input.kanaReadings === undefined
    ? null
    : [...input.kanaReadings].sort((left, right) => compareReadings(left, right, unresolvedUsages));
  const canonicalReadings: readonly (string | undefined)[] = kanaReadings ?? [undefined];
  const usages = unresolvedUsages.map((candidate) => {
    const supportingReading = canonicalReadings.find((reading) =>
      candidate.supportedReadings.has(reading)
    )!;
    return {
      ...candidate,
      usage: candidate.supportedReadings.get(supportingReading)!,
    };
  }) as [ResolvedAcceptedJMDictUsage, ...ResolvedAcceptedJMDictUsage[]];
  const referenceUsage = usages[0].usage;
  const mismatchingUsage = usages.find((candidate) =>
    candidate.usage.usesReadingField !== referenceUsage.usesReadingField ||
    candidate.usage.recognitionTarget !== referenceUsage.recognitionTarget
  );
  if (mismatchingUsage !== undefined) {
    throw new Error(
      `Accepted usage in JMDict entry ${
        JSON.stringify(mismatchingUsage.entry.id)
      } renders recognition target ${
        JSON.stringify(mismatchingUsage.usage.recognitionTarget)
      } with a different reading-field category or affix boundary from the reference target ${
        JSON.stringify(referenceUsage.recognitionTarget)
      }`,
    );
  }

  return {
    usages,
    kanaReadings,
    spelling: referenceUsage.spelling,
    recognitionTarget: referenceUsage.recognitionTarget,
    usesReadingField: referenceUsage.usesReadingField,
  };
}

/** Formats the accepted readings without imposing front-side affix decoration. */
export async function formatResolvedReadingsForAnki(resolved: ResolvedAcceptedContent) {
  if (!resolved.usesReadingField) {
    return {
      formattedReadings: null,
      unavailableKanaReading: null,
      supportingEntryIds: [],
    };
  }

  const formattedReadings: string[] = [];
  for (const kanaReading of resolved.kanaReadings!) {
    const candidates = resolved.usages.filter(({ supportedReadings }) =>
      supportedReadings.has(kanaReading)
    );
    let formatted: string | null = null;
    for (const candidate of candidates) {
      const usage = candidate.supportedReadings.get(kanaReading)!;
      formatted = await formatReadingForAnki(
        candidate.entry,
        usage.spelling,
        usage.kanaReading,
      );
      if (formatted !== null) break;
    }
    if (formatted === null) {
      return {
        formattedReadings: null,
        unavailableKanaReading: kanaReading,
        supportingEntryIds: candidates.map(({ entry }) => entry.id),
      };
    }
    formattedReadings.push(formatted);
  }

  return {
    formattedReadings,
    unavailableKanaReading: null,
    supportingEntryIds: [],
  };
}

/**
 * Validates and canonically orders accepted readings, then formats their undecorated Anki
 * furigana alternatives.
 *
 * Returns `null` when the recognition target is kana or precise placement data is unavailable for
 * any accepted reading. Invalid entry, spelling, reading, or sense relationships throw.
 */
export async function formatAcceptedReadingsForAnki(
  input: Pick<
    import("./types.ts").CreateCardInput,
    "jmdictUsages" | "kanaReadings" | "recognitionTarget"
  >,
): Promise<string[] | null> {
  const result = await formatResolvedReadingsForAnki(resolveAcceptedContent(input));
  return result.formattedReadings;
}
