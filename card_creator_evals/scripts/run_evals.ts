/**
 * Runs AI evals against test inputs and saves outputs for review.
 *
 * Usage:
 *   deno task run                               # Run all models
 *   deno task run --model gemini-3.5-flash  # Run specific model
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { preextractedJMDictEntry } from "data";
import { generateCardFields, MODEL_IDS, type ModelId } from "card_creator";
import type {
  AIGeneratedFields,
  EvalDiff,
  EvalGolden,
  EvalInput,
  EvalOutput,
} from "../src/types.ts";

const BASE_DIR = path.resolve(import.meta.dirname!, "..");
const INPUTS_DIR = path.join(BASE_DIR, "inputs");
const GOLDENS_DIR = path.join(BASE_DIR, "goldens");
const RUNS_DIR = path.join(BASE_DIR, "runs");

function getModelsFromArgs(): ModelId[] {
  const args = parseArgs(Deno.args, {
    string: ["model"],
  });

  if (args.model) {
    const modelId = args.model as ModelId;
    if (!MODEL_IDS.includes(modelId)) {
      console.error(`Unknown model: ${modelId}`);
      console.error(`Available models: ${MODEL_IDS.join(", ")}`);
      Deno.exit(1);
    }
    return [modelId];
  }

  return [...MODEL_IDS];
}

async function loadInputs(): Promise<EvalInput[]> {
  const inputs: EvalInput[] = [];

  for await (const entry of Deno.readDir(INPUTS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      const content = await Deno.readTextFile(path.join(INPUTS_DIR, entry.name));
      inputs.push(JSON.parse(content) as EvalInput);
    }
  }

  return inputs;
}

async function loadGolden(inputId: string): Promise<EvalGolden | null> {
  const goldenPath = path.join(GOLDENS_DIR, `${inputId}.json`);
  try {
    const content = await Deno.readTextFile(goldenPath);
    return JSON.parse(content) as EvalGolden;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return null;
    }
    throw e;
  }
}

function computeDiffs(golden: EvalGolden | null, current: EvalOutput): EvalDiff[] {
  if (!golden) {
    return [{ inputId: current.inputId, field: "(new)", golden: null, current: "new eval" }];
  }

  const diffs: EvalDiff[] = [];
  const fieldsToCompare: (keyof AIGeneratedFields)[] = [
    "applicableSenses",
    "reading",
    "targetInContext",
    "hint",
    "minimizedContext",
    "cleanedSource",
    "sourceURLIsPublic",
  ];

  for (const field of fieldsToCompare) {
    const goldenVal = golden.aiFields[field];
    const currentVal = current.aiFields[field];

    if (JSON.stringify(goldenVal) !== JSON.stringify(currentVal)) {
      diffs.push({
        inputId: current.inputId,
        field,
        golden: goldenVal,
        current: currentVal,
      });
    }
  }

  return diffs;
}

const models = getModelsFromArgs();
console.log(`Running evals for models: ${models.join(", ")}\n`);

const inputs = await loadInputs();

if (inputs.length === 0) {
  console.error("No eval inputs found.");
  Deno.exit(1);
}

console.log(`Found ${inputs.length} eval inputs.\n`);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

for (const modelId of models) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Model: ${modelId}`);
  console.log(`${"=".repeat(60)}\n`);

  const runDir = path.join(RUNS_DIR, `${timestamp}_${modelId}`);
  await Deno.mkdir(runDir, { recursive: true });

  const allDiffs: EvalDiff[] = [];
  let errorCount = 0;

  for (const input of inputs) {
    console.log(`  Processing: ${input.recognitionTarget} (${input.id})...`);

    const jmdictEntry = await preextractedJMDictEntry(input.jmdictId);

    try {
      const aiFields = await generateCardFields(
        {
          context: input.context,
          recognitionTarget: input.recognitionTarget,
          jmdictEntry,
          source: input.source,
          sourceURL: input.sourceURL,
        },
        modelId,
      );

      const output: EvalOutput = {
        inputId: input.id,
        model: modelId,
        timestamp,
        aiFields,
      };

      // Save output
      const outputPath = path.join(runDir, `${input.id}.json`);
      await Deno.writeTextFile(outputPath, JSON.stringify(output, undefined, 2) + "\n");

      // Compare to golden
      const golden = await loadGolden(input.id);
      const diffs = computeDiffs(golden, output);
      allDiffs.push(...diffs);

      if (diffs.length > 0) {
        console.log(`    ${diffs.length} diff(s) from golden`);
      } else {
        console.log(`    Matches golden`);
      }
    } catch (e) {
      errorCount++;
      console.error(`    ERROR: ${e instanceof Error ? e.stack : e}`);
    }
  }

  // Print summary
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Summary for ${modelId}:`);
  console.log(`${"─".repeat(60)}`);

  if (errorCount > 0) {
    console.log(`  ${errorCount} error(s) occurred.`);
  }

  if (allDiffs.length === 0) {
    console.log("  No differences from golden.");
  } else {
    console.log(`  ${allDiffs.length} total difference(s):\n`);
    for (const diff of allDiffs) {
      console.log(`  [${diff.inputId}] ${diff.field}:`);
      console.log(`    golden:  ${JSON.stringify(diff.golden)}`);
      console.log(`    current: ${JSON.stringify(diff.current)}`);
      console.log();
    }
  }

  console.log(`\nOutputs saved to: ${runDir}`);
}
