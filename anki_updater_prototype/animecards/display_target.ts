import { escape } from "@std/html/entities";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import {
  jmdictAlternativesForCardFront,
  jmdictUsagesForSpelling,
  type MiwakeCard,
} from "card_creator";

const NOTATION_MARKER_PATTERN = /[~〜～]/u;

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
  if (pattern === undefined || pattern === "both") return hint;

  const contrastingUsages = jmdictAlternativesForCardFront(
    { entry: selectedEntry, senseNumbers: selectedSenseNumbers },
    jmdictUsagesForSpelling(sameSpellingEntries, spelling),
    { displayedAffixNotation: pattern },
  );
  return contrastingUsages.length > 0 ? hint : undefined;
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
