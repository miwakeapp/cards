import { unescape } from "@std/html/entities";

/** Plain-text length above which the generator asks AI for a minimized context. */
export const MINIMIZED_CONTEXT_LENGTH_THRESHOLD = 50;

function normalizeContextForComparison(context: string): string {
  const text = context
    .replace(/<rt(?:\s[^>]*)?>.*?<\/rt>/gisu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/\[[^\]]+\]/gu, "");
  return unescape(text).replace(/\s+/gu, "");
}

/** Whether a context crosses the AI-minimization threshold. */
export function needsAIMinimizedContext(context: string): boolean {
  return [...normalizeContextForComparison(context)].length > MINIMIZED_CONTEXT_LENGTH_THRESHOLD;
}
