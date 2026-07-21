/**
 * Reprocesses an unresolved-report CSV with the current resolver.
 *
 * Run with:
 *   deno task recover-resolved-from-report <input-report.csv> <recovered.csv> <remaining-report.csv>
 */

import { parseArgs } from "@std/cli/parse-args";
import { parse as parseCSV } from "@std/csv";
import { allJMDictEntries } from "data";
import {
  type CSVRow,
  type ResolutionIssue,
  resolveCSVRows,
} from "../shared/jmdict_resolution/csv_resolution.ts";

const args = parseArgs(Deno.args, { string: ["_"] });
const [inputReportPath, recoveredPath, remainingReportPath] = args._;

if (!inputReportPath || !recoveredPath || !remainingReportPath) {
  console.error(
    "Usage: recover_resolved_from_report.ts <input-report.csv> <recovered.csv> <remaining-report.csv>",
  );
  Deno.exit(1);
}

function escapeCSV(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function writeCSV(file: string, header: string[], rows: unknown[][]): Promise<void> {
  const lines = [header, ...rows].map((row) => row.map(escapeCSV).join(","));
  return Deno.writeTextFile(file, `${lines.join("\n")}\n`);
}

function rowKey(row: Pick<CSVRow, "sentence" | "recognitionTarget">): string {
  return `${row.sentence}\0${row.recognitionTarget}`;
}

function candidateSummary(issue: ResolutionIssue): string {
  return issue.candidateMatches
    .map(({ spelling, entries }) => `${spelling}: ${entries.map((entry) => entry.id).join("/")}`)
    .join(" | ");
}

const rawRows = parseCSV(await Deno.readTextFile(inputReportPath), {
  skipFirstRow: true,
}) as Array<Record<string, string>>;

const fileByRowKey = new Map<string, string>();
const rows: CSVRow[] = rawRows
  .map((raw) => {
    const row = {
      sentence: raw.sentence?.trim() ?? "",
      source: raw.source?.trim() ?? "",
      recognitionTarget: raw.surfaceTarget?.trim() ?? "",
    };
    fileByRowKey.set(rowKey(row), raw.file?.trim() ?? "");
    return row;
  })
  .filter((row) => row.sentence && row.recognitionTarget);

const entries = await allJMDictEntries();
const { resolved, issues } = await resolveCSVRows(rows, entries);

await writeCSV(
  recoveredPath,
  ["sentence", "source", "recognitionTarget", "jmdictId"],
  resolved.map(({ row, entry }) => [
    row.sentence,
    row.source,
    row.recognitionTarget,
    entry.id,
  ]),
);

await writeCSV(
  remainingReportPath,
  [
    "file",
    "source",
    "sentence",
    "surfaceTarget",
    "reason",
    "candidateHeadwords",
    "candidateJmdictIds",
  ],
  issues.map((issue) => [
    fileByRowKey.get(rowKey(issue.row)) ?? "",
    issue.row.source,
    issue.row.sentence,
    issue.row.recognitionTarget,
    issue.reason,
    issue.candidateSpellings.join(" | "),
    candidateSummary(issue),
  ]),
);

console.log(`Wrote ${resolved.length} recovered rows to ${recoveredPath}`);
console.log(`Wrote ${issues.length} remaining unresolved rows to ${remainingReportPath}`);
