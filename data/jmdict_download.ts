// Keeps `jmdict_eng.json` up to date with the latest jmdict-simplified release, downloading
// only when the release is actually newer (or when forced).
//
// This is the library behind `deno task download_jmdict`; other packages use it via the
// `data/download` export (e.g. the card updater refreshes the dictionary before scanning).

import * as path from "@std/path";
import { extract as extractZip } from "@quentinadam/zip";
import { entriesCache } from "./entries_cache.ts";

const RELEASES_URL = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";

const jmdictPath = path.join(import.meta.dirname!, "jmdict_eng.json");

export interface JMDictVersion {
  version: string;
  dictDate: string;
}

/** Parses the version header out of the first bytes of a jmdict-simplified JSON file. */
export function parseJMDictHeader(head: string): JMDictVersion | null {
  const version = head.match(/"version":\s*"([^"]+)"/)?.[1];
  const dictDate = head.match(/"dictDate":\s*"([^"]+)"/)?.[1];
  return version && dictDate ? { version, dictDate } : null;
}

/** Parses a release asset name like `jmdict-eng-3.6.2+20260706122413.json.zip`. */
export function parseJMDictAssetName(name: string): JMDictVersion | null {
  const match = name.match(/^jmdict-eng-(\d+\.\d+\.\d+)\+(\d{4})(\d{2})(\d{2})/);
  if (!match) {
    return null;
  }
  const [, version, year, month, day] = match;
  return { version, dictDate: `${year}-${month}-${day}` };
}

/** Reads the version header of the local JMDict file without parsing the whole ~100 MB JSON. */
export async function localJMDictVersion(): Promise<JMDictVersion | null> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(jmdictPath, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return null;
    }
    throw error;
  }

  try {
    const buffer = new Uint8Array(1024);
    const bytesRead = await file.read(buffer) ?? 0;
    return parseJMDictHeader(new TextDecoder().decode(buffer.subarray(0, bytesRead)));
  } finally {
    file.close();
  }
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface LatestRelease {
  asset: ReleaseAsset;
  version: JMDictVersion;
}

async function latestJMDictRelease(): Promise<LatestRelease> {
  const response = await fetch(RELEASES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch jmdict-simplified release info: ${response.statusText}`);
  }
  const release = await response.json();

  const asset = (release.assets as ReleaseAsset[]).find((candidate) =>
    candidate.name.startsWith("jmdict-eng-") && candidate.name.endsWith(".json.zip") &&
    !candidate.name.includes("common")
  );
  if (!asset) {
    throw new Error("Could not find the jmdict-eng JSON zip asset in the latest release.");
  }

  const version = parseJMDictAssetName(asset.name);
  if (version === null) {
    throw new Error(`Unexpected jmdict-eng asset name: ${asset.name}`);
  }

  return { asset, version };
}

async function downloadRelease(release: LatestRelease): Promise<void> {
  const response = await fetch(release.asset.browser_download_url);
  if (!response.ok) {
    throw new Error(`Failed to download ${release.asset.name}: ${response.statusText}`);
  }
  const zipped = await response.bytes();

  const unzipped = await extractZip(zipped);
  if (unzipped.length !== 1) {
    throw new Error("Expected the JMDict zip to contain exactly one file.");
  }

  // Write next to the target and rename, so a crash mid-download never corrupts the data file.
  const temporaryPath = `${jmdictPath}.download`;
  await Deno.writeFile(temporaryPath, unzipped[0].data);
  await Deno.rename(temporaryPath, jmdictPath);

  // A caller may have already read the old file through `allJMDictEntries()`.
  entriesCache.promise = null;
}

export interface EnsureLatestResult {
  action: "downloaded" | "already-current" | "offline" | "check-failed";
  local: JMDictVersion | null;
  remote?: JMDictVersion;
  error?: string;
}

/**
 * Ensures `jmdict_eng.json` matches the latest jmdict-simplified release. With `offline`, or
 * when the release check fails but a local copy exists, the local copy is used as-is. With
 * `force`, the latest release is downloaded even when the local copy already matches it.
 */
export async function ensureLatestJMDict(
  { offline = false, force = false, log = () => {} }: {
    offline?: boolean;
    force?: boolean;
    log?: (message: string) => void;
  } = {},
): Promise<EnsureLatestResult> {
  const local = await localJMDictVersion();
  if (offline) {
    if (local === null) {
      throw new Error(`No local JMDict at ${jmdictPath}, and offline mode was requested.`);
    }
    log(`Using local JMDict ${local.version} (${local.dictDate}) without checking for updates.`);
    return { action: "offline", local };
  }

  let release: LatestRelease;
  try {
    release = await latestJMDictRelease();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (local === null) {
      throw new Error(`No local JMDict and the release check failed: ${message}`);
    }
    log(
      `JMDict release check failed (${message}); using local ${local.version} (${local.dictDate}).`,
    );
    return { action: "check-failed", local, error: message };
  }

  const remote = release.version;
  const alreadyCurrent = local !== null && local.version === remote.version &&
    local.dictDate === remote.dictDate;
  if (alreadyCurrent && !force) {
    log(`Local JMDict ${local.version} (${local.dictDate}) is already the latest release.`);
    return { action: "already-current", local, remote };
  }

  log(
    local === null
      ? `Downloading JMDict ${remote.version} (${remote.dictDate})...`
      : alreadyCurrent
      ? `Re-downloading JMDict ${remote.version} (${remote.dictDate})...`
      : `Updating JMDict ${local.version} (${local.dictDate}) → ${remote.version} (${remote.dictDate})...`,
  );
  await downloadRelease(release);
  log("JMDict download complete.");
  return { action: "downloaded", local, remote };
}
