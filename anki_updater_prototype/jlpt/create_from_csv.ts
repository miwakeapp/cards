/**
 * Creates Miwake cards from a CSV file and pushes them to Anki.
 *
 * CSV columns (header row required):
 *   sentence,source,recognitionTarget[,jmdictId]
 *
 * - `sentence`: a single sentence (may include <ruby> tags). Used as `context`;
 *   the AI will trim it to a `minimizedContext` if needed.
 * - `source`: optional source name (e.g., book title). May be empty.
 * - `recognitionTarget`: the spelling being tested.
 * - `jmdictId`: optional. If omitted, resolved automatically by matching the
 *   recognition target against JMDict (preferring kanji forms over kana).
 *
 * Run with:
 *   deno task create-from-csv <file.csv> [--model=claude-opus-4-6] [--dry-run]
 */

import { parse as parseCSV } from "@std/csv";
import { createCard } from "../../card_creator/src/mod.ts";
import { generateCardFields } from "../../card_creator/src/ai_provider.ts";
import type { ModelId } from "../../card_creator/src/ai_provider.ts";
import { DEFAULT_MODEL_ID, MODEL_IDS } from "../../card_creator/src/ai_provider.ts";
import type { MiwakeCard } from "../../card_creator/src/types.ts";
import { allJMDictEntries } from "../../data/mod.ts";
import { ac } from "../shared/anki_connect.ts";
import {
  type CSVRow,
  formatResolutionIssue,
  resolveCSVRows,
} from "../shared/jmdict_resolution/csv_resolution.ts";

// --- CLI args ---

let csvFile: string | undefined;
let modelId: ModelId = DEFAULT_MODEL_ID;
let dryRun = false;

for (const arg of Deno.args) {
  if (arg === "--dry-run") {
    dryRun = true;
  } else if (arg.startsWith("--model=")) {
    const m = arg.slice("--model=".length);
    if (!MODEL_IDS.includes(m as ModelId)) {
      console.error(`Unknown model: ${m}. Available: ${MODEL_IDS.join(", ")}`);
      Deno.exit(1);
    }
    modelId = m as ModelId;
  } else if (!arg.startsWith("--")) {
    csvFile = arg;
  }
}

if (!csvFile) {
  console.error("Usage: create_from_csv.ts <file.csv> [--model=...] [--dry-run]");
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

for (const issue of issues) {
  console.error(formatResolutionIssue(issue));
}

console.error(`\nResolved ${resolved.length}/${rows.length} rows.`);
if (resolved.length === 0) Deno.exit(0);

// --- Generate cards ---

const cards: Array<{ row: CSVRow; card: MiwakeCard }> = [];

for (const { row, entry, recognitionTarget: cardTarget } of resolved) {
  if (cardTarget === row.recognitionTarget) {
    console.error(`\nGenerating card for: ${row.recognitionTarget}`);
  } else {
    console.error(`\nGenerating card for: ${row.recognitionTarget} → ${cardTarget}`);
  }

  const card = await createCard({
    input: {
      context: row.sentence,
      jmdictId: entry.id,
      recognitionTarget: cardTarget,
      source: row.source || undefined,
    },
    jmdictEntry: entry,
    generateFields: (input) => generateCardFields(input, modelId),
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
    "Source URL": card.sourceURL ?? "",
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
