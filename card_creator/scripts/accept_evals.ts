/**
 * Promotes eval run outputs to baselines.
 *
 * Usage:
 *   deno task eval:accept --run 2025-12-11T10-30-00             # Accept all models from a run
 *   deno task eval:accept --run 2025-12-11T10-30-00 --model gemini-3-pro-preview  # Accept specific model
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { MODEL_IDS, type ModelId } from "../src/ai_provider.ts";

const EVALS_DIR = path.resolve(import.meta.dirname!, "../evals");
const BASELINES_DIR = path.join(EVALS_DIR, "baselines");
const RUNS_DIR = path.join(EVALS_DIR, "runs");

async function getArgsFromCLI(): Promise<{ runTimestamp: string; model: ModelId | null }> {
  const args = parseArgs(Deno.args, {
    string: ["run", "model"],
  });

  if (!args.run) {
    console.error("Usage: deno task eval:accept --run <timestamp> [--model <name>]");
    console.error("\nAvailable runs:");
    await listRuns();
    Deno.exit(1);
  }

  const model = args.model ? (args.model as ModelId) : null;

  if (model && !MODEL_IDS.includes(model)) {
    console.error(`Unknown model: ${model}`);
    console.error(`Available models: ${MODEL_IDS.join(", ")}`);
    Deno.exit(1);
  }

  return { runTimestamp: args.run, model };
}

async function listRuns() {
  try {
    for await (const entry of Deno.readDir(RUNS_DIR)) {
      if (entry.isDirectory) {
        console.log(`  ${entry.name}`);
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("  (no runs found)");
      return;
    }
    throw e;
  }
}

async function findRunDirs(timestamp: string, model: ModelId | null): Promise<string[]> {
  const dirs: string[] = [];

  for await (const entry of Deno.readDir(RUNS_DIR)) {
    if (entry.isDirectory && entry.name.startsWith(timestamp)) {
      if (model) {
        // Only include if it matches the specific model
        if (entry.name.endsWith(`_${model}`)) {
          dirs.push(path.join(RUNS_DIR, entry.name));
        }
      } else {
        dirs.push(path.join(RUNS_DIR, entry.name));
      }
    }
  }

  return dirs;
}

function extractModelFromDirName(dirName: string): string {
  // Format: 2025-12-11T10-30-00_model-name
  const parts = dirName.split("_");
  return parts.slice(1).join("_");
}

const { runTimestamp, model } = await getArgsFromCLI();

console.log(`Looking for runs matching timestamp: ${runTimestamp}`);
if (model) {
  console.log(`Filtering to model: ${model}`);
}

const runDirs = await findRunDirs(runTimestamp, model);

if (runDirs.length === 0) {
  console.error("\nNo matching run directories found.");
  console.error("Available runs:");
  await listRuns();
  Deno.exit(1);
}

console.log(`\nFound ${runDirs.length} run(s) to process.\n`);

for (const runDir of runDirs) {
  const dirName = path.basename(runDir);
  const modelName = extractModelFromDirName(dirName);

  console.log(`Processing: ${dirName}`);

  const baselineDir = path.join(BASELINES_DIR, modelName);
  await Deno.mkdir(baselineDir, { recursive: true });

  let fileCount = 0;

  for await (const entry of Deno.readDir(runDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      const srcPath = path.join(runDir, entry.name);
      const destPath = path.join(baselineDir, entry.name);

      await Deno.copyFile(srcPath, destPath);
      fileCount++;
    }
  }

  console.log(`  Copied ${fileCount} file(s) to baselines/${modelName}/`);
}

console.log("\nDone! New baselines are ready for commit.");
