import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { MemoryGenerationCache } from "../src/cache.ts";
import type { CompletedGenerationCacheRecord } from "../src/completed_result_cache.ts";
import type { ModelConfiguration } from "../src/models.ts";
import {
  type GenerationAttempt,
  GenerationAttemptsExhaustedError,
  runGeneration,
} from "../src/runner.ts";
import { addGenerationUsage } from "../src/usage.ts";

function modelResult(value: string, responseId: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ value }) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: { total: 100, noCache: 80, cacheRead: 20, cacheWrite: 0 },
      outputTokens: { total: 10, text: 8, reasoning: 2 },
    },
    response: { id: responseId, modelId: "mock-response-model" },
    warnings: [],
  };
}

Deno.test("runGeneration retries validation failures and caches only the validated result", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      modelResult("invalid", "response-1"),
      modelResult("accepted", "response-2"),
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const cache = new MemoryGenerationCache();
  const operation = {
    name: "runner-test",
    validationVersion: 1,
    system: "Stable system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages(input: string) {
      return [
        { role: "user" as const, content: "Stable example" },
        { role: "assistant" as const, content: '{"value":"example"}' },
        { role: "user" as const, content: input },
      ];
    },
    stableMessageCount: 2,
    validate(_input: string, output: { value: string }) {
      if (output.value !== "accepted") {
        throw new Error(`value ${JSON.stringify(output.value)} is not accepted`);
      }
      return output.value;
    },
  };

  const first = await runGeneration(operation, "variable input", { cache }, model);
  assertEquals(first.value, "accepted");
  assertEquals(first.metadata.cacheStatus, "miss");
  assertEquals(first.metadata.attempts.length, 2);
  assertEquals(first.metadata.usage, {
    inputTokens: 200,
    noCacheInputTokens: 160,
    cacheReadInputTokens: 40,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 4,
  });
  assertEquals(languageModel.doGenerateCalls.length, 2);
  assertStringIncludes(
    JSON.stringify(languageModel.doGenerateCalls[1].prompt),
    'value \\"invalid\\" is not accepted',
  );

  // Returned metadata must not be a mutable view into the completed-result cache record.
  first.metadata.usage.inputTokens = 999;

  const second = await runGeneration(operation, "variable input", { cache }, model);
  assertEquals(second.value, "accepted");
  assertEquals(second.metadata.cacheStatus, "hit");
  assertEquals(second.metadata.attempts, []);
  assertEquals(second.metadata.usage.inputTokens, 0);
  assertEquals(second.metadata.sourceUsage?.inputTokens, 200);
  assertExists(second.metadata.fingerprints);
  assertExists(second.metadata.sourceGeneration);
  assertEquals(second.metadata.sourceGeneration.attempts.length, 2);
  assertEquals(second.metadata.sourceGeneration.usage.inputTokens, 200);
  assertEquals(second.metadata.sourceGeneration.fingerprints, first.metadata.fingerprints);
  assertEquals(languageModel.doGenerateCalls.length, 2);
});

Deno.test("runGeneration revalidates first-attempt output across validator versions", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const model: ModelConfiguration = {
    id: "validator-cache-model@low",
    modelId: "validator-cache-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "validator-cache-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [{ role: "user" as const, content: input }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const cache = new MemoryGenerationCache();

  const generated = await runGeneration(operation, "input", { cache }, model);
  assertEquals(generated.metadata.cacheStatus, "miss");

  operation.validationVersion = 2;
  operation.validate = (_input: string, output: { value: string }) => {
    if (output.value !== "accepted") throw new Error("stricter validator rejected value");
    return output.value;
  };

  const revalidated = await runGeneration(operation, "input", { cache }, model);
  assertEquals(revalidated.metadata.cacheStatus, "hit");
  assertEquals(revalidated.metadata.cacheKey, generated.metadata.cacheKey);
  assert(
    revalidated.metadata.fingerprints.configuration !==
      generated.metadata.fingerprints.configuration,
  );
  assertEquals(revalidated.metadata.sourceGeneration?.validationVersion, 1);
  assertEquals(revalidated.metadata.sourceGeneration?.attempts[0].number, 1);
  assertEquals(
    revalidated.metadata.sourceGeneration?.fingerprints,
    generated.metadata.fingerprints,
  );
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration regenerates cross-version outputs shaped by corrective retries", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      modelResult("rejected", "response-1"),
      modelResult("accepted-after-correction", "response-2"),
      modelResult("fresh-for-new-validator", "response-3"),
    ],
  });
  const model: ModelConfiguration = {
    id: "corrective-version-model@low",
    modelId: "corrective-version-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "corrective-version-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [{ role: "user" as const, content: input }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => {
      if (output.value === "rejected") throw new Error("version one rejection");
      return output.value;
    },
  };
  const cache = new MemoryGenerationCache();

  const first = await runGeneration(operation, "input", { cache }, model);
  assertEquals(first.value, "accepted-after-correction");
  assertEquals(first.metadata.attempts.length, 2);
  assertEquals(first.metadata.sourceGeneration, undefined);

  operation.validationVersion = 2;
  operation.validate = (_input: string, output: { value: string }) => output.value;
  const second = await runGeneration(operation, "input", { cache }, model);
  assertEquals(second.value, "fresh-for-new-validator");
  assertEquals(second.metadata.cacheStatus, "miss");
  assertEquals(second.metadata.cacheKey, first.metadata.cacheKey);
  assertEquals(second.metadata.attempts.length, 1);
  assertEquals(languageModel.doGenerateCalls.length, 3);
});

Deno.test("runGeneration rejects an operation with no model source", async () => {
  const operation = {
    name: "missing-model-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  await assertRejects(
    () => runGeneration(operation, "input", {}),
    Error,
    'No model is configured for generation operation "missing-model-test"; provide modelOverride, pass GenerationOptions.modelId, or set GenerationOperation.defaultModelId',
  );
});

Deno.test("runGeneration validates operation bounds before cache access", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const model: ModelConfiguration = {
    id: "operation-bounds-model@low",
    modelId: "operation-bounds-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  let cacheReads = 0;
  const cache = {
    get() {
      ++cacheReads;
      return Promise.resolve(undefined);
    },
    set() {
      return Promise.resolve();
    },
  };
  const operation = {
    name: "operation-bounds-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Entirely stable request" }],
    stableMessageCount: -1,
    validate: (_input: string, output: { value: string }) => output.value,
    maxOutputTokens: 64,
  };

  await assertRejects(
    () => runGeneration(operation, "input", { cache }, model),
    RangeError,
    "GenerationOperation.stableMessageCount must be a safe integer between 0 and messages.length; received -1 for 1 messages",
  );
  operation.stableMessageCount = 0.5;
  await assertRejects(
    () => runGeneration(operation, "input", { cache }, model),
    RangeError,
    "received 0.5 for 1 messages",
  );
  operation.stableMessageCount = 2;
  await assertRejects(
    () => runGeneration(operation, "input", { cache }, model),
    RangeError,
    "received 2 for 1 messages",
  );

  operation.stableMessageCount = 1;
  operation.maxOutputTokens = 0;
  await assertRejects(
    () => runGeneration(operation, "input", { cache }, model),
    RangeError,
    "GenerationOperation.maxOutputTokens must be a positive safe integer; received 0",
  );
  operation.maxOutputTokens = 1.5;
  await assertRejects(
    () => runGeneration(operation, "input", { cache }, model),
    RangeError,
    "received 1.5",
  );
  assertEquals(cacheReads, 0);
  assertEquals(languageModel.doGenerateCalls.length, 0);

  operation.maxOutputTokens = 64;
  const allStable = await runGeneration(
    operation,
    "input",
    { cacheMode: "bypass" },
    model,
  );
  assertEquals(allStable.value, "accepted");
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration retains paid usage when structured output cannot be parsed", async () => {
  const malformedResult = {
    ...modelResult("ignored", "malformed-response"),
    content: [{ type: "text" as const, text: "not JSON" }],
  };
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      malformedResult,
      modelResult("accepted", "accepted-response"),
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "malformed-output-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const result = await runGeneration(operation, "input", {}, model);

  assertEquals(result.value, "accepted");
  assertEquals(result.metadata.attempts.length, 2);
  assertEquals(result.metadata.attempts[0].responseModelId, "mock-response-model");
  assertEquals(result.metadata.attempts[0].responseId, "malformed-response");
  assertEquals(result.metadata.attempts[0].rejectedOutput, "not JSON");
  assertStringIncludes(
    JSON.stringify(languageModel.doGenerateCalls[1].prompt),
    "not JSON",
  );
  assert(
    result.metadata.attempts[0].promptFingerprint !==
      result.metadata.attempts[1].promptFingerprint,
  );
  assertEquals(result.metadata.attempts[0].usage, {
    inputTokens: 100,
    noCacheInputTokens: 80,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    outputTokens: 10,
    reasoningOutputTokens: 2,
  });
  assertEquals(result.metadata.usage, {
    inputTokens: 200,
    noCacheInputTokens: 160,
    cacheReadInputTokens: 40,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 4,
  });
});

Deno.test("runGeneration retains step telemetry when structured generation has no usable output", async () => {
  const noOutputResult = {
    ...modelResult("ignored", "no-output-response"),
    content: [],
    providerMetadata: { mock: { source: "no-output" } },
  };
  const languageModel = new MockLanguageModelV4({
    doGenerate: [noOutputResult, modelResult("accepted", "accepted-response")],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "no-output-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const result = await runGeneration(operation, "input", {}, model);

  assertEquals(result.value, "accepted");
  assertEquals(result.metadata.attempts[0].responseModelId, "mock-response-model");
  assertEquals(result.metadata.attempts[0].responseId, "no-output-response");
  assertEquals(result.metadata.attempts[0].providerMetadata, {
    mock: { source: "no-output" },
  });
  assertStringIncludes(result.metadata.attempts[0].validationError!, "No object generated");
  assertEquals(result.metadata.attempts[0].usage, {
    inputTokens: 100,
    noCacheInputTokens: 80,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    outputTokens: 10,
    reasoningOutputTokens: 2,
  });
});

Deno.test("runGeneration records unavailable usage for provider transport failures", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: () => {
      throw new Error("transport failed");
    },
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "transport-failure-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const attempts = [] as GenerationAttempt[];

  await assertRejects(
    () =>
      runGeneration(
        operation,
        "input",
        {
          onAttempt(attempt) {
            attempts.push(attempt);
          },
        },
        model,
      ),
    Error,
    "transport failed",
  );

  assertEquals(attempts.length, 1);
  assertEquals(attempts[0].requestError, "transport failed");
  assertEquals(attempts[0].usage, {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    providerUsageIncomplete: true,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
});

Deno.test("runGeneration preserves input tokens whose cache classification is unavailable", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: {
      ...modelResult("accepted", "unclassified-usage-response"),
      usage: {
        inputTokens: {
          total: 100,
          noCache: undefined,
          cacheRead: 20,
          cacheWrite: undefined,
        },
        outputTokens: { total: 10, text: 8, reasoning: 2 },
      },
    },
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "unclassified-usage-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const cache = new MemoryGenerationCache();

  const result = await runGeneration(operation, "input", { cache }, model);

  assertEquals(result.metadata.usage, {
    inputTokens: 100,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    unclassifiedInputTokens: 80,
    providerUsageIncomplete: true,
    outputTokens: 10,
    reasoningOutputTokens: 2,
  });
  assertEquals(result.metadata.attempts[0].usage, result.metadata.usage);

  const cached = await runGeneration(operation, "input", { cache }, model);
  assertEquals(cached.metadata.cacheStatus, "hit");
  assertEquals(cached.metadata.usage, {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  assertEquals(cached.metadata.sourceUsage.providerUsageIncomplete, true);
  assertEquals(cached.metadata.sourceGeneration?.usage.providerUsageIncomplete, true);
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration distinguishes contradictory provider totals from missing telemetry", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      {
        ...modelResult("total-above-details", "total-above-details-response"),
        usage: {
          inputTokens: { total: 110, noCache: 80, cacheRead: 20, cacheWrite: 0 },
          outputTokens: { total: 12, text: 8, reasoning: 2 },
        },
      },
      {
        ...modelResult("details-above-total", "details-above-total-response"),
        usage: {
          inputTokens: { total: 90, noCache: 80, cacheRead: 20, cacheWrite: 0 },
          outputTokens: { total: 9, text: 8, reasoning: 2 },
        },
      },
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "inconsistent-usage-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [{ role: "user" as const, content: input }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const totalAboveDetails = await runGeneration(
    operation,
    "total above details",
    { cacheMode: "bypass" },
    model,
  );
  assertEquals(totalAboveDetails.metadata.usage, {
    inputTokens: 110,
    noCacheInputTokens: 80,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    unclassifiedInputTokens: 10,
    providerUsageInconsistent: true,
    outputTokens: 12,
    reasoningOutputTokens: 2,
  });

  const detailsAboveTotal = await runGeneration(
    operation,
    "details above total",
    { cacheMode: "bypass" },
    model,
  );
  assertEquals(detailsAboveTotal.metadata.usage, {
    inputTokens: 100,
    noCacheInputTokens: 80,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    providerUsageInconsistent: true,
    outputTokens: 10,
    reasoningOutputTokens: 2,
  });
});

Deno.test("runGeneration aggregates mixed telemetry provenance and preserves it in cache", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      {
        ...modelResult("invalid", "incomplete-usage-response"),
        usage: {
          inputTokens: {
            total: 100,
            noCache: undefined,
            cacheRead: 20,
            cacheWrite: undefined,
          },
          outputTokens: { total: 10, text: 8, reasoning: 2 },
        },
      },
      {
        ...modelResult("accepted", "inconsistent-usage-response"),
        usage: {
          inputTokens: { total: 90, noCache: 80, cacheRead: 20, cacheWrite: 0 },
          outputTokens: { total: 10, text: 8, reasoning: 2 },
        },
      },
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "mixed-usage-provenance-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate(_input: string, output: { value: string }) {
      if (output.value !== "accepted") throw new Error("value is not accepted");
      return output.value;
    },
  };
  const cache = new MemoryGenerationCache();

  const generated = await runGeneration(operation, "input", { cache }, model);

  assertEquals(generated.metadata.attempts[0].usage.providerUsageIncomplete, true);
  assertEquals(generated.metadata.attempts[0].usage.providerUsageInconsistent, undefined);
  assertEquals(generated.metadata.attempts[1].usage.providerUsageIncomplete, undefined);
  assertEquals(generated.metadata.attempts[1].usage.providerUsageInconsistent, true);
  assertEquals(generated.metadata.usage, {
    inputTokens: 200,
    noCacheInputTokens: 80,
    cacheReadInputTokens: 40,
    cacheWriteInputTokens: 0,
    unclassifiedInputTokens: 80,
    providerUsageIncomplete: true,
    providerUsageInconsistent: true,
    outputTokens: 20,
    reasoningOutputTokens: 4,
  });

  const cached = await runGeneration(operation, "input", { cache }, model);
  assertEquals(cached.metadata.cacheStatus, "hit");
  assertEquals(cached.metadata.usage, {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
  assertEquals(cached.metadata.sourceUsage, generated.metadata.usage);
  assertEquals(cached.metadata.sourceGeneration?.usage, generated.metadata.usage);
  assertEquals(languageModel.doGenerateCalls.length, 2);
});

Deno.test("runGeneration marks entirely unavailable provider counts as incomplete", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: {
      ...modelResult("accepted", "missing-usage-response"),
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
    },
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "missing-usage-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const result = await runGeneration(operation, "input", {}, model);

  assertEquals(result.metadata.usage, {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    providerUsageIncomplete: true,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
});

Deno.test("runGeneration places provider prompt-cache breakpoints where adapters preserve them", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const model: ModelConfiguration = {
    id: "mock-openai-model@low",
    modelId: "mock-openai-model",
    provider: "openai",
    model: languageModel,
    providerOptions: {},
    explicitPromptCaching: "openai-30m",
  };
  const operation = {
    name: "prompt-cache-test",
    validationVersion: 1,
    system: "Stable system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [
      { role: "user" as const, content: "First stable example request" },
      { role: "assistant" as const, content: '{"value":"first example"}' },
      { role: "user" as const, content: "Last stable example request" },
      { role: "assistant" as const, content: '{"value":"last example"}' },
      { role: "user" as const, content: input },
    ],
    stableMessageCount: 4,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const generated = await runGeneration(operation, "Variable request", {}, model);

  const request = languageModel.doGenerateCalls[0];
  assertEquals(request.providerOptions, {
    openai: {
      promptCacheKey: `cfg:${generated.metadata.fingerprints!.stablePrompt.slice(0, 60)}`,
      promptCacheOptions: { mode: "explicit", ttl: "30m" },
    },
  });
  const promptCacheKey = Reflect.get(
    Reflect.get(request.providerOptions!, "openai"),
    "promptCacheKey",
  );
  assert(typeof promptCacheKey === "string");
  assertEquals(promptCacheKey.length <= 64, true);
  assertEquals(request.prompt[3], {
    role: "user",
    content: [{
      type: "text",
      text: "Last stable example request",
      providerOptions: {
        openai: { promptCacheBreakpoint: { mode: "explicit" } },
      },
    }],
    providerOptions: undefined,
  });
  assertEquals(request.prompt[4], {
    role: "assistant",
    content: [{ type: "text", text: '{"value":"last example"}' }],
    providerOptions: undefined,
  });

  const secondGenerated = await runGeneration(operation, "Different variable request", {}, model);
  assert(
    generated.metadata.fingerprints!.basePrompt !==
      secondGenerated.metadata.fingerprints!.basePrompt,
  );
  assertEquals(
    generated.metadata.fingerprints!.stablePrompt,
    secondGenerated.metadata.fingerprints!.stablePrompt,
  );
  assertEquals(
    generated.metadata.fingerprints!.schema,
    secondGenerated.metadata.fingerprints!.schema,
  );
  assertEquals(
    generated.metadata.fingerprints!.configuration,
    secondGenerated.metadata.fingerprints!.configuration,
  );
  assertEquals(
    languageModel.doGenerateCalls[1].providerOptions,
    request.providerOptions,
  );
});

Deno.test("runGeneration follows each model's explicit prompt-cache capability", async () => {
  const operation = {
    name: "prompt-cache-capability-test",
    validationVersion: 1,
    system: "Unique cache-capability system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [
      { role: "user" as const, content: "Stable example" },
      { role: "assistant" as const, content: '{"value":"example"}' },
      { role: "user" as const, content: input },
    ],
    stableMessageCount: 2,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const openAI = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "openai-response"),
  });
  const anthropic = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "anthropic-response"),
  });

  await runGeneration(operation, "OpenAI input", {}, {
    id: "openai-model@low",
    modelId: "openai-model",
    provider: "openai",
    model: openAI,
    providerOptions: {},
  });
  await runGeneration(operation, "Anthropic input", {}, {
    id: "claude-opus-5@low",
    modelId: "claude-opus-5",
    provider: "anthropic",
    model: anthropic,
    providerOptions: {},
    explicitPromptCaching: "anthropic-5m",
  });

  assertEquals(openAI.doGenerateCalls[0].providerOptions, {});
  assertEquals(
    JSON.stringify(openAI.doGenerateCalls[0].prompt).includes("promptCache"),
    false,
  );
  assertEquals(anthropic.doGenerateCalls[0].prompt[2].providerOptions, {
    anthropic: { cacheControl: { type: "ephemeral", ttl: "5m" } },
  });
});

Deno.test("runGeneration records prompt-cache controls without invalidating semantic results", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const operation = {
    name: "prompt-cache-provenance-test",
    validationVersion: 1,
    system: "Stable system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [
      { role: "user" as const, content: "Stable example" },
      { role: "assistant" as const, content: '{"value":"example"}' },
      { role: "user" as const, content: input },
    ],
    stableMessageCount: 2,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const cache = new MemoryGenerationCache();
  const withoutExplicitCaching: ModelConfiguration = {
    id: "mock-anthropic-model@low",
    modelId: "mock-anthropic-model",
    provider: "anthropic",
    model: languageModel,
    providerOptions: {},
  };
  const withExplicitCaching: ModelConfiguration = {
    ...withoutExplicitCaching,
    explicitPromptCaching: "anthropic-5m",
  };

  const first = await runGeneration(
    operation,
    "Variable request",
    { cache },
    withoutExplicitCaching,
  );
  const second = await runGeneration(
    operation,
    "Variable request",
    { cache },
    withExplicitCaching,
  );

  assertEquals(first.metadata.cacheStatus, "miss");
  assertEquals(second.metadata.cacheStatus, "hit");
  assertEquals(second.metadata.cacheKey, first.metadata.cacheKey);
  assert(
    second.metadata.fingerprints.configuration !== first.metadata.fingerprints.configuration,
  );
  assertEquals(
    second.metadata.sourceGeneration?.fingerprints?.configuration,
    first.metadata.fingerprints.configuration,
  );
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration warms a shared provider prompt prefix before concurrent requests fan out", async () => {
  const firstRequestStarted = Promise.withResolvers<void>();
  const releaseFirstRequest = Promise.withResolvers<void>();
  const secondRequestStarted = Promise.withResolvers<void>();
  let callCount = 0;
  const languageModel = new MockLanguageModelV4({
    async doGenerate() {
      ++callCount;
      if (callCount === 1) {
        firstRequestStarted.resolve();
        await releaseFirstRequest.promise;
      } else {
        secondRequestStarted.resolve();
      }
      return modelResult("accepted", `response-${callCount}`);
    },
  });
  const model: ModelConfiguration = {
    id: "warmup-model@low",
    modelId: "warmup-model",
    provider: "anthropic",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "shared-prefix-warmup-test",
    validationVersion: 1,
    system: "Unique stable warmup system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [
      { role: "user" as const, content: "Stable example" },
      { role: "assistant" as const, content: '{"value":"example"}' },
      { role: "user" as const, content: input },
    ],
    stableMessageCount: 2,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const first = runGeneration(operation, "first variable request", {}, model);
  await firstRequestStarted.promise;
  const second = runGeneration(operation, "second variable request", {}, model);
  // Give the second invocation time to hash its request and encounter the warmup barrier.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(callCount, 1);

  releaseFirstRequest.resolve();
  await secondRequestStarted.promise;
  await Promise.all([first, second]);
  assertEquals(callCount, 2);
});

Deno.test("runGeneration elects one replacement after a prompt-cache warmup fails", async () => {
  const firstRequestStarted = Promise.withResolvers<void>();
  const releaseFailedRequest = Promise.withResolvers<void>();
  const replacementStarted = Promise.withResolvers<void>();
  const releaseReplacement = Promise.withResolvers<void>();
  const finalRequestStarted = Promise.withResolvers<void>();
  let callCount = 0;
  const languageModel = new MockLanguageModelV4({
    async doGenerate() {
      ++callCount;
      if (callCount === 1) {
        firstRequestStarted.resolve();
        await releaseFailedRequest.promise;
        throw new Error("provider unavailable before cache warmup");
      }
      if (callCount === 2) {
        replacementStarted.resolve();
        await releaseReplacement.promise;
      } else {
        finalRequestStarted.resolve();
      }
      return modelResult("accepted", `response-${callCount}`);
    },
  });
  const model: ModelConfiguration = {
    id: "warmup-recovery-model@low",
    modelId: "warmup-recovery-model",
    provider: "anthropic",
    model: languageModel,
    providerOptions: {},
    explicitPromptCaching: "anthropic-5m",
  };
  const operation = {
    name: "failed-prefix-warmup-test",
    validationVersion: 1,
    system: "Unique failed warmup system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [
      { role: "user" as const, content: "Stable example" },
      { role: "assistant" as const, content: '{"value":"example"}' },
      { role: "user" as const, content: input },
    ],
    stableMessageCount: 2,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const first = runGeneration(operation, "first input", {}, model);
  await firstRequestStarted.promise;
  const second = runGeneration(operation, "second input", {}, model);
  const third = runGeneration(operation, "third input", {}, model);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(callCount, 1);

  releaseFailedRequest.resolve();
  await assertRejects(() => first, Error, "provider unavailable before cache warmup");
  await replacementStarted.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(callCount, 2);

  releaseReplacement.resolve();
  await finalRequestStarted.promise;
  await Promise.all([second, third]);
  assertEquals(callCount, 3);
});

Deno.test("runGeneration keys completed results from the actual provider request", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const cache = new MemoryGenerationCache();
  const operation = {
    name: "request-key-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: { prompt: string; irrelevantMetadata: number }) => [{
      role: "user" as const,
      content: input.prompt,
    }],
    stableMessageCount: 0,
    validate: (
      _input: { prompt: string; irrelevantMetadata: number },
      output: { value: string },
    ) => output.value,
  };

  const first = await runGeneration(
    operation,
    { prompt: "same provider request", irrelevantMetadata: 1 },
    { cache },
    model,
  );
  const second = await runGeneration(
    operation,
    { prompt: "same provider request", irrelevantMetadata: 2 },
    { cache },
    model,
  );
  assertEquals(first.metadata.cacheStatus, "miss");
  assertEquals(second.metadata.cacheStatus, "hit");
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration supports refreshing and bypassing completed results", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      modelResult("first", "response-1"),
      modelResult("refreshed", "response-2"),
      modelResult("bypassed", "response-3"),
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const cache = new MemoryGenerationCache();
  const operation = {
    name: "cache-mode-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  assertEquals((await runGeneration(operation, "input", { cache }, model)).value, "first");
  assertEquals(
    (await runGeneration(operation, "input", { cache, cacheMode: "refresh" }, model)).value,
    "refreshed",
  );
  assertEquals((await runGeneration(operation, "input", { cache }, model)).value, "refreshed");
  assertEquals(
    (await runGeneration(operation, "input", { cache, cacheMode: "bypass" }, model)).value,
    "bypassed",
  );
  assertEquals((await runGeneration(operation, "input", { cache }, model)).value, "refreshed");
  assertEquals(languageModel.doGenerateCalls.length, 3);
});

Deno.test("runGeneration single-flights identical cold requests before prompt warmup", async () => {
  const enteredProvider = Promise.withResolvers<void>();
  const releaseProvider = Promise.withResolvers<void>();
  const languageModel = new MockLanguageModelV4({
    async doGenerate() {
      enteredProvider.resolve();
      await releaseProvider.promise;
      return modelResult("accepted", "response-1");
    },
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "singleflight-test",
    validationVersion: 1,
    system: "Unique stable single-flight system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [
      { role: "user" as const, content: "Stable example" },
      { role: "assistant" as const, content: '{"value":"example"}' },
      { role: "user" as const, content: input },
    ],
    stableMessageCount: 2,
    validate: (_input: string, output: { value: string }) => ({ value: output.value }),
  };
  const firstAttempts: number[] = [];
  const secondAttempts: number[] = [];

  const firstPromise = runGeneration(
    operation,
    "same input",
    {
      onAttempt(attempt) {
        firstAttempts.push(attempt.number);
      },
    },
    model,
  );
  const secondPromise = runGeneration(
    operation,
    "same input",
    {
      onAttempt(attempt) {
        secondAttempts.push(attempt.number);
      },
    },
    model,
  );
  await enteredProvider.promise;
  // Let both invocations finish hashing. The second must join before either cold call can pass
  // through the prompt-warmup barrier as a separate paid generation.
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(languageModel.doGenerateCalls.length, 1);
  releaseProvider.resolve();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const paidIndex = [first, second].findIndex(({ metadata }) => metadata.cacheStatus === "miss");
  assert(paidIndex !== -1);
  const paid = [first, second][paidIndex];
  const shared = [first, second][1 - paidIndex];
  assertEquals([first.metadata.cacheStatus, second.metadata.cacheStatus].sort(), [
    "miss",
    "shared",
  ]);
  assertEquals(paid.metadata.usage.inputTokens, 100);
  assertEquals(paid.metadata.sourceUsage?.inputTokens, 100);
  assertEquals(shared.metadata.attempts, []);
  assertEquals(shared.metadata.usage.inputTokens, 0);
  assertEquals(shared.metadata.sourceUsage?.inputTokens, 100);
  assertEquals(shared.metadata.sourceGeneration?.attempts.length, 1);
  assertEquals([firstAttempts, secondAttempts][paidIndex], [1]);
  assertEquals([firstAttempts, secondAttempts][1 - paidIndex], []);
  assertEquals(languageModel.doGenerateCalls.length, 1);

  paid.value.value = "mutated";
  assertEquals(shared.value, { value: "accepted" });
});

Deno.test("runGeneration snapshots concurrent caller input before yielding", async () => {
  const enteredProvider = Promise.withResolvers<void>();
  const releaseProvider = Promise.withResolvers<void>();
  const languageModel = new MockLanguageModelV4({
    async doGenerate() {
      enteredProvider.resolve();
      await releaseProvider.promise;
      return modelResult("original", "response-1");
    },
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "input-snapshot-test",
    validationVersion: 1,
    system: "Unique input snapshot system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: { request: string; expected: string }) => [{
      role: "user" as const,
      content: input.request,
    }],
    stableMessageCount: 0,
    validate: (input: { request: string; expected: string }, output: { value: string }) => {
      assertEquals(output.value, input.expected);
      return `${input.request}:${output.value}`;
    },
  };
  const input = { request: "original request", expected: "original" };

  const firstPromise = runGeneration(operation, input, {}, model);
  const secondPromise = runGeneration(operation, input, {}, model);
  await enteredProvider.promise;
  input.request = "mutated request";
  input.expected = "mutated";
  releaseProvider.resolve();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assertEquals(first.value, "original request:original");
  assertEquals(second.value, "original request:original");
  assertEquals([first.metadata.cacheStatus, second.metadata.cacheStatus].sort(), [
    "miss",
    "shared",
  ]);
  assertEquals(languageModel.doGenerateCalls.length, 1);
  const providerPrompt = JSON.stringify(languageModel.doGenerateCalls[0].prompt);
  assertStringIncludes(providerPrompt, "original request");
  assertEquals(providerPrompt.includes("mutated request"), false);
});

Deno.test("runGeneration snapshots caller options before yielding", async () => {
  const cacheModel = new MockLanguageModelV4({
    doGenerate: modelResult("cached", "cache-response"),
  });
  const cacheModelConfiguration: ModelConfiguration = {
    id: "options-cache-model@low",
    modelId: "options-cache-model",
    provider: "google",
    model: cacheModel,
    providerOptions: {},
  };
  const operation = {
    name: "options-snapshot-test",
    validationVersion: 1,
    system: "Unique options snapshot system prompt",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [{ role: "user" as const, content: input }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const originalCache = new MemoryGenerationCache();
  const replacementCache = new MemoryGenerationCache();
  await runGeneration(operation, "cached input", { cache: originalCache }, cacheModelConfiguration);

  const mutableCacheOptions = { cache: originalCache };
  const pendingCacheHit = runGeneration(
    operation,
    "cached input",
    mutableCacheOptions,
    cacheModelConfiguration,
  );
  mutableCacheOptions.cache = replacementCache;
  const cacheHit = await pendingCacheHit;
  assertEquals(cacheHit.metadata.cacheStatus, "hit");
  assertEquals(cacheModel.doGenerateCalls.length, 1);

  const observerModel = new MockLanguageModelV4({
    doGenerate: modelResult("observed", "observer-response"),
  });
  const observerModelConfiguration: ModelConfiguration = {
    id: "options-observer-model@low",
    modelId: "options-observer-model",
    provider: "google",
    model: observerModel,
    providerOptions: {},
  };
  let originalObserverCalls = 0;
  let replacementObserverCalls = 0;
  const mutableObserverOptions = {
    cacheMode: "bypass" as const,
    onAttempt() {
      ++originalObserverCalls;
    },
  };
  const pendingObserved = runGeneration(
    operation,
    "observed input",
    mutableObserverOptions,
    observerModelConfiguration,
  );
  mutableObserverOptions.onAttempt = () => {
    ++replacementObserverCalls;
  };
  const observed = await pendingObserved;
  assertEquals(observed.value, "observed");
  assertEquals(originalObserverCalls, 1);
  assertEquals(replacementObserverCalls, 0);
});

Deno.test("runGeneration rejects unknown cache modes before reading the cache", async () => {
  let cacheRead = false;
  const cache = {
    get() {
      cacheRead = true;
      return Promise.resolve(undefined);
    },
    set() {
      return Promise.resolve();
    },
  };
  const operation = {
    name: "invalid-cache-mode-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  await assertRejects(
    () =>
      runGeneration(operation, "input", {
        cache,
        cacheMode: "invalid" as "use",
      }),
    RangeError,
    'cacheMode must be "use", "refresh", or "bypass"',
  );
  assertEquals(cacheRead, false);
});

Deno.test("runGeneration preserves a paid result when cache persistence fails", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "cache-failure-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };
  const cache = {
    get: () => Promise.resolve(undefined),
    set: () => Promise.reject(new Error("cache disk is full")),
  };

  const result = await runGeneration(operation, "input", { cache }, model);
  assertEquals(result.value, "accepted");
  assertEquals(result.metadata.sideEffectErrors, [{
    source: "cache",
    message: "cache disk is full",
  }]);
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration preserves a paid result when attempt telemetry fails", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: modelResult("accepted", "response-1"),
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "telemetry-failure-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const result = await runGeneration(
    operation,
    "input",
    {
      onAttempt: () => {
        throw new Error("telemetry sink failed");
      },
    },
    model,
  );
  assertEquals(result.value, "accepted");
  assertEquals(result.metadata.sideEffectErrors, [{
    source: "onAttempt",
    message: "telemetry sink failed",
  }]);
  assertEquals(languageModel.doGenerateCalls.length, 1);
});

Deno.test("runGeneration regenerates instead of trusting corrupt cached provenance", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      modelResult("accepted", "response-1"),
      modelResult("accepted", "response-2"),
      modelResult("accepted", "response-3"),
      modelResult("accepted", "response-4"),
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "corrupt-cache-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const seedCache = new MemoryGenerationCache();
  const seed = await runGeneration(operation, "input", { cache: seedCache }, model);
  const validRecord = await seedCache.get(seed.metadata.cacheKey) as CompletedGenerationCacheRecord;
  assertExists(validRecord);

  const invalidRecords: readonly { name: string; record: CompletedGenerationCacheRecord }[] = [
    {
      name: "aggregate token usage does not match its partitions",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          usage: {
            ...validRecord.provenance.usage,
            inputTokens: validRecord.provenance.usage.inputTokens + 1,
          },
        },
      },
    },
    {
      name: "prompt fingerprint does not match the request",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          fingerprints: {
            ...validRecord.provenance.fingerprints,
            basePrompt: "wrong-base-prompt",
          },
        },
      },
    },
    {
      name: "aggregate usage does not match its attempts",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          attempts: [{
            ...validRecord.provenance.attempts[0],
            usage: {
              ...validRecord.provenance.attempts[0].usage,
              providerUsageInconsistent: true,
            },
          }],
        },
      },
    },
  ];

  for (const { name, record } of invalidRecords) {
    let cacheWrite: unknown;
    const cache = {
      get: () => Promise.resolve(record),
      set: (_key: string, value: unknown) => {
        cacheWrite = value;
        return Promise.resolve();
      },
    };
    const generated = await runGeneration(operation, "input", { cache }, model);
    assertEquals(generated.value, "accepted", name);
    assertEquals(generated.metadata.cacheStatus, "miss", name);
    assertExists(cacheWrite, name);
  }
  assertEquals(languageModel.doGenerateCalls.length, invalidRecords.length + 1);
});

Deno.test("runGeneration rejects impossible cached success attempt sequences", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: Array.from(
      { length: 8 },
      (_, index) => modelResult("fresh", `response-${index + 1}`),
    ),
  });
  const model: ModelConfiguration = {
    id: "cached-attempt-state-model@low",
    modelId: "cached-attempt-state-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "cached-attempt-state-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: (input: string) => [{ role: "user" as const, content: input }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => output.value,
  };

  const seedCache = new MemoryGenerationCache();
  const seed = await runGeneration(operation, "input", { cache: seedCache }, model);
  const validRecord = await seedCache.get(seed.metadata.cacheKey) as CompletedGenerationCacheRecord;
  assertExists(validRecord);
  const acceptedAttempt = validRecord.provenance.attempts[0];
  const invalidRecords: readonly { name: string; record: unknown }[] = [
    {
      name: "attempt model differs from record model",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          attempts: [{ ...acceptedAttempt, modelConfigurationId: "different-model@low" }],
        },
      },
    },
    {
      name: "successful record ends in a request error",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          attempts: [{ ...acceptedAttempt, requestError: "transport failed" }],
        },
      },
    },
    {
      name: "successful record ends in a validation error",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          attempts: [{ ...acceptedAttempt, validationError: "invalid output" }],
        },
      },
    },
    {
      name: "nonfinal attempt has no validation error",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          attempts: [acceptedAttempt, { ...acceptedAttempt, number: 2 }],
          usage: addGenerationUsage(acceptedAttempt.usage, acceptedAttempt.usage),
        },
      },
    },
    {
      name: "successful final attempt retains rejected output",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          attempts: [{ ...acceptedAttempt, rejectedOutput: { value: "previously rejected" } }],
        },
      },
    },
    {
      name: "record and final attempt report different response models",
      record: { ...validRecord, responseModelId: "different-response-model" },
    },
    {
      name: "cached provenance contains malformed fingerprints",
      record: {
        ...validRecord,
        provenance: {
          ...validRecord.provenance,
          fingerprints: { basePrompt: "incomplete" },
        },
      },
    },
  ];

  for (const { name, record } of invalidRecords) {
    const cache = {
      get: () => Promise.resolve(record),
      set: () => Promise.resolve(),
    };
    const generated = await runGeneration(operation, "input", { cache }, model);
    assertEquals(generated.value, "fresh", name);
    assertEquals(generated.metadata.cacheStatus, "miss", name);
  }
  assertEquals(languageModel.doGenerateCalls.length, invalidRecords.length + 1);
});

Deno.test("runGeneration exposes every paid attempt when corrective retries are exhausted", async () => {
  const languageModel = new MockLanguageModelV4({
    doGenerate: [
      modelResult("first-invalid", "response-1"),
      modelResult("second-invalid", "response-2"),
    ],
  });
  const model: ModelConfiguration = {
    id: "mock-model@low",
    modelId: "mock-model",
    provider: "google",
    model: languageModel,
    providerOptions: {},
  };
  const operation = {
    name: "exhausted-test",
    validationVersion: 1,
    system: "System",
    outputSchema: z.object({ value: z.string() }),
    messages: () => [{ role: "user" as const, content: "Input" }],
    stableMessageCount: 0,
    validate: (_input: string, output: { value: string }) => {
      throw new Error(`Rejected ${output.value}`);
    },
  };

  const error = await assertRejects(
    () => runGeneration(operation, "input", { maxAttempts: 2 }, model),
    GenerationAttemptsExhaustedError,
    "failed deterministic validation after 2 attempts",
  );

  assertEquals(error.errors.length, 2);
  assertEquals(error.attempts.length, 2);
  assertEquals(error.attempts.map((attempt) => attempt.rejectedOutput), [
    { value: "first-invalid" },
    { value: "second-invalid" },
  ]);
  assertEquals(error.usage.inputTokens, 200);
  assertEquals(languageModel.doGenerateCalls.length, 2);
});
