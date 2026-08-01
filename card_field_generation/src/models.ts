import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { LanguageModel } from "ai";
import {
  type EffectiveReasoningEffort,
  effectiveReasoningEffort,
  type ModelId,
  type ReasoningEffort,
} from "./model_presets.ts";
export {
  effectiveReasoningEffort,
  FIELD_GENERATION_OPERATIONS,
  MODEL_IDS,
  PRODUCTION_GENERATION_CONFIGURATIONS,
} from "./model_presets.ts";
export type {
  EffectiveReasoningEffort,
  FieldGenerationOperation,
  ModelId,
  ProductionGenerationConfiguration,
  ReasoningEffort,
} from "./model_presets.ts";

/** AI providers supported by the project model presets. */
export type ModelProvider = "anthropic" | "google" | "openai";

/**
 * A concrete model and its generation settings.
 *
 * `id` is a stable, human-readable identity used in result-cache keys and reports. It includes
 * settings such as reasoning effort that can change an answer even when the provider model ID is
 * unchanged.
 */
export interface ModelConfiguration {
  id: string;
  modelId: string;
  provider: ModelProvider;
  model: LanguageModel;
  providerOptions: ProviderOptions;
  /** Explicit provider prompt-cache controls supported by this concrete model. */
  explicitPromptCaching?: "anthropic-5m" | "openai-30m";
}

/** Pure provider settings used to construct a model and identify equivalent requests. */
export type ModelSettings = Omit<ModelConfiguration, "model">;

function isGoogleModel(modelId: ModelId): boolean {
  return modelId.startsWith("gemini-");
}

function isAnthropicModel(modelId: ModelId): boolean {
  return modelId.startsWith("claude-");
}

function anthropicProviderOptions(effort: EffectiveReasoningEffort): ProviderOptions {
  if (effort === "disabled") {
    const anthropic = { thinking: { type: "disabled" } } satisfies AnthropicProviderOptions;
    return { anthropic };
  }
  if (effort === "none" || effort === "minimal") {
    throw new Error("Invalid normalized Anthropic reasoning effort: " + effort);
  }
  const anthropic = {
    effort,
    thinking: { type: "adaptive", display: "omitted" },
  } satisfies AnthropicProviderOptions;
  return { anthropic };
}

function googleProviderOptions(effort: EffectiveReasoningEffort): ProviderOptions {
  if (effort !== "minimal" && effort !== "low" && effort !== "medium" && effort !== "high") {
    throw new Error("Invalid normalized Google reasoning effort: " + effort);
  }
  const google = {
    thinkingConfig: { thinkingLevel: effort },
  } satisfies GoogleGenerativeAIProviderOptions;
  return { google };
}

function openAIProviderOptions(effort: EffectiveReasoningEffort): ProviderOptions {
  if (effort === "disabled" || effort === "minimal") {
    throw new Error("Invalid normalized OpenAI reasoning effort: " + effort);
  }
  const openai = {
    reasoningEffort: effort,
    textVerbosity: "low",
  } satisfies OpenAIResponsesProviderOptions;
  return { openai };
}

/** Resolves effective provider settings without loading a provider SDK or reading credentials. */
export function modelSettings(
  modelId: ModelId,
  reasoningEffort: ReasoningEffort = "low",
): ModelSettings {
  const effectiveEffort = effectiveReasoningEffort(modelId, reasoningEffort);
  if (isGoogleModel(modelId)) {
    return {
      id: `${modelId}@${effectiveEffort}`,
      modelId,
      provider: "google",
      providerOptions: googleProviderOptions(effectiveEffort),
    };
  }
  if (isAnthropicModel(modelId)) {
    return {
      id: `${modelId}@${effectiveEffort}`,
      modelId,
      provider: "anthropic",
      providerOptions: anthropicProviderOptions(effectiveEffort),
      explicitPromptCaching: "anthropic-5m",
    };
  }
  if (modelId.startsWith("gpt-")) {
    return {
      id: `${modelId}@${effectiveEffort}`,
      modelId,
      provider: "openai",
      providerOptions: openAIProviderOptions(effectiveEffort),
      ...(modelId.startsWith("gpt-5.6") ? { explicitPromptCaching: "openai-30m" as const } : {}),
    };
  }
  throw new Error(`Unknown model ID: ${modelId}`);
}

/** Creates a model configuration without loading unrelated provider SDKs. */
export async function modelConfiguration(
  modelId: ModelId,
  reasoningEffort: ReasoningEffort = "low",
): Promise<ModelConfiguration> {
  const settings = modelSettings(modelId, reasoningEffort);
  if (settings.provider === "google") {
    const { google } = await import("@ai-sdk/google");
    return { ...settings, model: google(modelId) };
  }
  if (settings.provider === "anthropic") {
    const { anthropic } = await import("@ai-sdk/anthropic");
    return { ...settings, model: anthropic(modelId) };
  }
  const { openai } = await import("@ai-sdk/openai");
  return { ...settings, model: openai(modelId) };
}
