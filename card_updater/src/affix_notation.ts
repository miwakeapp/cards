export type DisplayedAffixNotation = "leading" | "none" | "trailing";

export interface SplitAffixNotation {
  /** The single affix boundary communicated by the field, if any. */
  notation: DisplayedAffixNotation;
  /** Field contents after removing the marker and its adjacent horizontal whitespace. */
  content: string;
  /** Exact removed prefix or suffix, retained when a rewritten field should preserve it. */
  decoration: string;
}

const LEADING_MARKER = /^[~〜～][ \t]*/u;
const TRAILING_MARKER = /[ \t]*[~〜～]$/u;

/**
 * Splits user-editable affix notation without normalizing its glyph or spacing.
 *
 * Miwake emits `～`, but older and manually edited cards can contain ASCII `~` or wave dash `〜`.
 * A marker on both sides is not a single prefix/suffix cue, so it deliberately remains content.
 */
export function splitAffixNotation(text: string): SplitAffixNotation {
  const leading = text.match(LEADING_MARKER)?.[0];
  const trailing = text.match(TRAILING_MARKER)?.[0];
  if ((leading === undefined) === (trailing === undefined)) {
    return { notation: "none", content: text, decoration: "" };
  }
  if (leading !== undefined) {
    return {
      notation: "leading",
      content: text.slice(leading.length),
      decoration: leading,
    };
  }
  return {
    notation: "trailing",
    content: text.slice(0, -trailing!.length),
    decoration: trailing!,
  };
}
