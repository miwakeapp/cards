import { escape } from "@std/html/entities";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { compatibleSenseNumbersForJMDictUsage, type MiwakeCard } from "card_creator";

const NOTATION_MARKER_PATTERN = /[~〜～]/u;
const PREFIX_PARTS_OF_SPEECH = new Set(["pref", "n-pref"]);
const SUFFIX_PARTS_OF_SPEECH = new Set(["suf", "n-suf", "ctr"]);

type BoundaryPattern = "leading" | "trailing" | "both";

/** Normalizes boundary notation from legacy cards to the Miwake Card full-width marker. */
export function normalizeNotationMarkers(target: string): string {
  return target.replace(
    /^[~〜～]+|[~〜～]+$/gu,
    (markers) => "～".repeat([...markers].length),
  );
}

/** Removes user-facing prefix/suffix notation before JMDict spelling lookup. */
export function removeBoundaryNotation(target: string): string {
  return target.replace(/^[~〜～]+|[~〜～]+$/gu, "");
}

/** Whether the legacy target contains explicit boundary notation that should remain user-edited. */
export function hasBoundaryNotation(target: string): boolean {
  return NOTATION_MARKER_PATTERN.test(target[0] ?? "") ||
    NOTATION_MARKER_PATTERN.test(target.at(-1) ?? "");
}

function displayedBoundaryPattern(target: string): BoundaryPattern | undefined {
  const leading = NOTATION_MARKER_PATTERN.test(target[0] ?? "");
  const trailing = NOTATION_MARKER_PATTERN.test(target.at(-1) ?? "");
  if (leading && trailing) return "both";
  if (leading) return "leading";
  if (trailing) return "trailing";
  return undefined;
}

function senseBoundaryPattern(
  entry: JMdictWord,
  senseNumber: number,
): BoundaryPattern | undefined {
  const partsOfSpeech = entry.sense[senseNumber - 1]?.partOfSpeech ?? [];
  if (
    partsOfSpeech.length > 0 &&
    partsOfSpeech.every((partOfSpeech) => SUFFIX_PARTS_OF_SPEECH.has(partOfSpeech))
  ) {
    return "leading";
  }
  if (
    partsOfSpeech.length > 0 &&
    partsOfSpeech.every((partOfSpeech) => PREFIX_PARTS_OF_SPEECH.has(partOfSpeech))
  ) {
    return "trailing";
  }
  return undefined;
}

function senseNumbersForSpelling(entry: JMdictWord, spelling: string): number[] {
  if (entry.kana.some(({ text }) => text === spelling)) {
    return compatibleSenseNumbersForJMDictUsage(entry, spelling, undefined);
  }
  if (!entry.kanji.some(({ text }) => text === spelling)) return [];

  const numbers = entry.kana
    .filter(({ appliesToKanji }) =>
      appliesToKanji.includes("*") || appliesToKanji.includes(spelling)
    )
    .flatMap(({ text }) => compatibleSenseNumbersForJMDictUsage(entry, spelling, text));
  return [...new Set(numbers)];
}

/**
 * Omits a separate hint only when boundary notation fully distinguishes the selected usage.
 *
 * Every selected sense must produce the displayed boundary pattern, and no unselected sense or
 * same-spelling entry may produce that pattern. Entry and sense selection may still use the
 * AI-generated hint as evidence before this card-facing policy is applied.
 */
export function disambiguationHintForJMDictUsage(
  hint: string | undefined,
  displayTarget: string,
  spelling: string,
  selectedEntry: JMdictWord,
  selectedSenseNumbers: readonly number[],
  sameSpellingEntries: readonly JMdictWord[],
): string | undefined {
  if (hint === undefined) return undefined;
  const pattern = displayedBoundaryPattern(displayTarget);
  if (pattern === undefined) return hint;
  if (
    selectedSenseNumbers.some((senseNumber) =>
      senseBoundaryPattern(selectedEntry, senseNumber) !== pattern
    )
  ) {
    return hint;
  }

  const selectedSenseNumberSet = new Set(selectedSenseNumbers);
  const hasSamePatternCompetitor = sameSpellingEntries.some((entry) =>
    senseNumbersForSpelling(entry, spelling).some((senseNumber) =>
      (entry.id !== selectedEntry.id || !selectedSenseNumberSet.has(senseNumber)) &&
      senseBoundaryPattern(entry, senseNumber) === pattern
    )
  );
  return hasSamePatternCompetitor ? hint : undefined;
}

/**
 * Applies a legacy user edit to Card Creator's automatically rendered target fields.
 *
 * The key spelling remains authoritative. The override must contain it exactly, while any precise
 * furigana is transferred into that occurrence after removing Card Creator's automatic boundary
 * notation.
 */
export function applyDisplayTargetOverride(
  card: Pick<MiwakeCard, "recognitionTarget" | "reading">,
  spelling: string,
  override: string | undefined,
): { recognitionTarget: string; reading: string | null } {
  if (override === undefined) {
    return {
      recognitionTarget: card.recognitionTarget,
      reading: card.reading,
    };
  }

  const firstIndex = override.indexOf(spelling);
  if (firstIndex === -1 || firstIndex !== override.lastIndexOf(spelling)) {
    throw new Error(
      `Recognition-target override ${JSON.stringify(override)} must contain key spelling ` +
        `${JSON.stringify(spelling)} exactly once`,
    );
  }

  if (card.reading === null) {
    return { recognitionTarget: escape(override), reading: null };
  }

  const baseReading = card.reading.replace(/^～|～$/gu, "");
  const before = override.slice(0, firstIndex);
  const after = override.slice(firstIndex + spelling.length);
  return {
    recognitionTarget: escape(override),
    reading: `${escape(before)}${baseReading}${escape(after)}`,
  };
}
