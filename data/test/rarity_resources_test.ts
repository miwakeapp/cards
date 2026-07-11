import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { normalizeRarityTerm } from "../rarity_normalization.ts";
import {
  createRarityResourceLookup,
  initializeRarityDatabase,
  UPSERT_BCCWJ_SQL,
  UPSERT_NWJC_SQL,
} from "../rarity_resources.ts";
import { parseBCCWJRow, parseNWJCRow, validateBCCWJHeader } from "../scripts/rarity_source_rows.ts";

const TEST_NWJC_TOKEN_TOTAL = 1_000_000;

Deno.test("normalizeRarityTerm canonicalizes plain resource keys", () => {
  assertEquals(normalizeRarityTerm("ｶｯｺ　ｲｲ"), "カッコイイ");
  assertEquals(normalizeRarityTerm("<->"), "<->");
  const compatibilityForm = "(*｀Å´*)";
  const normalized = normalizeRarityTerm(compatibilityForm);
  assertEquals(normalized, "(*`Ǻ*)");
  assertEquals(normalizeRarityTerm(normalized), normalized);
});

Deno.test("rarity resource lookup normalizes and returns minimal hits", async () => {
  await withFixtureDatabase(async (lookup) => {
    assertEquals(await lookup.nwjcSurface1GramHit("ｶｯｺ　ｲｲ"), {
      count: 4_497,
      tokenTotal: TEST_NWJC_TOKEN_TOTAL,
    });
    assertEquals(await lookup.bccwjLUW2LemmaHit("玄　妙"), { totalPMW: 0.024 });
    assertEquals(await lookup.nwjcSurface1GramHit("absent"), null);
    assertEquals(await lookup.bccwjLUW2LemmaHit("absent"), null);
  });
});

Deno.test("rarity resource lookup rejects missing resources with complete guidance", async () => {
  const databasePath = `${import.meta.dirname!}/does-not-exist.sqlite3`;
  const lookup = createRarityResourceLookup(databasePath);
  try {
    await assertRejects(
      () => lookup.nwjcSurface1GramHit("target"),
      Error,
      "download_nwjc_surface_1gram",
    );
  } finally {
    await lookup.close();
  }
});

Deno.test("rarity resource lookup rejects incompatible databases", async () => {
  const directory = await Deno.makeTempDir({ dir: import.meta.dirname!, prefix: ".tmp-rarity-" });
  const databasePath = `${directory}/rarity.sqlite3`;
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA user_version = 99");
  database.close();

  const lookup = createRarityResourceLookup(databasePath);
  try {
    await assertRejects(
      () => lookup.nwjcSurface1GramHit("target"),
      Error,
      "Unsupported rarity resource version 99",
    );
  } finally {
    await lookup.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rarity source parsers accept the current schemas", () => {
  assertEquals(parseNWJCRow("カッコイイ\t4578", 12), {
    surface: "カッコイイ",
    count: 4_578,
  });

  const header = bccwjFields();
  header.splice(0, 8, "rank", "lForm", "lemma", "pos", "subLemma", "wType", "frequency", "pmw");
  validateBCCWJHeader(header.join("\t"));

  const row = bccwjFields();
  row[0] = "536095";
  row[2] = "玄妙";
  row[6] = "2";
  row[7] = "0.0240072";
  assertEquals(parseBCCWJRow(row.join("\t"), 42), {
    lemma: "玄妙",
    totalPMW: 0.0240072,
  });
});

Deno.test("rarity source parsers reject malformed rows", () => {
  assertThrows(() => parseNWJCRow("missing-tab", 3), Error, "line 3");
  assertThrows(() => parseNWJCRow("term\t10junk", 4), Error, "line 4");

  const shortHeader = ["rank", "lForm", "lemma", "pos", "subLemma", "wType", "frequency", "pmw"];
  assertThrows(() => validateBCCWJHeader(shortHeader.join("\t")), Error, "unsupported LUW2 schema");

  const row = bccwjFields();
  row[0] = "1";
  row[2] = "玄妙";
  row[6] = "2";
  row[7] = "0.024junk";
  assertThrows(() => parseBCCWJRow(row.join("\t"), 8), Error, "line 8");
});

async function withFixtureDatabase(
  callback: (lookup: ReturnType<typeof createRarityResourceLookup>) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ dir: import.meta.dirname!, prefix: ".tmp-rarity-" });
  const databasePath = `${directory}/rarity.sqlite3`;
  const database = new DatabaseSync(databasePath);
  initializeRarityDatabase(database);
  database.prepare("INSERT INTO rarity_metadata VALUES (?)").run(TEST_NWJC_TOKEN_TOTAL);
  const insertNWJC = database.prepare(UPSERT_NWJC_SQL);
  insertNWJC.run("カッコイイ", 2_321);
  insertNWJC.run("カッコイイ", 2_176);
  const insertBCCWJ = database.prepare(UPSERT_BCCWJ_SQL);
  insertBCCWJ.run("玄妙", 0.01);
  insertBCCWJ.run("玄妙", 0.014);
  database.close();

  const lookup = createRarityResourceLookup(databasePath);
  try {
    await callback(lookup);
  } finally {
    await lookup.close();
    await Deno.remove(directory, { recursive: true });
  }
}

function bccwjFields(): string[] {
  return Array.from({ length: 80 }, () => "");
}
