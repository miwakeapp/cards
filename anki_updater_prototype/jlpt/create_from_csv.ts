/**
 * Creates Miwake cards from a CSV file and pushes them to Anki.
 *
 * CSV columns (header row required):
 *   sentence,source,recognitionTarget[,jmdictId]
 *
 * - `sentence`: source context (may include <ruby> tags). Target location and reading selection are
 *   deterministic; AI selects senses, writes a hint when needed, and minimizes long context.
 * - `source`: optional source name (e.g., book title). May be empty.
 * - `recognitionTarget`: the spelling being tested.
 * - `jmdictId`: optional. If omitted, resolved automatically by matching the
 *   recognition target against JMDict (preferring kanji forms over kana).
 *
 * Run with:
 *   deno task create-from-csv <file.csv> [--model=claude-opus-5] [--dry-run]
 */

import { parseArgs } from "@std/cli/parse-args";
import { parse as parseCSV } from "@std/csv";
import * as path from "@std/path";
import type { MiwakeCard } from "card_creator";
import { buildSpellingIndex, findAllEntriesBySpelling } from "card_resolution";
import { allJMDictEntries } from "data";
import { MODEL_IDS, type ModelId } from "card_field_generation";
import { JSONLGenerationCache } from "card_field_generation/file-cache";
import { ac } from "../shared/anki_connect.ts";
import {
  type CSVRow,
  formatResolutionIssue,
  resolveCSVRows,
} from "../shared/jmdict_resolution/csv_resolution.ts";
import { generateJLPTCard } from "./generate_card.ts";

// --- CLI args ---

const args = parseArgs(Deno.args, {
  boolean: ["dry-run"],
  string: ["_", "model", "cache"],
});
const [csvFile] = args._;
const modelId = args.model as ModelId | undefined;

if (modelId !== undefined && !MODEL_IDS.includes(modelId)) {
  console.error(`Unknown model: ${modelId}. Available: ${MODEL_IDS.join(", ")}`);
  Deno.exit(1);
}

const dryRun = args["dry-run"];

if (!csvFile) {
  console.error("Usage: create_from_csv.ts <file.csv> [--model=...] [--cache=...] [--dry-run]");
  Deno.exit(1);
}

// --- Load CSV ---

const csvText = await Deno.readTextFile(csvFile);
const rawRows = parseCSV(csvText, { skipFirstRow: true }) as Array<Record<string, string>>;

const rows: CSVRow[] = [];
for (const [i, raw] of rawRows.entries()) {
  const sentence = raw.sentence?.trim() ?? "";
  const recognitionTarget = raw.recognitionTarget?.trim() ?? "";
  if (!sentence || !recognitionTarget) {
    console.error(`Row ${i + 2}: missing sentence or recognitionTarget, skipping`);
    continue;
  }
  rows.push({
    sentence,
    source: raw.source?.trim() ?? "",
    recognitionTarget,
    jmdictId: raw.jmdictId?.trim() || undefined,
  });
}

console.error(`Loaded ${rows.length} rows from ${csvFile}`);
if (rows.length === 0) Deno.exit(0);

// --- Resolve JMDict ---

console.error("Loading JMDict...");
const entries = await allJMDictEntries();
const { resolved, issues } = await resolveCSVRows(rows, entries);
const spellingIndex = buildSpellingIndex(entries.values());

for (const issue of issues) {
  console.error(formatResolutionIssue(issue));
}

console.error(`\nResolved ${resolved.length}/${rows.length} rows.`);
if (resolved.length === 0) Deno.exit(0);

// --- Generate cards ---

const cards: Array<{ row: CSVRow; card: MiwakeCard }> = [];
const generationCache = new JSONLGenerationCache(
  args.cache ??
    path.join(import.meta.dirname!, "..", "generated", "card-field-generation-cache.jsonl"),
);

for (const { row, entry, recognitionTarget: cardTarget } of resolved) {
  if (cardTarget === row.recognitionTarget) {
    console.error(`\nGenerating card for: ${row.recognitionTarget}`);
  } else {
    console.error(`\nGenerating card for: ${row.recognitionTarget} → ${cardTarget}`);
  }

  const card = await generateJLPTCard({
    sentence: row.sentence,
    source: row.source,
    recognitionTarget: cardTarget,
    entry,
    sameSpellingEntries: findAllEntriesBySpelling(spellingIndex, cardTarget),
  }, {
    ...(modelId === undefined ? {} : { modelId }),
    cache: generationCache,
    maxAttempts: 3,
  });

  cards.push({ row, card });

  console.error(`  Key: ${card.key}`);
  console.error(`  Reading: ${card.reading ?? "(none)"}`);
  console.error(`  Hint: ${card.hint ?? "(none)"}`);
  console.error(`  Full context: ${card.fullContext}`);
  console.error(`  Minimized: ${card.minimizedContext ?? "(none)"}`);
  console.error(`  Source: ${card.source ?? "(none)"}`);
}

console.error(`\nGenerated ${cards.length} cards.`);

if (dryRun) {
  console.error("Dry run — not pushing to Anki.");
  console.log(JSON.stringify(cards.map((c) => c.card), undefined, 2));
  Deno.exit(0);
}

// --- Push to Anki ---

console.error("\nPushing to Anki...");

for (const { card } of cards) {
  const existing = await ac<number[]>("findNotes", {
    query: `deck:Mining Key:"${card.key}"`,
  });
  if (existing.length > 0) {
    console.error(`  Skipping ${card.recognitionTarget} (already exists: ${card.key})`);
    continue;
  }

  const fields: Record<string, string> = {
    "Key": card.key,
    "Recognition target": card.recognitionTarget,
    "Reading": card.reading ?? "",
    "Hint": card.hint ?? "",
    "Full context": card.fullContext,
    "Minimized context": card.minimizedContext ?? "",
    "Dictionary entry": card.dictionaryEntry,
    "Source": card.source ?? "",
  };

  const note = {
    deckName: "Mining",
    modelName: "Miwake",
    fields,
    tags: ["miwake-prototype"],
  };

  await ac("addNote", { note });
  console.error(`  Added: ${card.recognitionTarget} (${card.key})`);
}

console.error("\nDone!");
