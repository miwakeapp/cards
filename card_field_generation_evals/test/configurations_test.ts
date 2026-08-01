import { assertEquals } from "@std/assert";
import { evalOperationConfigurations } from "../src/configurations.ts";

Deno.test("evalOperationConfigurations uses each operation's production configuration", () => {
  assertEquals(
    evalOperationConfigurations(["context-minimization", "hint", "sense-selection"]),
    [
      {
        operation: "context-minimization",
        modelId: "claude-opus-5",
        reasoningEffort: "low",
      },
      {
        operation: "hint",
        modelId: "gpt-5.6-sol",
        reasoningEffort: "medium",
      },
      {
        operation: "sense-selection",
        modelId: "gpt-5.6-sol",
        reasoningEffort: "medium",
      },
    ],
  );
});

Deno.test("evalOperationConfigurations overrides only explicitly selected dimensions", () => {
  assertEquals(
    evalOperationConfigurations(["context-minimization", "hint"], ["gemini-3.6-flash"]),
    [
      {
        operation: "context-minimization",
        modelId: "gemini-3.6-flash",
        reasoningEffort: "low",
      },
      {
        operation: "hint",
        modelId: "gemini-3.6-flash",
        reasoningEffort: "medium",
      },
    ],
  );
  assertEquals(
    evalOperationConfigurations(["context-minimization", "hint"], undefined, ["high"]),
    [
      {
        operation: "context-minimization",
        modelId: "claude-opus-5",
        reasoningEffort: "high",
      },
      {
        operation: "hint",
        modelId: "gpt-5.6-sol",
        reasoningEffort: "high",
      },
    ],
  );
});

Deno.test("evalOperationConfigurations forms a comparison matrix for both overrides", () => {
  assertEquals(
    evalOperationConfigurations(
      ["sense-selection"],
      ["gemini-3.6-flash", "gpt-5.6-luna"],
      ["minimal", "high"],
    ),
    [
      {
        operation: "sense-selection",
        modelId: "gemini-3.6-flash",
        reasoningEffort: "minimal",
      },
      {
        operation: "sense-selection",
        modelId: "gemini-3.6-flash",
        reasoningEffort: "high",
      },
      {
        operation: "sense-selection",
        modelId: "gpt-5.6-luna",
        reasoningEffort: "none",
      },
      {
        operation: "sense-selection",
        modelId: "gpt-5.6-luna",
        reasoningEffort: "high",
      },
    ],
  );
});

Deno.test("evalOperationConfigurations collapses equivalent Anthropic efforts", () => {
  assertEquals(
    evalOperationConfigurations(
      ["hint"],
      ["claude-opus-5"],
      ["minimal", "low", "medium", "high"],
    ),
    [
      {
        operation: "hint",
        modelId: "claude-opus-5",
        reasoningEffort: "low",
      },
      {
        operation: "hint",
        modelId: "claude-opus-5",
        reasoningEffort: "medium",
      },
      {
        operation: "hint",
        modelId: "claude-opus-5",
        reasoningEffort: "high",
      },
    ],
  );
});

Deno.test("evalOperationConfigurations collapses every Haiku effort to disabled", () => {
  assertEquals(
    evalOperationConfigurations(
      ["hint", "hint"],
      ["claude-haiku-4-5", "claude-haiku-4-5"],
      ["minimal", "low", "medium", "high"],
    ),
    [
      {
        operation: "hint",
        modelId: "claude-haiku-4-5",
        reasoningEffort: "disabled",
      },
    ],
  );
});
