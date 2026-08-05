/** Runs operation-specific card-field evals with persistent result caching and audit artifacts. */

import { parseArgs } from "@std/cli";
import * as path from "@std/path";
import {
  addGenerationUsage,
  EMPTY_GENERATION_USAGE,
  FIELD_GENERATION_OPERATIONS,
  generateSourceGroundedHint,
  type GenerationAttempt,
  generationCacheKey,
  type GenerationOptions,
  type GenerationUsage,
  isAIQuotaError,
  minimizeContext,
  MODEL_IDS,
  type ModelId,
  type ReasoningEffort,
  selectAdditionalReadingsForCard,
  selectSensesForCard,
} from "card_field_generation";
import { JSONLGenerationCache } from "card_field_generation/file-cache";
import { assertEvalSpendingApproved, parseEvalCacheMode } from "../src/cli.ts";
import { mapConcurrent } from "../src/concurrency.ts";
import {
  type EvalOperationConfiguration,
  evalOperationConfigurations,
} from "../src/configurations.ts";
import { loadEvalFixtures } from "../src/fixtures.ts";
import {
  assertEvalFixtureGenerationInputs,
  evalFixtureHashContent,
  evalFixtureSetHashContent,
  hintGenerationInput,
  readingSelectionInput,
  senseSelectionInput,
} from "../src/generation_inputs.ts";
import { writeRunArtifacts } from "../src/report.ts";
import { scoreEvalValue, summarizeResults } from "../src/scoring.ts";
import {
  COST_ESTIMATE_DISCLAIMER,
  PRICING_AS_OF,
  PRICING_SOURCE_URLS,
  totalEstimatedUSDCost,
} from "../src/pricing.ts";
import { selectFixtures } from "../src/selection.ts";
import type {
  EvalCacheMode,
  EvalCaseResult,
  EvalFixture,
  EvalModelConfiguration,
  EvalOperation,
  EvalRun,
  EvalValue,
  FailedEvalCaseResult,
  SuccessfulEvalCaseResult,
} from "../src/types.ts";

const BASE_DIRECTORY = path.resolve(import.meta.dirname!, "..");
const GENERATED_DIRECTORY = path.join(BASE_DIRECTORY, "generated");
const CACHE_PATH = path.join(GENERATED_DIRECTORY, "cache.jsonl");
const RUNS_DIRECTORY = path.join(GENERATED_DIRECTORY, "runs");
const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
interface CLIOptions {
  modelOverrides?: ModelId[];
  reasoningEffortOverrides?: ReasoningEffort[];
  operations: EvalOperation[];
  caseFilters: string[];
  sampleSize?: number;
  sampleSeed: string;
  concurrency: number;
  maxAttempts: number;
  cacheMode: EvalCacheMode;
  dryRun: boolean;
  allowExpensiveRun: boolean;
}

function usage(): string {
  return `Run focused card-field generation evals.

Usage:
  deno task run [options]

Options:
  --model <id>          Override every selected operation's model; repeatable. Use "all" for every preset.
  --effort <level>      Override every selected operation's effort; repeatable. Use "all" for every level.
  --operation <name>    context-minimization, hint, reading-selection, or sense-selection; repeatable. Defaults to all.
  --case <substring>    Run fixture IDs containing this text; repeatable.
  --sample <count>      Deterministic development sample, stratified by operation and outcome.
  --seed <text>         Sample ordering seed. Defaults to sample-v1.
  --concurrency <count> Maximum simultaneous generation operations. Defaults to 4.
  --max-attempts <n>    Validation-aware corrective rounds per case. Defaults to 3.
  --cache-mode <mode>   use, refresh, or bypass completed results. Defaults to use.
  --allow-expensive-run Explicitly approve a plan above the provider-attempt safety limit.
  --dry-run             Print the selected matrix without calling providers or writing artifacts.
  --help                Show this help.

Examples:
  deno task run --dry-run --sample 30
  deno task run --model gemini-3.6-flash --effort low --sample 30
  deno task run --cache-mode refresh --sample 30
  deno task run --operation context-minimization --case 執刀
  deno task run --model claude-sonnet-5 --operation hint --case ハイタッチ`;
}

function positiveInteger(
  raw: string | undefined,
  option: string,
  fallback?: number,
): number {
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || !/^[1-9]\d*$/u.test(raw)) {
    throw new Error(
      `${option} must be a positive integer; received ${JSON.stringify(raw)}`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${option} is too large: ${raw}`);
  }
  return value;
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)];
}

function parseCLIOptions(): CLIOptions {
  const args = parseArgs(Deno.args, {
    boolean: ["allow-expensive-run", "dry-run", "help"],
    string: [
      "case",
      "cache-mode",
      "concurrency",
      "effort",
      "max-attempts",
      "model",
      "operation",
      "sample",
      "seed",
    ],
    collect: ["case", "effort", "model", "operation"],
    alias: { h: "help" },
    unknown: (argument) => {
      throw new Error(`Unknown argument: ${argument}`);
    },
  });
  if (args.help) {
    console.log(usage());
    Deno.exit();
  }

  const modelOverrides = args.model.length === 0
    ? undefined
    : args.model.includes("all")
    ? [...MODEL_IDS]
    : args.model.map((modelId) => {
      if (!MODEL_IDS.includes(modelId as ModelId)) {
        throw new Error(
          `Unknown model ${JSON.stringify(modelId)}; expected ${MODEL_IDS.join(", ")}`,
        );
      }
      return modelId as ModelId;
    });

  const reasoningEffortOverrides = args.effort.length === 0
    ? undefined
    : args.effort.includes("all")
    ? [...REASONING_EFFORTS]
    : args.effort.map((effort) => {
      if (!REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
        throw new Error(
          `Unknown reasoning effort ${JSON.stringify(effort)}; expected ${
            REASONING_EFFORTS.join(", ")
          }`,
        );
      }
      return effort as ReasoningEffort;
    });

  const rawOperations = args.operation.length === 0
    ? [...FIELD_GENERATION_OPERATIONS]
    : args.operation;
  const operations = rawOperations.map((operation) => {
    if (!FIELD_GENERATION_OPERATIONS.includes(operation as EvalOperation)) {
      throw new Error(
        `Unknown operation ${JSON.stringify(operation)}; expected ${
          FIELD_GENERATION_OPERATIONS.join(", ")
        }`,
      );
    }
    return operation as EvalOperation;
  });

  const cacheMode = parseEvalCacheMode(args["cache-mode"]);

  if (args._.length > 0) {
    throw new Error(`Unexpected positional argument(s): ${args._.join(" ")}`);
  }
  return {
    ...(modelOverrides === undefined ? {} : { modelOverrides: unique(modelOverrides) }),
    ...(reasoningEffortOverrides === undefined
      ? {}
      : { reasoningEffortOverrides: unique(reasoningEffortOverrides) }),
    operations: unique(operations),
    caseFilters: unique(args.case),
    sampleSize: args.sample === undefined ? undefined : positiveInteger(args.sample, "--sample"),
    sampleSeed: args.seed ?? "sample-v1",
    concurrency: positiveInteger(args.concurrency, "--concurrency", 4),
    maxAttempts: positiveInteger(args["max-attempts"], "--max-attempts", 3),
    cacheMode,
    dryRun: args["dry-run"],
    allowExpensiveRun: args["allow-expensive-run"],
  };
}

function usageForAttempts(
  attempts: readonly GenerationAttempt[],
): GenerationUsage {
  return attempts.reduce(
    (total, attempt) => addGenerationUsage(total, attempt.usage),
    { ...EMPTY_GENERATION_USAGE },
  );
}

function errorDetails(error: unknown): FailedEvalCaseResult["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: "NonError", message: String(error) };
}

async function generateValue(
  fixture: EvalFixture,
  options: GenerationOptions,
) {
  if (fixture.operation === "context-minimization") {
    return await minimizeContext(fixture.input, options);
  }
  if (fixture.operation === "hint") {
    return await generateSourceGroundedHint(await hintGenerationInput(fixture), options);
  }
  if (fixture.operation === "reading-selection") {
    return await selectAdditionalReadingsForCard(await readingSelectionInput(fixture), options);
  }
  return await selectSensesForCard(await senseSelectionInput(fixture), options);
}

function attemptProgress(
  slot: number,
  totalSlots: number,
  fixture: EvalFixture,
  configuration: EvalModelConfiguration,
  attempt: GenerationAttempt,
): void {
  const outcome = attempt.validationError === undefined && attempt.requestError === undefined
    ? "accepted"
    : attempt.validationError === undefined
    ? `request error: ${attempt.requestError}`
    : `rejected: ${attempt.validationError}`;
  console.log(
    `[${slot}/${totalSlots}] ${configuration.modelId}@${configuration.reasoningEffort} ${fixture.operation} ${fixture.id} attempt ${attempt.number}: ${outcome} (${attempt.usage.inputTokens} in, ${attempt.usage.outputTokens} out, ${
      (attempt.latencyMilliseconds / 1000).toFixed(1)
    } s)`,
  );
}

async function runCase(
  fixture: EvalFixture,
  configuration: EvalModelConfiguration,
  cache: JSONLGenerationCache,
  cacheMode: EvalCacheMode,
  maxAttempts: number,
  slot: number,
  totalSlots: number,
  recordResult: (result: EvalCaseResult) => void,
): Promise<EvalCaseResult> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const attempts: GenerationAttempt[] = [];
  const fixtureHash = await generationCacheKey(await evalFixtureHashContent(fixture));
  try {
    const generated = await generateValue(fixture, {
      modelId: configuration.modelId,
      reasoningEffort: configuration.reasoningEffort === "disabled"
        ? "low"
        : configuration.reasoningEffort,
      cache,
      cacheMode,
      maxAttempts,
      onAttempt(attempt) {
        attempts.push(attempt);
        attemptProgress(slot, totalSlots, fixture, configuration, attempt);
      },
    });
    const result: SuccessfulEvalCaseResult = {
      status: "success",
      operation: fixture.operation,
      caseId: fixture.id,
      fixtureHash,
      fixtureEvaluation: fixture.evaluation,
      provenance: fixture.provenance,
      input: fixture.input,
      expected: fixture.expected,
      ...configuration,
      startedAt,
      latencyMilliseconds: generated.metadata.latencyMilliseconds,
      attempts: [...generated.metadata.attempts],
      usage: generated.metadata.usage,
      value: generated.value as EvalValue,
      outputHash: await generationCacheKey(generated.value),
      score: scoreEvalValue(fixture, generated.value as EvalValue),
      generation: generated.metadata,
    };
    if (generated.metadata.cacheStatus === "hit") {
      console.log(
        `[${slot}/${totalSlots}] ${configuration.modelId}@${configuration.reasoningEffort} ${fixture.operation} ${fixture.id}: result-cache hit`,
      );
    }
    recordResult(result);
    return result;
  } catch (error) {
    console.error(
      `[${slot}/${totalSlots}] ${configuration.modelId}@${configuration.reasoningEffort} ${fixture.operation} ${fixture.id}: ERROR ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    const result: FailedEvalCaseResult = {
      status: "error",
      operation: fixture.operation,
      caseId: fixture.id,
      fixtureHash,
      fixtureEvaluation: fixture.evaluation,
      provenance: fixture.provenance,
      input: fixture.input,
      expected: fixture.expected,
      ...configuration,
      startedAt,
      latencyMilliseconds: performance.now() - started,
      attempts,
      usage: usageForAttempts(attempts),
      error: errorDetails(error),
    };
    recordResult(result);
    if (isAIQuotaError(error)) throw error;
    return result;
  }
}

async function runConfigurationOperation(
  fixtures: readonly EvalFixture[],
  configuration: EvalModelConfiguration,
  cache: JSONLGenerationCache,
  options: CLIOptions,
  slotOffset: number,
  totalSlots: number,
  recordResult: (result: EvalCaseResult) => void,
): Promise<void> {
  if (fixtures.length === 0) return;
  await mapConcurrent(
    fixtures,
    options.concurrency,
    (fixture, index) =>
      runCase(
        fixture,
        configuration,
        cache,
        options.cacheMode,
        options.maxAttempts,
        slotOffset + index + 1,
        totalSlots,
        recordResult,
      ),
  );
}

function printPlan(
  fixtures: readonly EvalFixture[],
  configurations: readonly EvalOperationConfiguration[],
  options: CLIOptions,
): void {
  const promptOverlapCount = fixtures.filter((fixture) => fixture.evaluation.promptOverlap).length;
  console.log(
    `Selected ${fixtures.length} fixture(s): ${
      fixtures.filter(({ operation }) => operation === "context-minimization").length
    } context-minimization, ${
      fixtures.filter(({ operation }) => operation === "hint").length
    } hint, ${
      fixtures.filter(({ operation }) => operation === "reading-selection").length
    } reading-selection, ${
      fixtures.filter(({ operation }) => operation === "sense-selection").length
    } sense-selection.`,
  );
  console.log(
    `${promptOverlapCount} selected case(s) overlap prompt few-shots and will be excluded from basis-specific metrics.`,
  );
  console.log(
    `${configurations.length} operation/model configuration(s), ${
      providerCallSlotCount(fixtures, configurations)
    } model/case slot(s), concurrency ${options.concurrency}, at most ${options.maxAttempts} attempt(s) per slot, completed-result cache mode ${options.cacheMode}.`,
  );
  for (const configuration of configurations) {
    console.log(
      `- ${configuration.operation}: ${configuration.modelId}@${configuration.reasoningEffort}`,
    );
  }
  if (options.dryRun) {
    console.log("\nDry run; no provider calls or artifacts were written.");
    for (const fixture of fixtures) {
      console.log(
        `- ${fixture.operation}: ${fixture.id}${
          fixture.evaluation.promptOverlap ? " (prompt overlap)" : ""
        }`,
      );
    }
  }
}

function providerCallSlotCount(
  fixtures: readonly EvalFixture[],
  configurations: readonly EvalOperationConfiguration[],
): number {
  return configurations.reduce(
    (count, configuration) =>
      count + fixtures.filter(({ operation }) => operation === configuration.operation).length,
    0,
  );
}

function uniqueModelConfigurations(
  configurations: readonly EvalOperationConfiguration[],
): EvalModelConfiguration[] {
  return [
    ...new Map(
      configurations.map(({ modelId, reasoningEffort }) => [
        `${modelId}\0${reasoningEffort}`,
        { modelId, reasoningEffort },
      ]),
    ).values(),
  ];
}

const cliOptions = parseCLIOptions();
const allFixtures = await loadEvalFixtures();
const selectedFixtures = selectFixtures(
  allFixtures,
  cliOptions.operations,
  cliOptions.caseFilters,
  cliOptions.sampleSize,
  cliOptions.sampleSeed,
);
if (selectedFixtures.length === 0) {
  throw new Error("No eval fixtures match the requested filters");
}
await assertEvalFixtureGenerationInputs(selectedFixtures);
const configurations = evalOperationConfigurations(
  cliOptions.operations,
  cliOptions.modelOverrides,
  cliOptions.reasoningEffortOverrides,
);
const totalSlots = providerCallSlotCount(selectedFixtures, configurations);
printPlan(selectedFixtures, configurations, cliOptions);
assertEvalSpendingApproved({
  providerCallSlots: totalSlots,
  maxAttempts: cliOptions.maxAttempts,
  cacheMode: cliOptions.cacheMode,
  dryRun: cliOptions.dryRun,
  allowExpensiveRun: cliOptions.allowExpensiveRun,
});
if (cliOptions.dryRun) Deno.exit();

const startedAt = new Date().toISOString();
const cache = new JSONLGenerationCache(CACHE_PATH);
const results: EvalCaseResult[] = [];
let slotOffset = 0;
let interruption: EvalRun["interruption"];
try {
  for (const configuration of configurations) {
    const operationFixtures = selectedFixtures.filter((fixture) =>
      fixture.operation === configuration.operation
    );
    await runConfigurationOperation(
      operationFixtures,
      configuration,
      cache,
      cliOptions,
      slotOffset,
      totalSlots,
      (result) => results.push(result),
    );
    slotOffset += operationFixtures.length;
  }
} catch (error) {
  if (!isAIQuotaError(error)) throw error;
  const details = errorDetails(error);
  interruption = {
    reason: "provider-quota",
    error: { name: details.name, message: details.message },
    recordedProviderCallSlots: results.length,
  };
  console.error(
    `Provider quota interrupted the run after ${results.length}/${totalSlots} model/case slot(s); writing partial artifacts before exiting.`,
  );
}

const completedAt = new Date().toISOString();
const runId = `run-${completedAt.replaceAll(":", "-").replaceAll(".", "-")}`;
const summaries = summarizeResults(results, new Date(completedAt));
const run: EvalRun = {
  schemaVersion: 1,
  runId,
  startedAt,
  completedAt,
  ...(interruption === undefined ? {} : { interruption }),
  configuration: {
    models: uniqueModelConfigurations(configurations),
    operations: cliOptions.operations,
    requestedCaseFilters: cliOptions.caseFilters,
    ...(cliOptions.sampleSize === undefined
      ? {}
      : { sampleSize: cliOptions.sampleSize, sampleSeed: cliOptions.sampleSeed }),
    concurrency: cliOptions.concurrency,
    maxAttempts: cliOptions.maxAttempts,
    cacheMode: cliOptions.cacheMode,
  },
  fixtureCounts: {
    available: allFixtures.length,
    selected: selectedFixtures.length,
    selectedPromptOverlaps: selectedFixtures.filter((fixture) => fixture.evaluation.promptOverlap)
      .length,
    providerCallSlots: totalSlots,
  },
  reproducibility: {
    hashAlgorithm: "sha-256-canonical-json",
    selectedFixtureSetHash: await generationCacheKey(
      await evalFixtureSetHashContent(selectedFixtures),
    ),
  },
  costEstimate: {
    currency: "USD",
    pricingAsOf: PRICING_AS_OF,
    total: totalEstimatedUSDCost(summaries.map(({ estimatedCostUSD }) => estimatedCostUSD)),
    ...(summaries.some(({ estimatedCostUSD }) => estimatedCostUSD.uncertain === true)
      ? { uncertain: true as const }
      : summaries.some(({ estimatedCostUSD }) => estimatedCostUSD.lowerBound === true)
      ? { lowerBound: true as const }
      : {}),
    sources: PRICING_SOURCE_URLS,
    disclaimer: COST_ESTIMATE_DISCLAIMER,
  },
  summaries,
  results: results.sort((left, right) =>
    left.modelId.localeCompare(right.modelId) ||
    left.reasoningEffort.localeCompare(right.reasoningEffort) ||
    left.operation.localeCompare(right.operation) ||
    left.caseId.localeCompare(right.caseId)
  ),
};
const artifacts = await writeRunArtifacts(run, RUNS_DIRECTORY);
console.log(`\nJSON: ${artifacts.jsonPath}`);
console.log(`Markdown: ${artifacts.markdownPath}`);
if (interruption !== undefined) Deno.exitCode = 1;
