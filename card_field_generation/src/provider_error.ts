const AI_QUOTA_ERROR_PATTERN =
  /(?:spend-based rate limit|insufficient_quota|credit balance is too low|exceeded your current quota.{0,120}\b(?:billing|plan)\b|billing (?:account|quota)[^.]*\b(?:disabled|exhausted|required)\b|payment required)/isu;

function errorText(error: unknown, seen = new Set<unknown>()): string {
  if (typeof error === "string") return error;
  if (error === null || typeof error !== "object" || seen.has(error)) return String(error ?? "");
  seen.add(error);
  if (error instanceof Error) {
    return `${error.name}: ${error.message} ${errorText(error.cause, seen)}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Whether an AI provider error means new requests cannot succeed until billing or credit changes.
 *
 * This deliberately excludes generic HTTP 429, `RESOURCE_EXHAUSTED`, and per-minute quota text.
 * The AI SDK retries provider-declared transient failures with exponential backoff; treating those
 * as permanent here would instead abort an entire eval run after the SDK's bounded retries.
 */
export function isAIQuotaError(error: unknown): boolean {
  return AI_QUOTA_ERROR_PATTERN.test(errorText(error));
}
