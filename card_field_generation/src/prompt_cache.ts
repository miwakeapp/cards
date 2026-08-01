import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { ModelMessage } from "ai";
import type { ModelConfiguration } from "./models.ts";

interface PromptCacheFingerprints {
  stablePrompt: string;
  schema: string;
  configuration: string;
}

interface PromptCacheWarmup {
  promise: Promise<boolean>;
  resolve: (cachePrimed: boolean) => void;
  readyUntil: number;
}

const PROMPT_CACHE_WARMUPS = new Map<string, PromptCacheWarmup>();

function promptCacheLifetimeMilliseconds(model: ModelConfiguration): number {
  // Stay just inside each explicit provider TTL. Google's cache is implicit, but coordinating its
  // first concurrent request is still useful and four minutes is a conservative local lifetime
  // for providers or models without a longer explicit contract.
  return model.explicitPromptCaching === "openai-30m" ? 29 * 60_000 : 4 * 60_000;
}

function promptCacheWarmup(
  stableMessageCount: number,
  model: ModelConfiguration,
  fingerprints: PromptCacheFingerprints,
): { waitFor?: Promise<boolean>; complete?: (cachePrimed: boolean) => void } {
  if (stableMessageCount === 0) return {};
  const key = [
    model.id,
    fingerprints.stablePrompt,
    fingerprints.schema,
    fingerprints.configuration,
  ].join(":");
  const now = Date.now();
  const existing = PROMPT_CACHE_WARMUPS.get(key);
  if (existing !== undefined && existing.readyUntil > now) {
    return { waitFor: existing.promise };
  }

  const deferred = Promise.withResolvers<boolean>();
  const warmup: PromptCacheWarmup = {
    promise: deferred.promise,
    resolve: deferred.resolve,
    readyUntil: Number.POSITIVE_INFINITY,
  };
  PROMPT_CACHE_WARMUPS.set(key, warmup);
  let completed = false;
  return {
    complete(cachePrimed) {
      if (completed) return;
      completed = true;
      if (cachePrimed) {
        warmup.readyUntil = Date.now() + promptCacheLifetimeMilliseconds(model);
      } else if (PROMPT_CACHE_WARMUPS.get(key) === warmup) {
        PROMPT_CACHE_WARMUPS.delete(key);
      }
      warmup.resolve(cachePrimed);
    },
  };
}

/** Coordinates the first concurrent request which can populate a provider's prompt cache. */
export async function coordinatePromptCacheWarmup(
  stableMessageCount: number,
  model: ModelConfiguration,
  fingerprints: PromptCacheFingerprints,
): Promise<((cachePrimed: boolean) => void) | undefined> {
  while (true) {
    const warmup = promptCacheWarmup(stableMessageCount, model, fingerprints);
    if (warmup.waitFor === undefined) return warmup.complete;
    if (await warmup.waitFor) return undefined;
    // The first request failed before it could populate the provider cache. Loop so exactly one
    // waiter claims the replacement warmup while the others queue behind it.
  }
}

function mergeProviderOptions(
  base: ProviderOptions,
  additions: ProviderOptions,
): ProviderOptions {
  const merged: ProviderOptions = { ...base };
  for (const [provider, options] of Object.entries(additions)) {
    merged[provider] = {
      ...(base[provider] ?? {}),
      ...options,
    };
  }
  return merged;
}

/** Adds provider-specific cache breakpoints to the stable prompt prefix. */
export function messagesWithPromptCacheBreakpoint(
  messages: readonly ModelMessage[],
  stableMessageCount: number,
  model: ModelConfiguration,
): ModelMessage[] {
  const result = structuredClone(messages) as ModelMessage[];
  if (stableMessageCount === 0) return result;
  if (
    !Number.isSafeInteger(stableMessageCount) || stableMessageCount < 0 ||
    stableMessageCount > result.length
  ) {
    throw new RangeError(
      `stableMessageCount must be a safe integer between 0 and messages.length; received ${stableMessageCount} for ${result.length} messages`,
    );
  }

  const index = stableMessageCount - 1;
  const message = result[index];
  if (model.explicitPromptCaching === "anthropic-5m") {
    result[index] = {
      ...message,
      providerOptions: mergeProviderOptions(message.providerOptions ?? {}, {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
      }),
    } as ModelMessage;
  }

  // The OpenAI Responses API accepts explicit cache breakpoints on user input parts, but silently
  // drops them from assistant text. Few-shot prefixes end with an assistant response, so put the
  // OpenAI breakpoint on the last text part of the preceding stable user message instead.
  for (
    let userIndex = model.explicitPromptCaching === "openai-30m" ? index : -1;
    userIndex >= 0;
    --userIndex
  ) {
    const userMessage = result[userIndex];
    if (userMessage.role !== "user") continue;

    const content = typeof userMessage.content === "string"
      ? [{ type: "text" as const, text: userMessage.content }]
      : [...userMessage.content];
    const textPartIndex = content.findLastIndex((part) => part.type === "text");
    if (textPartIndex === -1) continue;

    const textPart = content[textPartIndex];
    if (textPart.type !== "text") continue;
    content[textPartIndex] = {
      ...textPart,
      providerOptions: mergeProviderOptions(textPart.providerOptions ?? {}, {
        openai: { promptCacheBreakpoint: { mode: "explicit" } },
      }),
    };
    result[userIndex] = { ...userMessage, content };
    break;
  }
  return result;
}

/** Returns provider options augmented with stable-prefix prompt-cache routing controls. */
export function requestProviderOptions(
  stableMessageCount: number,
  model: ModelConfiguration,
  stablePromptFingerprint: string,
): ProviderOptions {
  if (
    model.explicitPromptCaching !== "openai-30m" || stableMessageCount === 0
  ) {
    return model.providerOptions;
  }
  return mergeProviderOptions(model.providerOptions, {
    openai: {
      // OpenAI caps this field at 64 characters. The stable-prefix digest already provides the
      // routing identity; a short namespace plus 240 bits of it stays within that hard limit.
      promptCacheKey: `cfg:${stablePromptFingerprint.slice(0, 60)}`,
      promptCacheOptions: { mode: "explicit", ttl: "30m" },
    },
  });
}
