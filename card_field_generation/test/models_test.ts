import { assertEquals } from "@std/assert";
import {
  effectiveReasoningEffort,
  PRODUCTION_GENERATION_CONFIGURATIONS,
} from "../src/model_presets.ts";
import { modelSettings } from "../src/models.ts";

Deno.test("focused operations expose their configured production settings", () => {
  assertEquals(PRODUCTION_GENERATION_CONFIGURATIONS, {
    "context-minimization": {
      modelId: "claude-opus-5",
      reasoningEffort: "low",
    },
    hint: {
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
    "sense-selection": {
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    },
  });
});

Deno.test("modelConfiguration identities reflect effective Anthropic settings", () => {
  const haikuLow = modelSettings("claude-haiku-4-5", "low");
  const haikuHigh = modelSettings("claude-haiku-4-5", "high");
  assertEquals(haikuLow.id, "claude-haiku-4-5@disabled");
  assertEquals(haikuHigh.id, haikuLow.id);
  assertEquals(haikuHigh.providerOptions, haikuLow.providerOptions);

  const opusMinimal = modelSettings("claude-opus-5", "minimal");
  const opusLow = modelSettings("claude-opus-5", "low");
  assertEquals(opusMinimal.id, "claude-opus-5@low");
  assertEquals(opusMinimal.id, opusLow.id);
  assertEquals(opusMinimal.providerOptions, opusLow.providerOptions);

  assertEquals(opusMinimal.providerOptions, {
    anthropic: {
      effort: "low",
      thinking: { type: "adaptive", display: "omitted" },
    },
  });
  assertEquals(opusMinimal.explicitPromptCaching, "anthropic-5m");
});

Deno.test("effectiveReasoningEffort exposes provider-equivalent settings", () => {
  assertEquals(effectiveReasoningEffort("claude-opus-5", "none"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-opus-5", "minimal"), "low");
  assertEquals(effectiveReasoningEffort("claude-opus-5", "low"), "low");
  assertEquals(effectiveReasoningEffort("claude-opus-5", "medium"), "medium");
  assertEquals(effectiveReasoningEffort("claude-opus-5", "high"), "high");
  assertEquals(effectiveReasoningEffort("claude-opus-5", "xhigh"), "xhigh");
  assertEquals(effectiveReasoningEffort("claude-opus-5", "max"), "max");

  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "none"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "minimal"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "low"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "medium"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "high"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "xhigh"), "disabled");
  assertEquals(effectiveReasoningEffort("claude-haiku-4-5", "max"), "disabled");

  assertEquals(effectiveReasoningEffort("gemini-3.6-flash", "none"), "minimal");
  assertEquals(effectiveReasoningEffort("gemini-3.6-flash", "minimal"), "minimal");
  assertEquals(effectiveReasoningEffort("gemini-3.6-flash", "xhigh"), "high");
  assertEquals(effectiveReasoningEffort("gemini-3.6-flash", "max"), "high");

  assertEquals(effectiveReasoningEffort("gpt-5.6-luna", "minimal"), "none");
  assertEquals(effectiveReasoningEffort("gpt-5.6-luna", "high"), "high");
  assertEquals(effectiveReasoningEffort("gpt-5.6-luna", "max"), "max");
});

Deno.test("modelConfiguration keeps distinct supported reasoning settings", () => {
  const lunaLow = modelSettings("gpt-5.6-luna", "low");
  const lunaHigh = modelSettings("gpt-5.6-luna", "high");
  assertEquals(lunaLow.id, "gpt-5.6-luna@low");
  assertEquals(lunaHigh.id, "gpt-5.6-luna@high");
  assertEquals(lunaLow.providerOptions, {
    openai: { reasoningEffort: "low", textVerbosity: "low" },
  });
  assertEquals(lunaLow.explicitPromptCaching, "openai-30m");

  assertEquals(modelSettings("gpt-5.6-luna", "minimal"), {
    id: "gpt-5.6-luna@none",
    modelId: "gpt-5.6-luna",
    provider: "openai",
    providerOptions: {
      openai: { reasoningEffort: "none", textVerbosity: "low" },
    },
    explicitPromptCaching: "openai-30m",
  });
  assertEquals(modelSettings("gpt-5.6-sol", "max").providerOptions, {
    openai: { reasoningEffort: "max", textVerbosity: "low" },
  });
});
