/**
 * Reports normalized recognition-target appearance counts across JLPT CSV files.
 * Accepts either sentence-recognition CSVs with `sentence,source,recognitionTarget[,jmdictId]`
 * or vocab-list CSVs with `recognitionTarget,source`.
 *
 * Run with:
 *   deno task report-vocab-appearances <file-or-directory> <output.csv> [--min=1]
 */

import { parseArgs } from "@std/cli/parse-args";
import { parse as parseCSV } from "@std/csv";
import * as path from "@std/path";
import { allJMDictEntries } from "data";
import { type CSVRow, resolveCSVRows } from "../shared/jmdict_resolution/csv_resolution.ts";

const {
  _: [inputPath, outputPath],
  min: minAppearances,
} = parseArgs(Deno.args, {
  string: ["_"],
  default: { min: 1 },
});

if (
  typeof minAppearances !== "number" ||
  !Number.isSafeInteger(minAppearances) ||
  minAppearances < 1
) {
  console.error(`Invalid --min value: ${minAppearances}`);
  Deno.exit(1);
}

if (!inputPath || !outputPath) {
  console.error("Usage: report_vocab_appearances.ts <file-or-directory> <output.csv> [--min=1]");
  Deno.exit(1);
}

function escapeCSV(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

async function inputFiles(input: string): Promise<string[]> {
  const stat = await Deno.stat(input);
  if (stat.isFile) {
    return [input];
  }
  if (!stat.isDirectory) {
    throw new Error(`${input} is neither a file nor a directory`);
  }

  const files: string[] = [];
  for await (const entry of Deno.readDir(input)) {
    if (entry.isFile && entry.name.endsWith("_moji-goi.csv")) {
      files.push(path.join(input, entry.name));
    }
  }
  return files.sort();
}

async function readRows(file: string): Promise<CSVRow[]> {
  const csvText = await Deno.readTextFile(file);
  const rawRows = parseCSV(csvText, { skipFirstRow: true }) as Array<Record<string, string>>;
  const rows: CSVRow[] = [];

  for (const raw of rawRows) {
    const recognitionTarget = raw.recognitionTarget?.trim() ?? "";
    if (!recognitionTarget) {
      continue;
    }
    const sentence = raw.sentence?.trim() || recognitionTarget;
    rows.push({
      sentence,
      source: raw.source?.trim() ?? "",
      recognitionTarget,
      jmdictId: raw.jmdictId?.trim() || undefined,
    });
  }

  return rows;
}

function increment(counts: Map<string, number>, recognitionTarget: string): void {
  counts.set(recognitionTarget, (counts.get(recognitionTarget) ?? 0) + 1);
}

const entries = await allJMDictEntries();
const counts = new Map<string, number>();
let totalRows = 0;
let normalizedRows = 0;
let fallbackRows = 0;

for (const file of await inputFiles(inputPath)) {
  const rows = await readRows(file);
  totalRows += rows.length;

  const { resolved, issues } = await resolveCSVRows(rows, entries);
  for (const { recognitionTarget } of resolved) {
    increment(counts, recognitionTarget);
    normalizedRows += 1;
  }
  for (const { row } of issues) {
    increment(counts, row.recognitionTarget);
    fallbackRows += 1;
  }
}

const collator = new Intl.Collator("ja");
const reportRows = [...counts.entries()]
  .filter(([, appearances]) => appearances >= minAppearances)
  .sort(([aTarget, aCount], [bTarget, bCount]) =>
    bCount - aCount || collator.compare(aTarget, bTarget)
  );

const lines = [
  ["recognitionTarget", "appearances"],
  ...reportRows.map(([recognitionTarget, appearances]) => [recognitionTarget, appearances]),
].map((row) => row.map(escapeCSV).join(","));

await Deno.writeTextFile(outputPath, `${lines.join("\n")}\n`);

console.log(`Read ${totalRows} rows.`);
console.log(
  `Normalized ${normalizedRows} rows; used raw fallback for ${fallbackRows} unresolved rows.`,
);
console.log(
  `Wrote ${reportRows.length} rows with appearances >= ${minAppearances} to ${outputPath}`,
);
