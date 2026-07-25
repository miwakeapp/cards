import { escape } from "@std/html/entities";
import type { MiwakeCard } from "card_creator";

const NOTATION_MARKER_PATTERN = /[~〜～]/u;

/** Normalizes boundary notation from legacy cards to the Miwake Card full-width marker. */
export function normalizeNotationMarkers(target: string): string {
  return target.replace(
    /^[~〜～]+|[~〜～]+$/gu,
    (markers) => "～".repeat([...markers].length),
  );
}

/** Whether the legacy target contains explicit boundary notation that should remain user-edited. */
export function hasBoundaryNotation(target: string): boolean {
  return NOTATION_MARKER_PATTERN.test(target[0] ?? "") ||
    NOTATION_MARKER_PATTERN.test(target.at(-1) ?? "");
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
