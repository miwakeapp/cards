import { unescape } from "@std/html/entities";

/** Plain-text length above which the canonical AI prompt requests a minimized context. */
export const MINIMIZED_CONTEXT_LENGTH_THRESHOLD = 50;

function normalizeContextForComparison(context: string): string {
  const text = context
    .replace(/<rt(?:\s[^>]*)?>.*?<\/rt>/gis, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[[^\]]+\]/g, "");
  return unescape(text).replace(/\s+/g, "");
}

/** Whether a context crosses the canonical AI minimization threshold. */
export function needsAIMinimizedContext(context: string): boolean {
  return [...normalizeContextForComparison(context)].length > MINIMIZED_CONTEXT_LENGTH_THRESHOLD;
}

/** Drops an empty or substantively identical AI-minimized context. */
export function normalizeMinimizedContext(
  fullContext: string,
  minimizedContext: string | null,
): string | null {
  if (minimizedContext === null) return null;

  const normalizedFull = normalizeContextForComparison(fullContext);
  const normalizedMinimized = normalizeContextForComparison(minimizedContext);
  return normalizedMinimized === "" || normalizedMinimized === normalizedFull
    ? null
    : minimizedContext;
}
