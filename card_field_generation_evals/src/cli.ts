import type { EvalCacheMode } from "./types.ts";

const CACHE_MODES: readonly EvalCacheMode[] = ["use", "refresh", "bypass"];

/**
 * Maximum corrective provider attempts for an ordinary cache-using run.
 *
 * This deliberately accommodates the package's complete production-configuration corpus while
 * still stopping accidental model/effort matrix expansion. A cold cache can make every such slot
 * a paid provider call.
 */
export const MAX_CACHE_USING_PROVIDER_ATTEMPTS = 750;

/** Maximum model/case breadth for an ordinary cache-using run. */
export const MAX_CACHE_USING_PROVIDER_CALL_SLOTS = 250;

/**
 * Maximum corrective provider attempts when completed results will definitely not be read.
 *
 * `refresh` and `bypass` necessarily call a provider for every selected slot, so they have a
 * smaller non-interactive allowance sized for focused development samples.
 */
export const MAX_UNCACHED_PROVIDER_ATTEMPTS = 150;

/** Maximum model/case breadth when completed results will definitely not be read. */
export const MAX_UNCACHED_PROVIDER_CALL_SLOTS = 50;

/** Parses the completed-result cache policy exposed by the eval CLI. */
export function parseEvalCacheMode(raw: string | undefined): EvalCacheMode {
  if (raw === undefined) return "use";
  if (!CACHE_MODES.includes(raw as EvalCacheMode)) {
    throw new Error(
      `Unknown cache mode ${JSON.stringify(raw)}; expected ${CACHE_MODES.join(", ")}`,
    );
  }
  return raw as EvalCacheMode;
}

/** Inputs to the eval CLI's non-interactive provider-spending guard. */
export interface EvalSpendingGuardOptions {
  providerCallSlots: number;
  maxAttempts: number;
  cacheMode: EvalCacheMode;
  dryRun: boolean;
  allowExpensiveRun: boolean;
}

/**
 * Refuses unexpectedly broad paid eval plans unless the operator explicitly approves them.
 *
 * Dry runs are always permitted so an operator can inspect the complete matrix before deciding
 * whether to pass `--allow-expensive-run`.
 */
export function assertEvalSpendingApproved(options: EvalSpendingGuardOptions): void {
  if (!Number.isSafeInteger(options.providerCallSlots) || options.providerCallSlots < 0) {
    throw new RangeError(
      `providerCallSlots must be a nonnegative safe integer; received ${options.providerCallSlots}`,
    );
  }
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RangeError(
      `maxAttempts must be a positive safe integer; received ${options.maxAttempts}`,
    );
  }
  if (options.dryRun || options.allowExpensiveRun) return;

  const maximumProviderAttempts = options.providerCallSlots * options.maxAttempts;
  if (!Number.isSafeInteger(maximumProviderAttempts)) {
    throw new RangeError(
      `providerCallSlots * maxAttempts must be a safe integer; received ${options.providerCallSlots} * ${options.maxAttempts}`,
    );
  }
  const attemptLimit = options.cacheMode === "use"
    ? MAX_CACHE_USING_PROVIDER_ATTEMPTS
    : MAX_UNCACHED_PROVIDER_ATTEMPTS;
  const slotLimit = options.cacheMode === "use"
    ? MAX_CACHE_USING_PROVIDER_CALL_SLOTS
    : MAX_UNCACHED_PROVIDER_CALL_SLOTS;

  const cacheExplanation = options.cacheMode === "use"
    ? "A cold cache can still make every selected slot a paid provider call."
    : `Cache mode ${
      JSON.stringify(options.cacheMode)
    } necessarily calls a provider for every selected slot.`;
  if (options.providerCallSlots > slotLimit) {
    throw new Error(
      `Refusing ${options.providerCallSlots} model/case provider-call slots without explicit spending approval; the limit for cache mode ${
        JSON.stringify(options.cacheMode)
      } is ${slotLimit}. ${cacheExplanation} Narrow the plan with --sample, --operation, or --case; inspect it with --dry-run; or rerun with --allow-expensive-run after review.`,
    );
  }
  if (maximumProviderAttempts <= attemptLimit) return;
  throw new Error(
    `Refusing up to ${maximumProviderAttempts} provider attempts (${options.providerCallSlots} model/case slots × ${options.maxAttempts} corrective attempts) without explicit spending approval; the limit for cache mode ${
      JSON.stringify(options.cacheMode)
    } is ${attemptLimit}. ${cacheExplanation} Lower --max-attempts or narrow the plan with --sample, --operation, or --case; inspect it with --dry-run; or rerun with --allow-expensive-run after review.`,
  );
}
