/**
 * Runs AI evals against test inputs and saves outputs for review.
 *
 * Usage:
 *   deno task eval                               # Run all models
 *   deno task eval --model gemini-3-pro-preview  # Run specific model
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { createCard } from "../src/create_card.ts";
import { generateCardFields, MODEL_IDS, type ModelId } from "../src/ai_provider.ts";

const EVALS_DIR = path.resolve(import.meta.dirname!, "../evals");
const INPUTS_DIR = path.join(EVALS_DIR, "inputs");
const BASELINES_DIR = path.join(EVALS_DIR, "baselines");
const RUNS_DIR = path.join(EVALS_DIR, "runs");

// Path to JMDict for looking up entries
const JMDICT_PATH = path.resolve(
  import.meta.dirname!,
  "../../jmdict_to_html/src/jmdict_eng.json",
);

interface EvalInput {
  id: string;
  context: string;
  jmdictId: string;
  recognitionTarget: string;
}

interface EvalOutput {
  inputId: string;
  model: string;
  timestamp: string;
  card: {
    key: string;
    recognitionTarget: string;
    reading: string | null;
    hint: string | null;
    fullContext: string;
    minimizedContext: string | null;
    source: string | null;
    sourceURL: string | null;
  };
}

interface DiffResult {
  inputId: string;
  field: string;
  baseline: unknown;
  current: unknown;
}

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

async function loadJMdict(): Promise<Map<string, JMdictWord>> {
  console.log("Loading JMDict...");
  const text = await Deno.readTextFile(JMDICT_PATH);
  const data = JSON.parse(text) as { words: JMdictWord[] };

  const map = new Map<string, JMdictWord>();
  for (const word of data.words) {
    map.set(word.id, word);
  }
  console.log(`Loaded ${map.size} entries.`);
  return map;
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

async function loadBaseline(modelId: ModelId, inputId: string): Promise<EvalOutput | null> {
  const baselinePath = path.join(BASELINES_DIR, modelId, `${inputId}.json`);
  try {
    const content = await Deno.readTextFile(baselinePath);
    return JSON.parse(content) as EvalOutput;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return null;
    }
    throw e;
  }
}

function computeDiffs(baseline: EvalOutput | null, current: EvalOutput): DiffResult[] {
  if (!baseline) {
    return [{ inputId: current.inputId, field: "(new)", baseline: null, current: "new eval" }];
  }

  const diffs: DiffResult[] = [];
  const fieldsToCompare = [
    "key",
    "hint",
    "minimizedContext",
    "reading",
  ] as const;

  for (const field of fieldsToCompare) {
    const baselineVal = baseline.card[field];
    const currentVal = current.card[field];

    if (JSON.stringify(baselineVal) !== JSON.stringify(currentVal)) {
      diffs.push({
        inputId: current.inputId,
        field,
        baseline: baselineVal,
        current: currentVal,
      });
    }
  }

  return diffs;
}

const models = getModelsFromArgs();
console.log(`Running evals for models: ${models.join(", ")}\n`);

const jmdict = await loadJMdict();
const inputs = await loadInputs();

if (inputs.length === 0) {
  console.error("No eval inputs found. Run 'deno task fetch-samples' first.");
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

  const allDiffs: DiffResult[] = [];
  let errorCount = 0;

  for (const input of inputs) {
    console.log(`  Processing: ${input.recognitionTarget} (${input.id})...`);

    const jmdictEntry = jmdict.get(input.jmdictId);
    if (!jmdictEntry) {
      console.warn(`    WARNING: JMDict entry ${input.jmdictId} not found, skipping.`);
      continue;
    }

    try {
      const card = await createCard({
        input: {
          context: input.context,
          jmdictId: input.jmdictId,
          recognitionTarget: input.recognitionTarget,
        },
        jmdictEntry,
        modelId: modelId,
        generateFields: generateCardFields,
      });

      const output: EvalOutput = {
        inputId: input.id,
        model: modelId,
        timestamp,
        card: {
          key: card.key,
          recognitionTarget: card.recognitionTarget,
          reading: card.reading,
          hint: card.hint,
          fullContext: card.fullContext,
          minimizedContext: card.minimizedContext,
          source: card.source,
          sourceURL: card.sourceURL,
        },
      };

      // Save output
      const outputPath = path.join(runDir, `${input.id}.json`);
      await Deno.writeTextFile(outputPath, JSON.stringify(output, null, 2) + "\n");

      // Compare to baseline
      const baseline = await loadBaseline(modelId, input.id);
      const diffs = computeDiffs(baseline, output);
      allDiffs.push(...diffs);

      if (diffs.length > 0) {
        console.log(`    ${diffs.length} diff(s) from baseline`);
      } else {
        console.log(`    No changes from baseline`);
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
    console.log("  No differences from baseline.");
  } else {
    console.log(`  ${allDiffs.length} total difference(s):\n`);
    for (const diff of allDiffs) {
      console.log(`  [${diff.inputId}] ${diff.field}:`);
      console.log(`    baseline: ${JSON.stringify(diff.baseline)}`);
      console.log(`    current:  ${JSON.stringify(diff.current)}`);
      console.log();
    }
  }

  console.log(`\nOutputs saved to: ${runDir}`);
}

console.log("\n\nTo accept these results as the new baseline, run:");
console.log(`  deno task eval:accept --run ${timestamp}`);
