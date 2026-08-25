import {
  contextRenderedText,
  markContextTargetOccurrences,
  projectMarkedContext,
} from "./context.ts";
import { markedContextTextTemplate } from "./minimization.ts";
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

interface MarkedContextProjection {
  text: string;
  occurrences: Array<RenderedTextOccurrence & { id: number }>;
}

interface RenderedTextResolution {
  occurrences: RenderedTextOccurrence[];
  surfaces: string[];
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

async function resolveRenderedTextTarget(
  renderedText: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions,
): Promise<RenderedTextResolution> {
  // Ebook and Anki HTML sometimes insert presentational spaces inside a word. Resolve against a
  // whitespace-free lookup view, then map every selected occurrence back to the canonical text.
  // Newlines remain significant, so a target can never cross a `<br>` or block boundary.
  const projection = lookupProjection(renderedText);
  const lookupOccurrences = await findSurfaceFormOccurrencesForLookupSpelling(
    projection.text,
    lookupSpelling,
    options,
  );
  return {
    occurrences: lookupOccurrences.map((occurrence) =>
      projectOccurrenceToRenderedText(occurrence, projection, renderedText)
    ),
    surfaces: [...new Set(lookupOccurrences.map(({ surface }) => surface))],
  };
}

function markedContextProjection(markedHTML: string): MarkedContextProjection {
  const template = markedContextTextTemplate(markedHTML, { stripAnkiFurigana: true });
  let text = "";
  let sourceIndex = 0;
  const occurrences = template.targets.map(({ id, surface: annotatedSurface }) => {
    const openingSentinel = `⟪target:${id}⟫`;
    const closingSentinel = `⟪/target:${id}⟫`;
    const targetStart = template.text.indexOf(openingSentinel, sourceIndex);
    const targetEnd = template.text.indexOf(closingSentinel, targetStart + openingSentinel.length);
    if (targetStart === -1 || targetEnd === -1) {
      throw new Error(`Marked context target ${id} is missing from its rendered text`);
    }
    text += template.text.slice(sourceIndex, targetStart);
    const surface = annotatedSurface;
    const start = text.length;
    text += surface;
    const end = text.length;
    sourceIndex = targetEnd + closingSentinel.length;
    return { id, start, end, surface };
  });
  text += template.text.slice(sourceIndex);
  return { text, occurrences };
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
  const resolved = await resolveRenderedTextTarget(renderedText, lookupSpelling, options);
  if (resolved.occurrences.length === 0) return null;

  return {
    lookupSpelling,
    renderedText,
    occurrences: resolved.occurrences,
    surfaces: resolved.surfaces,
    markedHTML: markContextTargetOccurrences(contextHTML, resolved.occurrences),
  };
}

function oneRangeContainsTheOther(
  left: RenderedTextOccurrence,
  right: RenderedTextOccurrence,
): boolean {
  return (left.start <= right.start && right.end <= left.end) ||
    (right.start <= left.start && left.end <= right.end);
}

/**
 * Resolves the lexical target identified by historical, potentially inexact target marks.
 *
 * Existing cards sometimes mark an entire multiple-choice answer around a shorter lexical target,
 * or only the answer fragment within a longer inflected form. A supported occurrence is anchored
 * only when its range contains, or is contained by, an existing mark. The returned HTML removes
 * the historical marks and wraps the complete supported occurrences instead, for prompt use only;
 * callers can preserve the stored HTML unchanged. Returns `null` when no mark anchors the supplied
 * spelling. The input's rendered text must already represent any display-only Anki furigana as its
 * visible surface.
 */
export async function resolveMarkedContextTarget(
  markedContextHTML: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): Promise<ResolvedContextTarget | null> {
  const projected = projectMarkedContext(markedContextHTML);
  const supported = await resolveRenderedTextTarget(
    projected.renderedText,
    lookupSpelling,
    { ...options, requireExactKanaScript: true },
  );
  const anchoredOccurrences = supported.occurrences.filter((occurrence) =>
    projected.targetOccurrences.some((target) => oneRangeContainsTheOther(occurrence, target))
  );
  if (anchoredOccurrences.length === 0) return null;

  const unmarkedRenderedText = contextRenderedText(projected.unmarkedHTML);
  if (unmarkedRenderedText !== projected.renderedText) {
    throw new Error("Removing context target marks unexpectedly changed the rendered text");
  }

  return {
    lookupSpelling,
    renderedText: projected.renderedText,
    occurrences: anchoredOccurrences,
    surfaces: [...new Set(anchoredOccurrences.map(({ surface }) => surface))],
    markedHTML: markContextTargetOccurrences(projected.unmarkedHTML, anchoredOccurrences),
  };
}

/**
 * Verifies that every existing target mark is supported by canonical context resolution.
 *
 * This is the stored-context counterpart to `resolveContextTarget()`: acquisition workflows use
 * the latter to create marks, while workflows consuming an existing Miwake Card can use this
 * function to reject stale or malformed target ranges before semantic processing. Anki bracket
 * readings are ignored, matching their display-only role. Every marked range must resolve to the
 * supplied JMDict spelling without changing its hiragana/katakana orthography; unmarked supported
 * occurrences are permitted because this function verifies supplied marks rather than rewriting
 * user data.
 */
export async function verifyMarkedContextTarget(
  markedContextHTML: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): Promise<void> {
  const marked = markedContextProjection(markedContextHTML);
  const supported = await resolveRenderedTextTarget(
    marked.text,
    lookupSpelling,
    { ...options, requireExactKanaScript: true },
  );
  const supportedRanges = new Set(
    supported.occurrences.map(({ start, end }) => `${start}:${end}`),
  );

  for (const occurrence of marked.occurrences) {
    if (!supportedRanges.has(`${occurrence.start}:${occurrence.end}`)) {
      throw new Error(
        `Marked context target ${occurrence.id} has surface ${
          JSON.stringify(occurrence.surface)
        }, ` +
          `which is not a deterministically supported exact-script occurrence of lookupSpelling ${
            JSON.stringify(lookupSpelling)
          }`,
      );
    }
  }
}
