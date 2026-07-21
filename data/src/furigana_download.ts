import * as path from "@std/path";
import type { JMDictFurigana } from "./mod.ts";
import { furiganaCache } from "./furigana_cache.ts";
import { importFurigana } from "./furigana_import.ts";
import {
  type FuriganaResourceRecord,
  readRuntimeResourceManifest,
  updateRuntimeResourceManifest,
} from "./resource_manifest.ts";
import { resourcePaths } from "./resource_paths.ts";

/** Mutable upstream source used to build Miwake Cards' furigana lookup. */
const FURIGANA_URL = "https://jisho.hlorenzi.com/furigana.txt";
const FURIGANA_FORMAT_VERSION = 4;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_DELTA_FRACTION = 0.2;

/** Result of checking or updating the installed furigana resource. */
export interface EnsureLatestFuriganaResult {
  /** Action taken after checking local and remote state. */
  action: "downloaded" | "already-current" | "offline";
  /** Installed record used after this operation. */
  current: FuriganaResourceRecord;
}

function furiganaChangeFraction(
  current: JMDictFurigana,
  candidate: JMDictFurigana,
): number {
  let changed = 0;
  for (const [key, value] of Object.entries(candidate)) {
    if (current[key] !== value) {
      ++changed;
    }
  }
  for (const key of Object.keys(current)) {
    if (!(key in candidate)) {
      ++changed;
    }
  }
  return changed / Math.max(Object.keys(current).length, 1);
}

/** Ensures the local furigana lookup matches the mutable upstream resource. */
export async function ensureLatestFurigana(
  {
    offline = false,
    force = false,
    acceptLargeChange = false,
  }: {
    offline?: boolean;
    force?: boolean;
    acceptLargeChange?: boolean;
  } = {},
): Promise<EnsureLatestFuriganaResult> {
  const localArtifact = await readLocalArtifact();
  const manifest = await readRuntimeResourceManifest();
  let local = manifest.resources.furigana;
  if (localArtifact !== null && local === undefined) {
    local = {
      sourceURL: FURIGANA_URL,
      artifact: path.basename(resourcePaths.jmdictFurigana),
      fetchedAt: new Date().toISOString(),
      entryCount: Object.keys(localArtifact).length,
      formatVersion: 0,
    };
    await updateRuntimeResourceManifest(local);
  }

  if (offline) {
    if (localArtifact === null || local === undefined) {
      throw new Error(
        `No local furigana data at ${resourcePaths.jmdictFurigana}, and offline mode was requested.`,
      );
    }
    return { action: "offline", current: local };
  }

  const conditionalRecord = !force && localArtifact !== null &&
      local?.sourceURL === FURIGANA_URL &&
      local.formatVersion === FURIGANA_FORMAT_VERSION
    ? local
    : undefined;
  const headers = new Headers();
  if (conditionalRecord) {
    if (conditionalRecord.etag) {
      headers.set("If-None-Match", conditionalRecord.etag);
    }
    if (conditionalRecord.lastModified) {
      headers.set("If-Modified-Since", conditionalRecord.lastModified);
    }
  }

  const response = await fetch(FURIGANA_URL, { headers });
  if (response.status === 304 && conditionalRecord) {
    return { action: "already-current", current: conditionalRecord };
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch furigana data: ${response.status} ${response.statusText}`);
  }

  const sourceBytes = new Uint8Array(await response.arrayBuffer());
  if (sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`Furigana download exceeded the ${MAX_SOURCE_BYTES}-byte limit.`);
  }
  const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  const data = importFurigana(sourceText);
  const entryCount = Object.keys(data).length;
  if (entryCount === 0) {
    throw new Error("Furigana data contains no records.");
  }
  validateChangeSize(localArtifact, data, acceptLargeChange);

  const current: FuriganaResourceRecord = {
    sourceURL: FURIGANA_URL,
    artifact: path.basename(resourcePaths.jmdictFurigana),
    fetchedAt: new Date().toISOString(),
    ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
    ...(response.headers.get("last-modified")
      ? { lastModified: response.headers.get("last-modified")! }
      : {}),
    entryCount,
    formatVersion: FURIGANA_FORMAT_VERSION,
  };

  await installArtifact(JSON.stringify(data), current);
  furiganaCache.promise = null;
  return { action: "downloaded", current };
}

function validateChangeSize(
  current: JMDictFurigana | null,
  candidate: JMDictFurigana,
  acceptLargeChange: boolean,
): void {
  if (current === null || acceptLargeChange) {
    return;
  }
  const fraction = furiganaChangeFraction(current, candidate);
  if (fraction > MAX_DELTA_FRACTION) {
    throw new Error(
      `Furigana update would add, remove, or change ${
        (fraction * 100).toFixed(1)
      }% of existing records; ` +
        "inspect it and explicitly accept the large change if intentional.",
    );
  }
}

async function readLocalArtifact(): Promise<JMDictFurigana | null> {
  try {
    const data = JSON.parse(
      await Deno.readTextFile(resourcePaths.jmdictFurigana),
    ) as JMDictFurigana;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error(`Malformed furigana artifact at ${resourcePaths.jmdictFurigana}.`);
    }
    return data;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }
}

async function installArtifact(
  artifactText: string,
  record: FuriganaResourceRecord,
): Promise<void> {
  const furiganaPath = resourcePaths.jmdictFurigana;
  await Deno.mkdir(path.dirname(furiganaPath), { recursive: true });
  const temporaryPath = `${furiganaPath}.${crypto.randomUUID()}.download`;
  await Deno.writeTextFile(temporaryPath, artifactText);
  await Deno.rename(temporaryPath, furiganaPath);
  await updateRuntimeResourceManifest(record);
}
