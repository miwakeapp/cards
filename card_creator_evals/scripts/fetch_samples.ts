/**
 * Fetches sample cards from Anki's Mining deck to create eval inputs.
 * This is somewhat specific to Domenic's existing Animecards/Anki setup, but the resulting baseline
 * Run with: deno task fetch-samples
 */

import * as path from "@std/path";
import { YankiConnect } from "yanki-connect";
import type { EvalInput } from "../src/types.ts";

const DECK_NAME = "Mining";
const SAMPLE_COUNT = 10;
const OUTPUT_DIR = path.resolve(import.meta.dirname!, "../inputs");

/**
 * Extracts the JMDict ID from an Animecards Glossary field.
 * The Glossary field contains HTML with a link like "?q=1234567".
 */
function extractJMdictIdFromGlossary(glossary: string): string | null {
  const match = glossary.match(/q=(\d+)/);
  return match ? match[1] : null;
}

console.log("Connecting to Anki...");
const client = new YankiConnect();

console.log(`Fetching ${SAMPLE_COUNT} recent notes from "${DECK_NAME}" deck...`);

const noteIds = await client.note.findNotes({ query: `deck:"${DECK_NAME}"` });

// Sort by noteId descending (higher ID = more recent) and take limit
const sortedIds = noteIds.sort((a, b) => b - a).slice(0, SAMPLE_COUNT);

if (sortedIds.length === 0) {
  console.error(`No notes found in deck "${DECK_NAME}".`);
  Deno.exit(1);
}

const notes = await client.note.notesInfo({ notes: sortedIds });

console.log(`Found ${notes.length} notes. Processing...`);

// First pass: collect all valid notes
const validNotes: { word: string; sentence: string; jmdictId: string }[] = [];

for (const note of notes) {
  const fields = note.fields;

  // Extract the word (recognition target)
  const word = fields.Word?.value;
  if (!word) {
    console.warn(`Skipping note ${note.noteId}: no Word field`);
    continue;
  }

  // Extract context from Sentence field
  const sentence = fields.Sentence?.value;
  if (!sentence) {
    console.warn(`Skipping note ${note.noteId}: no Sentence field`);
    continue;
  }

  // Extract JMDict ID from Glossary field
  const glossary = fields.Glossary?.value ?? "";
  const jmdictId = extractJMdictIdFromGlossary(glossary);
  if (!jmdictId) {
    console.warn(`Skipping note ${note.noteId}: could not extract JMDict ID from Glossary`);
    continue;
  }

  validNotes.push({ word, sentence, jmdictId });
}

// Second pass: assign IDs based on recognitionTarget with deduplication
const wordCounts = new Map<string, number>();
const evalInputs: EvalInput[] = [];

for (const { word, sentence, jmdictId } of validNotes) {
  const count = (wordCounts.get(word) ?? 0) + 1;
  wordCounts.set(word, count);

  const id = count === 1 ? word : `${word}-${count}`;

  evalInputs.push({
    id,
    context: sentence,
    jmdictId,
    recognitionTarget: word,
  });
}

if (evalInputs.length === 0) {
  console.error("No valid notes could be processed.");
  Deno.exit(1);
}

// Write each input as a separate JSON file
console.log(`\nWriting ${evalInputs.length} eval inputs to ${OUTPUT_DIR}/`);

await Deno.mkdir(OUTPUT_DIR, { recursive: true });
for (const input of evalInputs) {
  const filename = `${input.id}.json`;
  const filepath = `${OUTPUT_DIR}/${filename}`;
  await Deno.writeTextFile(filepath, JSON.stringify(input, undefined, 2) + "\n");
  console.log(`  ${filename}: ${input.recognitionTarget} (${input.jmdictId})`);
}

console.log("\nDone!");
