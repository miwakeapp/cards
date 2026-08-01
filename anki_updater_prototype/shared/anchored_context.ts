import { markContextTargets } from "card_resolution";
import { resolveSafeContextTarget } from "./mark_resolved_context.ts";

function normalizedTextWithRawRanges(text: string): {
  normalized: string;
  rawRanges: Array<{ start: number; end: number }>;
} {
  let normalized = "";
  const rawRanges: Array<{ start: number; end: number }> = [];
  for (let rawIndex = 0; rawIndex < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(rawIndex)!);
    const end = rawIndex + character.length;
    if (!/\s/v.test(character)) {
      normalized += character;
      for (let index = 0; index < character.length; ++index) {
        rawRanges.push({ start: rawIndex, end });
      }
    }
    rawIndex = end;
  }
  return { normalized, rawRanges };
}

function targetBearingAnchor(fullContext: string, surfaces: readonly string[]): string {
  const positions = surfaces.flatMap((surface) => {
    const values: number[] = [];
    for (
      let index = fullContext.indexOf(surface);
      index !== -1;
      index = fullContext.indexOf(surface, index + 1)
    ) {
      values.push(index, index + surface.length);
    }
    return values;
  });
  if (positions.length === 0) return fullContext;
  const start = Math.max(0, Math.min(...positions) - 30);
  const end = Math.min(fullContext.length, Math.max(...positions) + 30);
  return fullContext.slice(start, end).replace(/^…+|…+$/gu, "");
}

function anchoredRawRange(
  evidenceContext: string,
  fullContextAnchor: string,
  surfaces: readonly string[],
): { start: number; end: number } {
  const evidence = normalizedTextWithRawRanges(evidenceContext);
  const fullContext = normalizedTextWithRawRanges(fullContextAnchor).normalized;
  const anchors = [
    fullContext,
    ...fullContext.split(/…+/gu).filter((part) =>
      surfaces.some((surface) => part.includes(surface))
    ),
    targetBearingAnchor(fullContext, surfaces),
  ].filter((anchor, index, values) => anchor !== "" && values.indexOf(anchor) === index);
  const anchor = anchors.find((value) => evidence.normalized.includes(value));
  if (anchor === undefined) {
    throw new Error("Could not locate accepted Full context within wider sense-selection evidence");
  }
  const normalizedStart = evidence.normalized.indexOf(anchor);
  const normalizedEnd = normalizedStart + anchor.length;
  return {
    start: evidence.rawRanges[normalizedStart].start,
    end: evidence.rawRanges[normalizedEnd - 1].end,
  };
}

/**
 * Marks an explicitly audited surface at every occurrence inside accepted Full context.
 *
 * Use only when no dictionary spelling can reproduce an AI-reviewed source artifact. Ordinary
 * JMDict targets must use `markResolvedContextTargetWithinAnchor()` instead.
 */
export function markAuditedContextTargetWithinAnchor(
  evidenceContext: string,
  fullContextAnchor: string,
  surfaces: readonly [string, ...string[]],
): string {
  const range = anchoredRawRange(evidenceContext, fullContextAnchor, surfaces);
  const selectedContext = evidenceContext.slice(range.start, range.end);
  return evidenceContext.slice(0, range.start) + markContextTargets(selectedContext, surfaces) +
    evidenceContext.slice(range.end);
}

/** Resolves and marks the target only inside accepted Full context within wider plain-text evidence. */
export async function markResolvedContextTargetWithinAnchor(
  evidenceContext: string,
  fullContextAnchor: string,
  recognitionTarget: string,
  partOfSpeech: readonly string[],
): Promise<string> {
  const fullContextResolution = await resolveSafeContextTarget(
    fullContextAnchor,
    recognitionTarget,
    partOfSpeech,
  );
  const surfaces = fullContextResolution.surfaces;
  const range = anchoredRawRange(evidenceContext, fullContextAnchor, surfaces);
  const selectedContext = evidenceContext.slice(range.start, range.end);
  const selectedResolution = await resolveSafeContextTarget(
    selectedContext,
    recognitionTarget,
    partOfSpeech,
  );
  return evidenceContext.slice(0, range.start) + selectedResolution.markedHTML +
    evidenceContext.slice(range.end);
}
