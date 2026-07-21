import * as path from "@std/path";
import { resourcePaths } from "./resource_paths.ts";

/** Installed identity, HTTP validators, and statistics for the furigana artifact. */
export interface FuriganaResourceRecord {
  /** Mutable upstream text URL. */
  sourceURL: string;
  /** Filename below `data/generated`. */
  artifact: string;
  /** Time the artifact was installed or first inventoried. */
  fetchedAt: string;
  /** Upstream HTTP entity tag, when supplied. */
  etag?: string;
  /** Upstream HTTP modification time, when supplied. */
  lastModified?: string;
  /** Number of lookup records installed. */
  entryCount: number;
  /** Version of Miwake Cards' source-to-JSON conversion contract. */
  formatVersion: number;
}

/** Versioned inventory of mutable runtime resources under `data/generated`. */
export interface RuntimeResourceManifest {
  /** Manifest format version. */
  schemaVersion: 1;
  /** Installed resource records, absent until each resource is inventoried. */
  resources: {
    furigana?: FuriganaResourceRecord;
  };
}

/** Reads the runtime manifest, returning an empty inventory when it does not exist. */
export async function readRuntimeResourceManifest(
  manifestPath = resourcePaths.runtimeManifest,
): Promise<RuntimeResourceManifest> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(manifestPath)) as RuntimeResourceManifest;
    if (parsed.schemaVersion !== 1) {
      throw new Error(`Unsupported runtime resource manifest at ${manifestPath}.`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { schemaVersion: 1, resources: {} };
    }
    throw error;
  }
}

/** Atomically records the installed furigana resource. */
export async function updateRuntimeResourceManifest(
  resource: FuriganaResourceRecord,
  manifestPath = resourcePaths.runtimeManifest,
): Promise<void> {
  const manifest = await readRuntimeResourceManifest(manifestPath);
  manifest.resources.furigana = resource;
  await Deno.mkdir(path.dirname(manifestPath), { recursive: true });
  const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.download`;
  await Deno.writeTextFile(temporaryPath, JSON.stringify(manifest, undefined, 2) + "\n");
  await Deno.rename(temporaryPath, manifestPath);
}
