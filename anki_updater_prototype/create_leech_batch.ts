/**
 * Creates Miwake cards from a reviewed batch JSON file and pushes them to Anki.
 *
 * Run with:
 *   deno task create-leech-batch <batch-file.json> [--model=gemini-3-pro-preview] [--dry-run]
 */

import { createCard } from "../card_creator/src/mod.ts";
import { generateCardFields } from "../card_creator/src/ai_provider.ts";
import type { ModelId } from "../card_creator/src/ai_provider.ts";
import { MODEL_IDS } from "../card_creator/src/ai_provider.ts";
import type { MiwakeCard } from "../card_creator/src/types.ts";
import { allJMDictEntries } from "../data/mod.ts";

// --- CLI args ---

let batchFile: string | undefined;
let modelId: ModelId = "gemini-3-pro-preview";
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
    batchFile = arg;
  }
}

if (!batchFile) {
  console.error("Usage: create_leech_batch.ts <batch-file.json> [--model=...] [--dry-run]");
  Deno.exit(1);
}

// --- AnkiConnect ---

type ACParams = Record<string, unknown>;

async function ac<T = unknown>(action: string, params: ACParams = {}): Promise<T> {
  const body = { action, version: 6, params };
  const resp = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.error) throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
  return json.result as T;
}

// --- Load data ---

type BatchEntry = {
  noteId: number;
  word: string;
  jmdictId: string | null;
  originalSentence: string;
  source: string | null;
  context: string | null;
  status: string;
};

const batch: BatchEntry[] = JSON.parse(await Deno.readTextFile(batchFile));
const usable = batch.filter((e) => e.context && e.jmdictId);

console.error(`Loaded ${batch.length} entries, ${usable.length} usable (have context + jmdictId)`);
if (usable.length === 0) {
  console.error("No usable entries. Edit the batch JSON to add context/jmdictId for entries.");
  Deno.exit(0);
}

console.error("Loading JMDict...");
const entries = await allJMDictEntries();

function findJmdictEntry(id: string) {
  const entry = entries.get(id);
  if (!entry) throw new Error(`JMDict id ${id} not found`);
  return entry;
}

// --- Generate cards ---

const cards: Array<{ entry: BatchEntry; card: MiwakeCard }> = [];

for (const entry of usable) {
  console.error(`\nGenerating card for: ${entry.word}`);

  const jmdictEntry = findJmdictEntry(entry.jmdictId!);

  const card = await createCard({
    input: {
      context: entry.context!,
      jmdictId: entry.jmdictId!,
      recognitionTarget: entry.word,
      source: entry.source ?? undefined,
    },
    jmdictEntry,
    generateFields: (input) => generateCardFields(input, modelId),
  });

  cards.push({ entry, card });

  // Print summary
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
  // Print full card data as JSON to stdout for inspection
  console.log(JSON.stringify(cards.map((c) => c.card), undefined, 2));
  Deno.exit(0);
}

// --- Push to Anki ---

console.error("\nPushing to Anki...");

for (const { entry, card } of cards) {
  // Check if card already exists
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

  // Tag the original leech note as converted
  await ac("addTags", {
    notes: [entry.noteId],
    tags: "converted-to-miwake",
  });
  console.error(`  Tagged original note ${entry.noteId} as converted-to-miwake`);
}

console.error("\nDone!");
