import * as path from "@std/path";
import { TextLineStream } from "@std/streams";
import { DatabaseSync } from "node:sqlite";
import { normalizeRarityTerm } from "../rarity_normalization.ts";
import {
  initializeRarityDatabase,
  RARITY_DATABASE_FILENAME,
  UPSERT_BCCWJ_SQL,
  UPSERT_NWJC_SQL,
} from "../rarity_resources.ts";
import { parseBCCWJRow, parseNWJCRow, validateBCCWJHeader } from "./rarity_source_rows.ts";

const dataDir = path.resolve(import.meta.dirname!, "..");
const databasePath = path.join(dataDir, RARITY_DATABASE_FILENAME);
const temporaryDatabasePath = `${databasePath}.download`;
const nwjcSourcePath = path.join(dataDir, "nwjc", "NWJC-surface-1gram.txt");
const bccwjSourcePath = path.join(dataDir, "bccwj", "BCCWJ_frequencylist_luw2_ver1_1.tsv");

await Promise.all([Deno.stat(nwjcSourcePath), Deno.stat(bccwjSourcePath)]);
parseNWJCRow(await readFirstLine(nwjcSourcePath), 1);
validateBCCWJHeader(await readFirstLine(bccwjSourcePath));
await removeIfExists(temporaryDatabasePath);

const database = new DatabaseSync(temporaryDatabasePath);
try {
  database.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = FULL;
    PRAGMA temp_store = MEMORY;
    PRAGMA locking_mode = EXCLUSIVE;
  `);
  initializeRarityDatabase(database);
  database.exec("BEGIN");

  console.error("Building NWJC surface 1-gram index.");
  const nwjc = await buildNWJCIndex(database);
  console.error(`NWJC rows indexed: ${nwjc.writtenRows.toLocaleString("en-US")}`);

  console.error("Building BCCWJ LUW2 lemma index.");
  const bccwjWrittenRows = await buildBCCWJIndex(database);
  console.error(`BCCWJ lemmas indexed: ${bccwjWrittenRows.toLocaleString("en-US")}`);

  database.prepare("INSERT INTO rarity_metadata VALUES (?)").run(nwjc.tokenTotal);
  database.exec("COMMIT");
  database.exec("ANALYZE");
  database.close();
} catch (error) {
  try {
    database.close();
  } catch {
    // Preserve the original build error if closing also fails.
  }
  await removeIfExists(temporaryDatabasePath);
  throw error;
}

await Deno.rename(temporaryDatabasePath, databasePath);
console.error(`Wrote rarity resources to ${databasePath}`);

async function buildNWJCIndex(database: DatabaseSync): Promise<{
  writtenRows: number;
  tokenTotal: number;
}> {
  const insert = database.prepare(UPSERT_NWJC_SQL);
  let rows = 0;
  let tokenTotal = 0;

  for await (const line of await readLines(nwjcSourcePath)) {
    rows += 1;
    const { surface, count } = parseNWJCRow(line, rows);
    tokenTotal += count;
    if (!Number.isSafeInteger(tokenTotal)) {
      throw new Error(`NWJC token total exceeds the safe integer range at line ${rows}`);
    }

    const term = normalizeRarityTerm(surface);
    if (term) insert.run(term, count);

    if (rows % 1_000_000 === 0) {
      console.error(`NWJC rows scanned: ${rows.toLocaleString("en-US")}`);
    }
  }

  const { count: writtenRows } = database.prepare(
    "SELECT count(*) AS count FROM nwjc_surface_1gram",
  ).get() as { count: number };
  if (writtenRows === 0) throw new Error("NWJC source produced no rarity entries");
  return { writtenRows, tokenTotal };
}

async function buildBCCWJIndex(database: DatabaseSync): Promise<number> {
  const insert = database.prepare(UPSERT_BCCWJ_SQL);
  let lineNumber = 0;

  for await (const line of await readLines(bccwjSourcePath)) {
    lineNumber += 1;
    if (lineNumber === 1) {
      validateBCCWJHeader(line);
      continue;
    }

    const { lemma, totalPMW } = parseBCCWJRow(line, lineNumber);
    const term = normalizeRarityTerm(lemma);
    if (term) insert.run(term, totalPMW);
  }

  if (lineNumber === 0) throw new Error("BCCWJ source is empty");
  const { count: writtenRows } = database.prepare(
    "SELECT count(*) AS count FROM bccwj_luw2_lemma",
  ).get() as { count: number };
  if (writtenRows === 0) throw new Error("BCCWJ source produced no rarity entries");
  return writtenRows;
}

async function readLines(filename: string) {
  const file = await Deno.open(filename, { read: true });
  return file.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());
}

async function readFirstLine(filename: string): Promise<string> {
  for await (const line of await readLines(filename)) return line;
  throw new Error(`Source file is empty: ${filename}`);
}

async function removeIfExists(target: string): Promise<void> {
  try {
    await Deno.remove(target, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}
