import type { ModelMessage } from "ai";
import { z } from "zod";
import { generationCacheKey } from "./cache.ts";
import type { ModelConfiguration } from "./models.ts";
import { requestProviderOptions } from "./prompt_cache.ts";
import {
  addGenerationUsage,
  EMPTY_GENERATION_USAGE,
  type GenerationUsage,
  isGenerationUsage,
} from "./usage.ts";

/** Metadata for one structured-generation round, whether accepted or rejected by validation. */
export interface GenerationAttempt {
  /** One-based corrective-round number within this operation. */
  number: number;
  /** Stable model-and-settings identity used by the result cache. */
  modelConfigurationId: string;
  /** Concrete model reported by the provider, when available. */
  responseModelId?: string;
  /** Provider response identifier, when available. */
  responseId?: string;
  /** Fingerprint of the system prompt and messages submitted in this corrective round. */
  promptFingerprint: string;
  /** End-to-end latency for this paid round. */
  latencyMilliseconds: number;
  /** Provider-reported token usage for this round. */
  usage: GenerationUsage;
  /** Opaque provider-specific response metadata. */
  providerMetadata?: unknown;
  /** Deterministic validation failure supplied to the next corrective retry. */
  validationError?: string;
  /** Structured output or malformed provider text rejected by deterministic validation. */
  rejectedOutput?: unknown;
  /** Provider or transport failure after the AI SDK's bounded transient retries. */
  requestError?: string;
}

/** Stable content fingerprints which make a generation reproducible and auditable. */
export interface GenerationFingerprints {
  /** System prompt plus the operation's base messages, before corrective retries or cache annotations. */
  basePrompt: string;
  /** System prompt plus the operation's provider-cacheable stable message prefix. */
  stablePrompt: string;
  /** JSON Schema supplied for structured generation. */
  schema: string;
  /** Operation version, output bound, model, and effective provider settings. */
  configuration: string;
}

/** Paid provenance retained inside a completed result-cache entry. */
export interface CachedGenerationMetadata {
  /** When the validated result was originally generated. */
  generatedAt: string;

  /** Validator version which shaped any corrective retries. */
  validationVersion: number;

  /** Original structured-generation rounds, including corrective retries. */
  attempts: readonly GenerationAttempt[];

  /** Original end-to-end generation latency before cache persistence. */
  latencyMilliseconds: number;

  /** Original aggregate token usage. */
  usage: GenerationUsage;

  /** Stable hashes of the exact prompt, schema, and effective request configuration. */
  fingerprints: GenerationFingerprints;
}

/** Versioned value stored under a completed-result cache key. */
export interface CompletedGenerationCacheRecord {
  formatVersion: 1;
  rawOutput: unknown;
  modelConfigurationId: string;
  responseModelId?: string;
  provenance: CachedGenerationMetadata;
}

/** Content-addressed identity and audit fingerprints for the current request. */
export interface GenerationRequestIdentity {
  cacheKey: string;
  fingerprints: GenerationFingerprints;
}

interface CompletedResultRequestOperation<RawOutput> {
  name: string;
  validationVersion: number;
  system: string;
  outputSchema: z.ZodType<RawOutput>;
  stableMessageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isGenerationFingerprints(value: unknown): value is GenerationFingerprints {
  return isRecord(value) &&
    typeof value.basePrompt === "string" &&
    typeof value.stablePrompt === "string" &&
    typeof value.schema === "string" &&
    typeof value.configuration === "string";
}

function isGenerationAttempt(value: unknown): value is GenerationAttempt {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.number) && (value.number as number) >= 1 &&
    typeof value.modelConfigurationId === "string" &&
    (value.responseModelId === undefined || typeof value.responseModelId === "string") &&
    (value.responseId === undefined || typeof value.responseId === "string") &&
    typeof value.promptFingerprint === "string" &&
    isNonnegativeFiniteNumber(value.latencyMilliseconds) &&
    isGenerationUsage(value.usage) &&
    (value.validationError === undefined || typeof value.validationError === "string") &&
    (value.requestError === undefined || typeof value.requestError === "string");
}

function cachedProvenance(value: unknown): CachedGenerationMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const usage = value.usage;
  if (
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt)) ||
    !Number.isSafeInteger(value.validationVersion) ||
    (value.validationVersion as number) < 1 ||
    !Array.isArray(value.attempts) ||
    value.attempts.length === 0 ||
    !value.attempts.every(isGenerationAttempt) ||
    value.attempts.some((attempt, index) => attempt.number !== index + 1) ||
    !isGenerationFingerprints(value.fingerprints) ||
    !isNonnegativeFiniteNumber(value.latencyMilliseconds) ||
    !isGenerationUsage(usage)
  ) {
    return undefined;
  }
  const aggregateUsage = value.attempts.reduce(
    (total, attempt) => addGenerationUsage(total, attempt.usage),
    { ...EMPTY_GENERATION_USAGE },
  );
  if (
    aggregateUsage.inputTokens !== usage.inputTokens ||
    aggregateUsage.noCacheInputTokens !== usage.noCacheInputTokens ||
    aggregateUsage.cacheReadInputTokens !== usage.cacheReadInputTokens ||
    aggregateUsage.cacheWriteInputTokens !== usage.cacheWriteInputTokens ||
    (aggregateUsage.unclassifiedInputTokens ?? 0) !== (usage.unclassifiedInputTokens ?? 0) ||
    aggregateUsage.providerUsageIncomplete !== usage.providerUsageIncomplete ||
    aggregateUsage.providerUsageInconsistent !== usage.providerUsageInconsistent ||
    aggregateUsage.outputTokens !== usage.outputTokens ||
    aggregateUsage.reasoningOutputTokens !== usage.reasoningOutputTokens
  ) {
    return undefined;
  }
  return {
    generatedAt: value.generatedAt,
    validationVersion: value.validationVersion as number,
    attempts: structuredClone(value.attempts),
    latencyMilliseconds: value.latencyMilliseconds,
    usage: structuredClone(usage),
    fingerprints: structuredClone(value.fingerprints),
  };
}

/** Parses and defensively clones a completed-result cache record. */
export function parseCompletedGenerationCacheRecord(
  value: unknown,
): CompletedGenerationCacheRecord | undefined {
  if (!isRecord(value)) return undefined;
  const provenance = cachedProvenance(value.provenance);
  if (
    value.formatVersion !== 1 ||
    typeof value.modelConfigurationId !== "string" ||
    (value.responseModelId !== undefined && typeof value.responseModelId !== "string") ||
    provenance === undefined ||
    !Object.hasOwn(value, "rawOutput")
  ) {
    return undefined;
  }
  // A successful generation can contain correctable rejected rounds followed by exactly one
  // accepted round. Transport failures terminate immediately and are therefore never cacheable.
  const finalAttempt = provenance.attempts.at(-1)!;
  if (
    provenance.attempts.some((attempt) =>
      attempt.modelConfigurationId !== value.modelConfigurationId ||
      attempt.requestError !== undefined
    ) ||
    provenance.attempts.slice(0, -1).some((attempt) => attempt.validationError === undefined) ||
    finalAttempt.validationError !== undefined ||
    finalAttempt.rejectedOutput !== undefined ||
    (value.responseModelId !== undefined && finalAttempt.responseModelId !== undefined &&
      value.responseModelId !== finalAttempt.responseModelId)
  ) {
    return undefined;
  }
  return completedGenerationCacheRecord({
    rawOutput: value.rawOutput,
    modelConfigurationId: value.modelConfigurationId,
    responseModelId: value.responseModelId as string | undefined,
    provenance,
  });
}

/** Creates an isolated, versioned completed-result record for persistence. */
export function completedGenerationCacheRecord(
  value: Omit<CompletedGenerationCacheRecord, "formatVersion">,
): CompletedGenerationCacheRecord {
  return structuredClone({
    formatVersion: 1,
    rawOutput: value.rawOutput,
    modelConfigurationId: value.modelConfigurationId,
    ...(value.responseModelId === undefined ? {} : { responseModelId: value.responseModelId }),
    provenance: value.provenance,
  });
}

function sameCompletedResultFingerprints(
  left: GenerationFingerprints,
  right: GenerationFingerprints,
): boolean {
  // The stable-prefix split and prompt-cache controls affect routing and billing, not the semantic
  // completed result. They remain in provenance while compatibility relies on the complete prompt
  // and schema; the cache key itself already covers every semantic provider option.
  return left.basePrompt === right.basePrompt && left.schema === right.schema;
}

/** Whether a parsed record can be safely revalidated for the current request. */
export function completedGenerationIsCompatible(
  record: CompletedGenerationCacheRecord,
  modelConfigurationId: string,
  fingerprints: GenerationFingerprints,
  validationVersion: number,
): boolean {
  // A corrective retry includes the previous validator error in the provider request. Such raw
  // output is reusable only with the same validator procedure. A first-attempt response, by
  // contrast, depends solely on the semantic provider request and can be revalidated safely by a
  // different validator version.
  const cachedProcedureIsReusable = record.provenance.validationVersion === validationVersion ||
    record.provenance.attempts.length === 1;
  return cachedProcedureIsReusable &&
    record.modelConfigurationId === modelConfigurationId &&
    sameCompletedResultFingerprints(record.provenance.fingerprints, fingerprints);
}

/** Builds a semantic completed-result cache key plus audit fingerprints. */
export async function generationRequestIdentity<RawOutput>(
  operation: CompletedResultRequestOperation<RawOutput>,
  model: ModelConfiguration,
  messages: readonly ModelMessage[],
  maxOutputTokens: number,
): Promise<GenerationRequestIdentity> {
  const schema = z.toJSONSchema(operation.outputSchema);
  const [basePrompt, stablePrompt, schemaFingerprint] = await Promise.all([
    generationCacheKey({ system: operation.system, messages }),
    generationCacheKey({
      system: operation.system,
      messages: messages.slice(0, operation.stableMessageCount),
    }),
    generationCacheKey(schema),
  ]);
  const modelRequest = {
    modelId: model.modelId,
    provider: model.provider,
    providerOptions: model.providerOptions,
  };
  const requestConfiguration = {
    operation: operation.name,
    validationVersion: operation.validationVersion,
    model: {
      ...modelRequest,
      explicitPromptCaching: model.explicitPromptCaching ?? "implicit",
      stableMessageCount: operation.stableMessageCount,
      effectiveProviderOptions: requestProviderOptions(
        operation.stableMessageCount,
        model,
        stablePrompt,
      ),
    },
    maxOutputTokens,
  };
  const fingerprints: GenerationFingerprints = {
    basePrompt,
    stablePrompt,
    schema: schemaFingerprint,
    configuration: await generationCacheKey(requestConfiguration),
  };
  const request = {
    operation: operation.name,
    system: operation.system,
    outputSchema: schema,
    messages,
    // Preserve the readable, normalized preset identity in the key as well as its concrete request
    // settings. Model aliases remain intentionally distinct completed-result cache identities.
    model: { id: model.id, ...modelRequest },
    maxOutputTokens,
  };
  const cacheKey = await generationCacheKey(request);
  return {
    cacheKey,
    fingerprints,
  };
}
