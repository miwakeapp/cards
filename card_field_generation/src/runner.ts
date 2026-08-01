import {
  generateText,
  type ModelMessage,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type ProviderMetadata,
} from "ai";
import type { z } from "zod";
import { canonicalGenerationJSON, type GenerationCache, generationCacheKey } from "./cache.ts";
import {
  type CachedGenerationMetadata,
  completedGenerationCacheRecord,
  completedGenerationIsCompatible,
  type GenerationAttempt,
  type GenerationFingerprints,
  type GenerationRequestIdentity,
  generationRequestIdentity,
  parseCompletedGenerationCacheRecord,
} from "./completed_result_cache.ts";
import {
  type ModelConfiguration,
  modelConfiguration,
  type ModelId,
  type ReasoningEffort,
} from "./models.ts";
import {
  coordinatePromptCacheWarmup,
  messagesWithPromptCacheBreakpoint,
  requestProviderOptions,
} from "./prompt_cache.ts";
import {
  addGenerationUsage,
  EMPTY_GENERATION_USAGE,
  type GenerationUsage,
  generationUsageFromAI,
} from "./usage.ts";

export type {
  CachedGenerationMetadata,
  GenerationAttempt,
  GenerationFingerprints,
} from "./completed_result_cache.ts";

/** A single, independently cacheable structured-generation operation. */
export interface GenerationOperation<Input, RawOutput, Value> {
  /** Stable operation name used in reports and cache keys. */
  name: string;

  /**
   * Increment only for validation semantics not already represented by the prompt or schema.
   *
   * This version is retained in provenance and isolates concurrent calls using different
   * validators. It does not invalidate completed raw model output: cache hits are always parsed and
   * revalidated, so a now-invalid result safely falls through to fresh generation.
   */
  validationVersion: number;

  /** Stable instructions shared by every input to this operation. */
  system: string;

  /** Structured model-output schema. */
  outputSchema: z.ZodType<RawOutput>;

  /** Builds stable few-shot messages followed by the variable request. */
  messages(input: Input): ModelMessage[] | Promise<ModelMessage[]>;

  /** Number of leading messages which are identical for every input. */
  stableMessageCount: number;

  /** Applies operation-specific semantic validation and canonicalization. */
  validate(input: Input, output: RawOutput): Value;

  /** Evaluated production model used when the caller does not override it. */
  defaultModelId?: ModelId;

  /** Evaluated reasoning effort used when the caller does not override it. */
  defaultReasoningEffort?: ReasoningEffort;

  /** Small output bound appropriate to the operation. */
  maxOutputTokens?: number;
}

/** Metadata returned with every validated generated value. */
export interface GenerationMetadata {
  /** Stable operation name. */
  operation: string;
  /** Content-addressed cache key for this exact request. */
  cacheKey: string;
  /** Whether this invocation paid for generation, hit its result cache, or joined an in-flight call. */
  cacheStatus: "hit" | "miss" | "shared";
  /** Stable model-and-settings identity. */
  modelConfigurationId: string;
  /** Concrete model reported by the provider, when available. */
  responseModelId?: string;
  /** Paid structured-generation rounds made by this invocation; empty for cache and in-flight hits. */
  attempts: readonly GenerationAttempt[];
  /** End-to-end latency including result-cache access and retries. */
  latencyMilliseconds: number;
  /** Incremental token usage incurred by this invocation; zero for cache and in-flight hits. */
  usage: GenerationUsage;

  /** Usage of the provider generation which originally produced this value. */
  sourceUsage: GenerationUsage;

  /** Stable hashes of the exact prompt, schema, and effective request configuration. */
  fingerprints: GenerationFingerprints;

  /** Paid provenance of the result returned by a cache or in-flight hit. */
  sourceGeneration?: CachedGenerationMetadata;

  /** Non-fatal failures from best-effort cache persistence or attempt observers. */
  sideEffectErrors?: readonly GenerationSideEffectError[];
}

/** A best-effort side effect which failed after or while preserving paid generation work. */
export interface GenerationSideEffectError {
  /** Best-effort integration point which failed. */
  source: "cache" | "onAttempt";
  /** Human-readable error reported by that integration point. */
  message: string;
}

/** A validated generated value and the information needed to audit its cost and provenance. */
export interface GenerationResult<Value> {
  /** Operation-specific value after deterministic validation and canonicalization. */
  value: Value;
  /** Cache, cost, latency, retry, and provider provenance. */
  metadata: GenerationMetadata;
}

/** Runtime controls shared by every generation operation. */
export interface GenerationOptions {
  /** Provider model preset. Defaults to the operation's configured production model. */
  modelId?: ModelId;

  /** Provider reasoning effort. Defaults to the operation's configured production setting. */
  reasoningEffort?: ReasoningEffort;

  /** Optional completed-result cache shared across operations and process runs. */
  cache?: GenerationCache;

  /**
   * Completed-result cache policy. Defaults to `"use"`.
   *
   * `"refresh"` skips an existing completed result and replaces it after successful generation.
   * `"bypass"` neither reads nor writes completed results. Provider prompt caching remains enabled
   * for every mode because it only discounts otherwise-required model requests.
   */
  cacheMode?: "bypass" | "refresh" | "use";

  /**
   * Maximum structured-generation rounds after feeding validation failures back to the model.
   * Defaults to 3. Each round uses the AI SDK's own bounded transient-provider retry policy.
   */
  maxAttempts?: number;

  /**
   * Best-effort observer which receives each paid structured-generation round as soon as it
   * completes. Observer failures are reported in `metadata.sideEffectErrors` and do not discard a
   * valid paid result.
   */
  onAttempt?: (attempt: GenerationAttempt) => void | Promise<void>;
}

/** Failure after every allowed corrective round produced invalid model output. */
export class GenerationAttemptsExhaustedError extends AggregateError {
  /** Every paid corrective round, including rejected output and token usage when available. */
  readonly attempts: readonly GenerationAttempt[];
  /** Aggregate provider-reported usage across `attempts`. */
  readonly usage: GenerationUsage;
  /** Non-fatal observer failures which occurred while reporting the rejected rounds. */
  readonly sideEffectErrors: readonly GenerationSideEffectError[];

  /** Creates an auditable terminal failure from all exhausted corrective rounds. */
  constructor(
    operation: string,
    modelConfigurationId: string,
    errors: readonly unknown[],
    attempts: readonly GenerationAttempt[],
    sideEffectErrors: readonly GenerationSideEffectError[],
  ) {
    const lastError = errors.at(-1);
    super(
      errors,
      `${operation} failed deterministic validation after ${attempts.length} attempts using ${modelConfigurationId}: ${
        errorMessage(lastError)
      }`,
    );
    this.name = "GenerationAttemptsExhaustedError";
    this.attempts = structuredClone(attempts);
    this.usage = attempts.reduce(
      (total, attempt) => addGenerationUsage(total, attempt.usage),
      { ...EMPTY_GENERATION_USAGE },
    );
    this.sideEffectErrors = structuredClone(sideEffectErrors);
  }
}

interface GenerationPreparation {
  model: ModelConfiguration;
  baseMessages: ModelMessage[];
  requestIdentity: GenerationRequestIdentity;
  inputFingerprint?: string;
  cached: unknown;
}

interface FreshGeneration<RawOutput, Value> {
  rawOutput: RawOutput;
  result: GenerationResult<Value>;
  provenance: CachedGenerationMetadata;
}

const IN_FLIGHT_GENERATIONS = new Map<string, Promise<FreshGeneration<unknown, unknown>>>();
// Model resolution, cryptographic fingerprints, and result-cache reads all yield. Share that
// preparation from a synchronously computed identity so a fast provider response cannot finish
// before a concurrent identical caller reaches `IN_FLIGHT_GENERATIONS`.
const GENERATION_PREPARATIONS = new Map<string, Promise<GenerationPreparation>>();
const OPERATION_SCOPE_IDS = new WeakMap<object, number>();
const MODEL_SCOPE_IDS = new WeakMap<object, number>();
let nextOperationScopeId = 1;
let nextModelScopeId = 1;
const CACHE_SCOPE_IDS = new WeakMap<object, number>();
let nextCacheScopeId = 1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCorrectableModelOutputError(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error);
}

function cacheMode(options: GenerationOptions): NonNullable<GenerationOptions["cacheMode"]> {
  const mode = options.cacheMode ?? "use";
  if (mode !== "use" && mode !== "refresh" && mode !== "bypass") {
    throw new RangeError(`cacheMode must be "use", "refresh", or "bypass"; received ${mode}`);
  }
  return mode;
}

function cacheScope(cache: GenerationCache | undefined, mode: string): string {
  if (mode === "bypass") return "bypass";
  if (cache === undefined) return "no-cache";
  let id = CACHE_SCOPE_IDS.get(cache);
  if (id === undefined) {
    id = nextCacheScopeId++;
    CACHE_SCOPE_IDS.set(cache, id);
  }
  return `cache-${id}`;
}

function operationScopeId(operation: object): number {
  let id = OPERATION_SCOPE_IDS.get(operation);
  if (id === undefined) {
    id = nextOperationScopeId++;
    OPERATION_SCOPE_IDS.set(operation, id);
  }
  return id;
}

function modelScope(
  operation: GenerationOperation<unknown, unknown, unknown>,
  options: GenerationOptions,
  modelOverride: ModelConfiguration | undefined,
): unknown {
  if (modelOverride === undefined) {
    return {
      modelId: options.modelId ?? operation.defaultModelId,
      reasoningEffort: options.reasoningEffort ?? operation.defaultReasoningEffort,
    };
  }
  let id = MODEL_SCOPE_IDS.get(modelOverride);
  if (id === undefined) {
    id = nextModelScopeId++;
    MODEL_SCOPE_IDS.set(modelOverride, id);
  }
  return { override: id };
}

function generationPreparationKey<Input, RawOutput, Value>(
  operation: GenerationOperation<Input, RawOutput, Value>,
  input: Input,
  options: GenerationOptions,
  modelOverride: ModelConfiguration | undefined,
  mode: NonNullable<GenerationOptions["cacheMode"]>,
  maxAttempts: number,
): string | undefined {
  try {
    return canonicalGenerationJSON({
      operation: operationScopeId(operation),
      input,
      model: modelScope(
        operation as GenerationOperation<unknown, unknown, unknown>,
        options,
        modelOverride,
      ),
      cache: cacheScope(options.cache, mode),
      mode,
      maxAttempts,
    });
  } catch {
    // Non-JSON inputs cannot safely share validation and retry state. They can still run normally,
    // but each invocation prepares and generates independently.
    return undefined;
  }
}

async function prepareGeneration<Input, RawOutput, Value>(
  operation: GenerationOperation<Input, RawOutput, Value>,
  input: Input,
  baseMessages: ModelMessage[],
  options: GenerationOptions,
  modelOverride: ModelConfiguration | undefined,
  mode: NonNullable<GenerationOptions["cacheMode"]>,
  maxOutputTokens: number,
): Promise<GenerationPreparation> {
  let model = modelOverride;
  if (model === undefined) {
    const configuredModelId = options.modelId ?? operation.defaultModelId;
    if (configuredModelId === undefined) {
      throw new Error(
        `No model is configured for generation operation ${
          JSON.stringify(operation.name)
        }; provide modelOverride, pass GenerationOptions.modelId, or set GenerationOperation.defaultModelId`,
      );
    }
    model = await modelConfiguration(
      configuredModelId,
      options.reasoningEffort ?? operation.defaultReasoningEffort,
    );
  }
  const [requestIdentity, inputFingerprint] = await Promise.all([
    generationRequestIdentity(
      operation,
      model,
      baseMessages,
      maxOutputTokens,
    ),
    generationCacheKey(input).catch(() => undefined),
  ]);
  let cached: unknown;
  if (mode === "use" && options.cache !== undefined) {
    cached = await options.cache.get(requestIdentity.cacheKey);
  }
  return {
    model,
    baseMessages,
    requestIdentity,
    inputFingerprint,
    cached,
  };
}

function inFlightKey(
  cache: GenerationCache | undefined,
  mode: string,
  requestKey: string,
  inputFingerprint: string | undefined,
  maxAttempts: number,
  validationVersion: number,
): string | undefined {
  return inputFingerprint === undefined
    ? undefined
    : `${
      cacheScope(cache, mode)
    }:${mode}:${maxAttempts}:${validationVersion}:${requestKey}:${inputFingerprint}`;
}

function retryMessages(
  base: readonly ModelMessage[],
  rejectedAssistantResponse: string | undefined,
  validationError: string,
): ModelMessage[] {
  return [
    ...base,
    ...(rejectedAssistantResponse === undefined
      ? []
      : [{ role: "assistant" as const, content: rejectedAssistantResponse }]),
    {
      role: "user",
      content:
        `The previous response failed deterministic validation: ${validationError}\nCorrect only that problem and return a new structured response.`,
    },
  ];
}

/**
 * Runs one structured operation with content-addressed caching and validation-aware retries.
 *
 * Only validated successes are cached. A rejected structured response and its validator error are
 * included in the next attempt, so retries are corrective rather than duplicate API calls.
 */
export async function runGeneration<Input, RawOutput, Value>(
  operation: GenerationOperation<Input, RawOutput, Value>,
  input: Input,
  options: GenerationOptions,
  modelOverride?: ModelConfiguration,
): Promise<GenerationResult<Value>> {
  // An invocation can yield while resolving its model, hashing its request, or reading its cache.
  // Isolate the operation from caller mutations before any of those awaits so prompt construction,
  // single-flight identity, cached-output validation, retries, and fresh-output validation all see
  // one consistent input and one consistent set of options.
  const inputSnapshot = structuredClone(input);
  const optionsSnapshot: GenerationOptions = {
    modelId: options.modelId,
    reasoningEffort: options.reasoningEffort,
    cache: options.cache,
    cacheMode: options.cacheMode,
    maxAttempts: options.maxAttempts,
    onAttempt: options.onAttempt,
  };
  const startedAt = performance.now();
  const resolvedCacheMode = cacheMode(optionsSnapshot);
  const maxAttempts = optionsSnapshot.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer; received ${maxAttempts}`);
  }
  if (!Number.isSafeInteger(operation.validationVersion) || operation.validationVersion < 1) {
    throw new RangeError(
      `GenerationOperation.validationVersion must be a positive integer; received ${operation.validationVersion}`,
    );
  }
  const baseMessages = await operation.messages(inputSnapshot);
  if (
    !Number.isSafeInteger(operation.stableMessageCount) || operation.stableMessageCount < 0 ||
    operation.stableMessageCount > baseMessages.length
  ) {
    throw new RangeError(
      `GenerationOperation.stableMessageCount must be a safe integer between 0 and messages.length; received ${operation.stableMessageCount} for ${baseMessages.length} messages`,
    );
  }
  const maxOutputTokens = operation.maxOutputTokens ?? 1024;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new RangeError(
      `GenerationOperation.maxOutputTokens must be a positive safe integer; received ${maxOutputTokens}`,
    );
  }
  const preparationKey = generationPreparationKey(
    operation,
    inputSnapshot,
    optionsSnapshot,
    modelOverride,
    resolvedCacheMode,
    maxAttempts,
  );
  let ownsPreparation = false;
  let preparation = preparationKey === undefined
    ? undefined
    : GENERATION_PREPARATIONS.get(preparationKey);
  if (preparation === undefined) {
    preparation = prepareGeneration(
      operation,
      inputSnapshot,
      baseMessages,
      optionsSnapshot,
      modelOverride,
      resolvedCacheMode,
      maxOutputTokens,
    );
    if (preparationKey !== undefined) {
      ownsPreparation = true;
      GENERATION_PREPARATIONS.set(preparationKey, preparation);
    }
  }

  try {
    const prepared = await preparation;
    const { model, requestIdentity, cached } = prepared;
    const { cacheKey: key, fingerprints } = requestIdentity;
    const cachedRecord = parseCompletedGenerationCacheRecord(cached);
    if (
      cachedRecord !== undefined &&
      completedGenerationIsCompatible(
        cachedRecord,
        model.id,
        fingerprints,
        operation.validationVersion,
      )
    ) {
      const parsed = operation.outputSchema.safeParse(cachedRecord.rawOutput);
      if (parsed.success) {
        try {
          const value = operation.validate(inputSnapshot, parsed.data);
          const sourceGeneration = structuredClone(cachedRecord.provenance);
          return {
            value,
            metadata: {
              operation: operation.name,
              cacheKey: key,
              cacheStatus: "hit",
              modelConfigurationId: model.id,
              responseModelId: cachedRecord.responseModelId,
              attempts: [],
              latencyMilliseconds: performance.now() - startedAt,
              usage: { ...EMPTY_GENERATION_USAGE },
              sourceUsage: { ...sourceGeneration.usage },
              fingerprints,
              sourceGeneration,
            },
          };
        } catch {
          // A stricter validator may invalidate an older record with the same prompt/schema. Repair
          // it through a fresh request and append the new validated value to the cache.
        }
      }
    }

    const sharedKey = inFlightKey(
      optionsSnapshot.cache,
      resolvedCacheMode,
      key,
      prepared.inputFingerprint,
      maxAttempts,
      operation.validationVersion,
    );
    const existing = sharedKey === undefined ? undefined : IN_FLIGHT_GENERATIONS.get(sharedKey);
    if (existing !== undefined) {
      const shared = await existing as FreshGeneration<RawOutput, Value>;
      // Re-run canonicalization for this caller instead of sharing a mutable `Value` instance.
      const value = operation.validate(inputSnapshot, structuredClone(shared.rawOutput));
      return {
        value,
        metadata: {
          operation: operation.name,
          cacheKey: key,
          cacheStatus: "shared",
          modelConfigurationId: model.id,
          responseModelId: shared.result.metadata.responseModelId,
          attempts: [],
          latencyMilliseconds: performance.now() - startedAt,
          usage: { ...EMPTY_GENERATION_USAGE },
          sourceUsage: { ...shared.provenance.usage },
          fingerprints,
          sourceGeneration: structuredClone(shared.provenance),
        },
      };
    }

    // Install the complete warmup-plus-generation promise before it can yield. Otherwise two
    // identical cold calls can both miss `IN_FLIGHT_GENERATIONS`; the second waits for the first to
    // warm the provider prefix, then redundantly starts the same paid generation.
    const generation = (async () => {
      const completePromptCacheWarmup = await coordinatePromptCacheWarmup(
        operation.stableMessageCount,
        model,
        fingerprints,
      );
      try {
        return await generateFresh({
          operation,
          input: inputSnapshot,
          model,
          baseMessages: prepared.baseMessages,
          key,
          fingerprints,
          cache: optionsSnapshot.cache,
          cacheMode: resolvedCacheMode,
          maxAttempts,
          onAttempt: optionsSnapshot.onAttempt,
          maxOutputTokens,
          onFirstProviderAttemptSettled: completePromptCacheWarmup,
          startedAt,
        });
      } finally {
        completePromptCacheWarmup?.(false);
      }
    })();
    if (sharedKey !== undefined) {
      IN_FLIGHT_GENERATIONS.set(
        sharedKey,
        generation as Promise<FreshGeneration<unknown, unknown>>,
      );
    }
    try {
      return (await generation).result;
    } finally {
      if (sharedKey !== undefined && IN_FLIGHT_GENERATIONS.get(sharedKey) === generation) {
        IN_FLIGHT_GENERATIONS.delete(sharedKey);
      }
    }
  } finally {
    if (
      ownsPreparation && preparationKey !== undefined &&
      GENERATION_PREPARATIONS.get(preparationKey) === preparation
    ) {
      GENERATION_PREPARATIONS.delete(preparationKey);
    }
  }
}

interface FreshGenerationParameters<Input, RawOutput, Value> {
  operation: GenerationOperation<Input, RawOutput, Value>;
  input: Input;
  model: ModelConfiguration;
  baseMessages: readonly ModelMessage[];
  key: string;
  fingerprints: GenerationFingerprints;
  cache: GenerationCache | undefined;
  cacheMode: NonNullable<GenerationOptions["cacheMode"]>;
  maxAttempts: number;
  maxOutputTokens: number;
  onAttempt: GenerationOptions["onAttempt"];
  onFirstProviderAttemptSettled: ((cachePrimed: boolean) => void) | undefined;
  startedAt: number;
}

async function generateFresh<Input, RawOutput, Value>(
  parameters: FreshGenerationParameters<Input, RawOutput, Value>,
): Promise<FreshGeneration<RawOutput, Value>> {
  const {
    operation,
    input,
    model,
    baseMessages,
    key,
    fingerprints,
    cache,
    cacheMode,
    maxAttempts,
    maxOutputTokens,
    onAttempt,
    onFirstProviderAttemptSettled,
    startedAt,
  } = parameters;
  const cacheableBaseMessages = messagesWithPromptCacheBreakpoint(
    baseMessages,
    operation.stableMessageCount,
    model,
  );
  const attempts: GenerationAttempt[] = [];
  const correctiveErrors: unknown[] = [];
  const sideEffectErrors: GenerationSideEffectError[] = [];
  let messages = cacheableBaseMessages;

  async function reportAttempt(attempt: GenerationAttempt): Promise<void> {
    try {
      await onAttempt?.(structuredClone(attempt));
    } catch (error) {
      sideEffectErrors.push({ source: "onAttempt", message: errorMessage(error) });
    }
  }

  for (let index = 0; index < maxAttempts; ++index) {
    const attemptStartedAt = performance.now();
    const promptFingerprint = await generationCacheKey({
      system: operation.system,
      messages,
    });
    let rawOutput: RawOutput;
    // This loop represents a provider call. Unless the response supplies usage below, zero is only
    // a lower bound; cache-hit and shared-call metadata use complete zero usage elsewhere.
    let usage: GenerationUsage = {
      ...EMPTY_GENERATION_USAGE,
      providerUsageIncomplete: true,
    };
    let responseModelId: string | undefined;
    let responseId: string | undefined;
    let providerMetadata: ProviderMetadata | undefined;
    try {
      const result = await generateText({
        model: model.model,
        output: Output.object({ schema: operation.outputSchema }),
        system: operation.system,
        messages,
        maxOutputTokens,
        providerOptions: requestProviderOptions(
          operation.stableMessageCount,
          model,
          fingerprints.stablePrompt,
        ),
        // Structured-output finalization can throw `NoOutputGeneratedError` after the provider
        // step has completed but before `generateText()` returns a result. Capture its telemetry at
        // the step boundary so a correctable retry does not discard usage or response provenance.
        onStepFinish(step) {
          usage = generationUsageFromAI(step.usage);
          responseModelId = step.response.modelId;
          responseId = step.response.id;
          providerMetadata = step.providerMetadata;
        },
      });
      onFirstProviderAttemptSettled?.(true);
      usage = generationUsageFromAI(result.usage);
      responseModelId = result.response.modelId;
      responseId = result.response.id;
      providerMetadata = result.providerMetadata;
      rawOutput = result.output;
    } catch (error) {
      onFirstProviderAttemptSettled?.(isCorrectableModelOutputError(error));
      if (NoObjectGeneratedError.isInstance(error)) {
        usage = generationUsageFromAI(error.usage);
        responseModelId = error.response?.modelId;
        responseId = error.response?.id;
      }
      const message = errorMessage(error);
      const correctable = isCorrectableModelOutputError(error);
      const rejectedOutput = NoObjectGeneratedError.isInstance(error) ? error.text : undefined;
      const attempt: GenerationAttempt = {
        number: index + 1,
        modelConfigurationId: model.id,
        ...(responseModelId === undefined ? {} : { responseModelId }),
        ...(responseId === undefined ? {} : { responseId }),
        promptFingerprint,
        latencyMilliseconds: performance.now() - attemptStartedAt,
        usage,
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
        ...(rejectedOutput === undefined ? {} : { rejectedOutput }),
        ...(correctable ? { validationError: message } : { requestError: message }),
      };
      attempts.push(attempt);
      await reportAttempt(attempt);
      if (!correctable) throw error;
      correctiveErrors.push(error);
      messages = retryMessages(cacheableBaseMessages, rejectedOutput, message);
      continue;
    }

    let value: Value;
    try {
      value = operation.validate(input, structuredClone(rawOutput));
    } catch (error) {
      correctiveErrors.push(error);
      const validationError = errorMessage(error);
      const attempt: GenerationAttempt = {
        number: index + 1,
        modelConfigurationId: model.id,
        ...(responseModelId === undefined ? {} : { responseModelId }),
        ...(responseId === undefined ? {} : { responseId }),
        promptFingerprint,
        latencyMilliseconds: performance.now() - attemptStartedAt,
        usage,
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
        validationError,
        rejectedOutput: structuredClone(rawOutput),
      };
      attempts.push(attempt);
      await reportAttempt(attempt);
      messages = retryMessages(
        cacheableBaseMessages,
        JSON.stringify(rawOutput),
        validationError,
      );
      continue;
    }

    const attempt: GenerationAttempt = {
      number: index + 1,
      modelConfigurationId: model.id,
      ...(responseModelId === undefined ? {} : { responseModelId }),
      ...(responseId === undefined ? {} : { responseId }),
      promptFingerprint,
      latencyMilliseconds: performance.now() - attemptStartedAt,
      usage,
      ...(providerMetadata === undefined ? {} : { providerMetadata }),
    };
    attempts.push(attempt);
    await reportAttempt(attempt);
    const provenance: CachedGenerationMetadata = {
      generatedAt: new Date().toISOString(),
      validationVersion: operation.validationVersion,
      attempts,
      latencyMilliseconds: performance.now() - startedAt,
      usage: attempts.reduce(
        (total, current) => addGenerationUsage(total, current.usage),
        { ...EMPTY_GENERATION_USAGE },
      ),
      fingerprints,
    };
    if (cacheMode !== "bypass") {
      try {
        await cache?.set(
          key,
          completedGenerationCacheRecord({
            rawOutput,
            modelConfigurationId: model.id,
            responseModelId,
            provenance,
          }),
        );
      } catch (error) {
        sideEffectErrors.push({ source: "cache", message: errorMessage(error) });
      }
    }
    const result: GenerationResult<Value> = {
      value,
      metadata: {
        operation: operation.name,
        cacheKey: key,
        cacheStatus: "miss",
        modelConfigurationId: model.id,
        responseModelId,
        attempts,
        latencyMilliseconds: performance.now() - startedAt,
        usage: { ...provenance.usage },
        sourceUsage: { ...provenance.usage },
        fingerprints,
        ...(sideEffectErrors.length === 0
          ? {}
          : { sideEffectErrors: structuredClone(sideEffectErrors) }),
      },
    };
    return { rawOutput, result, provenance };
  }

  throw new GenerationAttemptsExhaustedError(
    operation.name,
    model.id,
    correctiveErrors,
    attempts,
    sideEffectErrors,
  );
}
