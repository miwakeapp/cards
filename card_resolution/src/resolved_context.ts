import { contextRenderedText, markContextTargetOccurrences } from "./context.ts";
import {
  findSurfaceFormOccurrencesForLookupSpelling,
  type SurfaceFormLookupOptions,
} from "./recognition_target.ts";
import type { RenderedTextOccurrence } from "./rendered_text.ts";

const HORIZONTAL_WHITESPACE = /[\p{Zs}\t]/v;

interface LookupProjection {
  text: string;
  rawRanges: Array<{ start: number; end: number }>;
}

function lookupProjection(renderedText: string): LookupProjection {
  let text = "";
  const rawRanges: LookupProjection["rawRanges"] = [];
  for (let rawIndex = 0; rawIndex < renderedText.length;) {
    const character = String.fromCodePoint(renderedText.codePointAt(rawIndex)!);
    const rawEnd = rawIndex + character.length;
    if (!HORIZONTAL_WHITESPACE.test(character)) {
      text += character;
      for (let index = 0; index < character.length; ++index) {
        rawRanges.push({ start: rawIndex, end: rawEnd });
      }
    }
    rawIndex = rawEnd;
  }
  return { text, rawRanges };
}

function projectOccurrenceToRenderedText(
  occurrence: RenderedTextOccurrence,
  projection: LookupProjection,
  renderedText: string,
): RenderedTextOccurrence {
  const start = projection.rawRanges[occurrence.start].start;
  const end = projection.rawRanges[occurrence.end - 1].end;
  return { start, end, surface: renderedText.slice(start, end) };
}

/** An exact, range-preserving resolution of one JMDict spelling in an HTML context. */
export interface ResolvedContextTarget {
  /** The spelling supplied to deterministic deinflection. */
  readonly lookupSpelling: string;
  /** Canonical rendered base text against which `occurrences` are indexed. */
  readonly renderedText: string;
  /** Exact lexical occurrences selected by deterministic deinflection. */
  readonly occurrences: readonly RenderedTextOccurrence[];
  /** Distinct lexical surface forms, excluding presentational horizontal whitespace. */
  readonly surfaces: readonly string[];
  /** Original context HTML with only `occurrences` wrapped in `<mark>`. */
  readonly markedHTML: string;
}

/**
 * Finds and marks the exact occurrences of an already-selected JMDict spelling in HTML context.
 *
 * Lookup and markup share one canonical rendered-text projection, so an identical surface used as
 * another lexical item remains unmarked. Returns `null` when the spelling has no deterministically
 * supported occurrence. The supplied HTML must be a trusted, sanitized fragment without `<mark>`.
 */
export async function resolveContextTarget(
  contextHTML: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): Promise<ResolvedContextTarget | null> {
  const renderedText = contextRenderedText(contextHTML);
  // Ebook and Anki HTML sometimes insert presentational spaces inside a word. Resolve against a
  // whitespace-free lookup view, then map every selected occurrence back to the canonical text.
  // Newlines remain significant, so a target can never cross a `<br>` or block boundary.
  const projection = lookupProjection(renderedText);
  const lookupOccurrences = await findSurfaceFormOccurrencesForLookupSpelling(
    projection.text,
    lookupSpelling,
    options,
  );
  if (lookupOccurrences.length === 0) return null;
  const occurrences = lookupOccurrences.map((occurrence) =>
    projectOccurrenceToRenderedText(occurrence, projection, renderedText)
  );

  return {
    lookupSpelling,
    renderedText,
    occurrences,
    surfaces: [...new Set(lookupOccurrences.map(({ surface }) => surface))],
    markedHTML: markContextTargetOccurrences(contextHTML, occurrences),
  };
}
