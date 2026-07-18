import { DatabaseSync } from "node:sqlite";
import { normalizeRarityTerm } from "./rarity_normalization.ts";
import { resourcePaths } from "./resource_paths.ts";

/** Filename of the generated SQLite rarity database. */
export const RARITY_DATABASE_FILENAME = "rarity.sqlite3";
/** Schema version stored in the rarity database's `user_version`. */
export const RARITY_DATABASE_VERSION = 1;
/** Inserts or accumulates an NWJC surface count. */
export const UPSERT_NWJC_SQL = `
  INSERT INTO nwjc_surface_1gram (term, count) VALUES (?, ?)
  ON CONFLICT (term) DO UPDATE SET count = count + excluded.count
`;
/** Inserts or accumulates a BCCWJ lemma frequency. */
export const UPSERT_BCCWJ_SQL = `
  INSERT INTO bccwj_luw2_lemma (term, total_pmw) VALUES (?, ?)
  ON CONFLICT (term) DO UPDATE SET total_pmw = total_pmw + excluded.total_pmw
`;

const resourcesNotFoundMessage =
  "Rarity resources not found. Run `deno task --cwd data update:rarity`.";

interface DatabaseState {
  database: DatabaseSync;
  nwjcTokenTotal: number;
  nwjcStatement: ReturnType<DatabaseSync["prepare"]>;
  bccwjStatement: ReturnType<DatabaseSync["prepare"]>;
}

/** Lazily opened lookups over the generated rarity database. */
export interface RarityResourceLookup {
  /** Looks up an NWJC surface count and its corpus token total. */
  nwjcSurface1GramHit(target: string): Promise<{ count: number; tokenTotal: number } | null>;
  /** Looks up a BCCWJ LUW2 lemma frequency per million words. */
  bccwjLUW2LemmaHit(target: string): Promise<{ totalPMW: number } | null>;
  /** Closes the database if it was opened. */
  close(): Promise<void>;
}

/** Initializes an empty rarity database with the current schema. */
export function initializeRarityDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA user_version = ${RARITY_DATABASE_VERSION};
    CREATE TABLE rarity_metadata (
      nwjc_token_total INTEGER NOT NULL CHECK (nwjc_token_total > 0)
    );
    CREATE TABLE nwjc_surface_1gram (
      term TEXT PRIMARY KEY,
      count INTEGER NOT NULL CHECK (count > 0)
    ) WITHOUT ROWID;
    CREATE TABLE bccwj_luw2_lemma (
      term TEXT PRIMARY KEY,
      total_pmw REAL NOT NULL CHECK (total_pmw > 0)
    ) WITHOUT ROWID;
  `);
}

/** Creates lazy rarity-resource lookups for a SQLite database path. */
export function createRarityResourceLookup(databasePath: string): RarityResourceLookup {
  let statePromise: Promise<DatabaseState> | undefined;

  function state(): Promise<DatabaseState> {
    if (!statePromise) {
      statePromise = openDatabase(databasePath).catch((error) => {
        statePromise = undefined;
        throw error;
      });
    }
    return statePromise;
  }

  return {
    async nwjcSurface1GramHit(target) {
      const term = normalizeRarityTerm(target);
      if (!term) return null;

      const { nwjcStatement, nwjcTokenTotal } = await state();
      const row = nwjcStatement.get(term) as { count: number } | undefined;
      return row ? { count: row.count, tokenTotal: nwjcTokenTotal } : null;
    },

    async bccwjLUW2LemmaHit(target) {
      const term = normalizeRarityTerm(target);
      if (!term) return null;

      const { bccwjStatement } = await state();
      const row = bccwjStatement.get(term) as { totalPMW: number } | undefined;
      return row ?? null;
    },

    async close() {
      if (statePromise) {
        const promise = statePromise;
        statePromise = undefined;
        try {
          const { database } = await promise;
          database.close();
        } catch {
          // A failed open leaves no database handle to close.
        }
      }
    },
  };
}

const defaultLookup = createRarityResourceLookup(resourcePaths.rarityDatabase);

/** Looks up a target in the NWJC surface 1-gram resource. */
export function nwjcSurface1GramHit(
  target: string,
): Promise<{ count: number; tokenTotal: number } | null> {
  return defaultLookup.nwjcSurface1GramHit(target);
}

/** Looks up a target in the BCCWJ LUW2 lemma resource. */
export function bccwjLUW2LemmaHit(target: string): Promise<{ totalPMW: number } | null> {
  return defaultLookup.bccwjLUW2LemmaHit(target);
}

async function openDatabase(databasePath: string): Promise<DatabaseState> {
  try {
    await Deno.stat(databasePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(resourcesNotFoundMessage, { cause: error });
    }
    throw error;
  }

  let database: DatabaseSync;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    throw new Error(`Could not open rarity resources at ${databasePath}`, { cause: error });
  }

  try {
    const versionRow = database.prepare("SELECT user_version AS version FROM pragma_user_version")
      .get() as { version: number };
    if (versionRow.version !== RARITY_DATABASE_VERSION) {
      throw new Error(
        `Unsupported rarity resource version ${versionRow.version}; ` +
          `expected ${RARITY_DATABASE_VERSION}. Rebuild the rarity resources.`,
      );
    }

    const metadata = database.prepare(
      "SELECT nwjc_token_total AS nwjcTokenTotal FROM rarity_metadata",
    ).get() as { nwjcTokenTotal: number } | undefined;
    if (
      !metadata || !Number.isSafeInteger(metadata.nwjcTokenTotal) || metadata.nwjcTokenTotal < 1
    ) {
      throw new Error("Invalid rarity resource metadata");
    }

    return {
      database,
      nwjcTokenTotal: metadata.nwjcTokenTotal,
      nwjcStatement: database.prepare("SELECT count FROM nwjc_surface_1gram WHERE term = ?"),
      bccwjStatement: database.prepare(
        "SELECT total_pmw AS totalPMW FROM bccwj_luw2_lemma WHERE term = ?",
      ),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
