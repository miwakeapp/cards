/**
 * Reports CSV rows that the importer cannot resolve to a single JMDict entry.
 *
 * Run with:
 *   deno task report-unresolved-csv <file-or-directory> <output.csv>
 */

import { parseArgs } from "@std/cli/parse-args";
import { parse as parseCSV } from "@std/csv";
import * as path from "@std/path";
import { allJMDictEntries } from "data";
import {
  type CSVRow,
  type ResolutionIssue,
  resolveCSVRows,
} from "../shared/jmdict_resolution/csv_resolution.ts";

const args = parseArgs(Deno.args, { string: ["_"] });
const [inputPath, outputPath] = args._;

if (!inputPath || !outputPath) {
  console.error("Usage: report_unresolved_csv.ts <file-or-directory> <output.csv>");
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
    if (
      entry.isFile &&
      entry.name.endsWith("_moji-goi.csv")
    ) {
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
    const sentence = raw.sentence?.trim() ?? "";
    const recognitionTarget = raw.recognitionTarget?.trim() ?? "";
    if (!sentence || !recognitionTarget) {
      continue;
    }
    rows.push({
      sentence,
      source: raw.source?.trim() ?? "",
      recognitionTarget,
      jmdictId: raw.jmdictId?.trim() || undefined,
    });
  }

  return rows;
}

function issueToReportRow(file: string, issue: ResolutionIssue): string[] {
  const candidateHeadwords = issue.candidateSpellings.join(" | ");
  const candidateJmdictIds = issue.candidateMatches
    .map(({ spelling, entries }) => `${spelling}: ${entries.map((entry) => entry.id).join("/")}`)
    .join(" | ");

  return [
    file,
    issue.row.source,
    issue.row.sentence,
    issue.row.recognitionTarget,
    issue.reason,
    candidateHeadwords,
    candidateJmdictIds,
  ];
}

const entries = await allJMDictEntries();
const reportRows: string[][] = [];

for (const file of await inputFiles(inputPath)) {
  const rows = await readRows(file);
  const { issues } = await resolveCSVRows(rows, entries);
  for (const issue of issues) {
    reportRows.push(issueToReportRow(file, issue));
  }
}

const header = [
  "file",
  "source",
  "sentence",
  "surfaceTarget",
  "reason",
  "candidateHeadwords",
  "candidateJmdictIds",
];
const lines = [header, ...reportRows].map((row) => row.map(escapeCSV).join(","));
await Deno.writeTextFile(outputPath, `${lines.join("\n")}\n`);

console.log(`Wrote ${reportRows.length} unresolved rows to ${outputPath}`);
