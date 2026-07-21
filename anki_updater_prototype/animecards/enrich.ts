/**
 * Adds canonical AI-owned sense, hint, and minimized-context fields to a conversion manifest.
 *
 * Run with: deno task animecards:enrich MANIFEST.json [--output=PATH] [--model=MODEL] [--limit=N] [--concurrency=N]
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { DEFAULT_MODEL_ID, generateCardFields, MODEL_IDS, type ModelId } from "card_creator/ai";
import { allJMDictEntries } from "data";
import {
  applyGeneratedCardFields,
  needsCardFieldEnrichment,
  rekeyCachedKey,
} from "./enrichment.ts";
import { checkpointMatchesInput, createCheckpointManifest } from "./checkpoint.ts";
import { normalizeContextHTML } from "./html.ts";
import { writeConversionAuditArtifacts } from "./report.ts";
import {
  CONVERSION_MANIFEST_VERSION,
  type ConversionCandidate,
  type ConversionManifest,
  deferUnavailableSourceContexts,
  type MinimizedContextResolution,
  type SenseResolution,
} from "./types.ts";

interface Options {
  manifestPath: string;
  outputPath: string;
  cachePath: string;
  model: ModelId;
  limit: number | undefined;
  concurrency: number;
}

function enrichedManifestPath(manifestPath: string): string {
  const extension = path.extname(manifestPath);
  return `${manifestPath.slice(0, -extension.length)}.enriched${extension}`;
}

function parseArguments(args: string[]): Options {
  const flags = parseArgs(args, {
    string: ["_", "output", "cache", "model", "limit", "concurrency"],
  });
  const [manifestPath] = flags._;
  if (manifestPath === undefined) {
    throw new Error("A conversion manifest path is required.");
  }
  const model = flags.model ?? DEFAULT_MODEL_ID;
  if (!MODEL_IDS.includes(model as ModelId)) {
    throw new Error(`Unknown model: ${model}. Available: ${MODEL_IDS.join(", ")}`);
  }
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }
  const concurrency = flags.concurrency === undefined ? 5 : Number(flags.concurrency);
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("--concurrency must be a positive integer");
  }
  const outputPath = flags.output ?? enrichedManifestPath(manifestPath);
  return {
    manifestPath,
    outputPath,
    cachePath: flags.cache ?? `${outputPath}.ai-cache.jsonl`,
    model: model as ModelId,
    limit,
    concurrency,
  };
}

function parseManifest(json: string): ConversionManifest {
  const manifest = JSON.parse(json) as ConversionManifest;
  if (manifest.version !== CONVERSION_MANIFEST_VERSION || !Array.isArray(manifest.candidates)) {
    throw new Error(
      `Expected an Animecards conversion manifest at version ${CONVERSION_MANIFEST_VERSION}.`,
    );
  }
  return manifest;
}

interface CachedAIResult {
  noteId: number;
  originalFingerprint: string;
  inputFingerprint: string;
  model: ModelId;
  key: string;
  hint: string;
  minimizedContext: string;
  minimizedContextResolution: MinimizedContextResolution;
  senseResolution: SenseResolution;
}

function enrichmentContext(candidate: ConversionCandidate): string {
  return normalizeContextHTML(
    candidate.target.fields["Full context"].replace(/<\/?mark\b[^>]*>/giu, ""),
  );
}

async function inputFingerprint(candidate: ConversionCandidate, model: ModelId): Promise<string> {
  const value = JSON.stringify({
    version: 2,
    model,
    jmdictId: candidate.jmdictId,
    recognitionTarget: candidate.recognitionTarget,
    context: enrichmentContext(candidate),
    source: candidate.sourceResolution,
    needsSenseSelection: candidate.senseResolution.status !== "not-needed",
    needsMinimizedContext: candidate.minimizedContextResolution.status !== "not-needed",
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function writeManifest(outputPath: string, manifest: ConversionManifest): Promise<void> {
  await Deno.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await Deno.writeTextFile(temporaryPath, `${JSON.stringify(manifest, undefined, 2)}\n`);
  await Deno.rename(temporaryPath, outputPath);
}

async function loadWorkingManifest(options: Options): Promise<ConversionManifest> {
  const original = parseManifest(await Deno.readTextFile(options.manifestPath));
  try {
    const checkpoint = parseManifest(await Deno.readTextFile(options.outputPath));
    if (!await checkpointMatchesInput(original, checkpoint)) {
      throw new Error(`Existing checkpoint ${options.outputPath} belongs to a different manifest.`);
    }
    console.error(`Resuming checkpoint ${options.outputPath}.`);
    return checkpoint;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return await createCheckpointManifest(original);
}

async function loadCachedResults(
  cacheFile: string,
  manifest: ConversionManifest,
  model: ModelId,
): Promise<number> {
  let content: string;
  try {
    content = await Deno.readTextFile(cacheFile);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }

  const candidates = new Map(manifest.candidates.map((candidate) => [candidate.noteId, candidate]));
  const cachedByInput = new Map<string, CachedAIResult>();
  for (const line of content.split("\n").filter(Boolean)) {
    const result = JSON.parse(line) as CachedAIResult;
    if (result.model === model && result.inputFingerprint !== undefined) {
      cachedByInput.set(`${result.noteId}:${result.inputFingerprint}`, result);
    }
  }
  let loaded = 0;
  for (const candidate of candidates.values()) {
    const currentInputFingerprint = await inputFingerprint(candidate, model);
    const result = cachedByInput.get(`${candidate.noteId}:${currentInputFingerprint}`);
    if (result === undefined || candidate.original.fingerprint !== result.originalFingerprint) {
      continue;
    }
    const key = rekeyCachedKey(candidate, result.key);
    if (key === null) continue;
    candidate.target.fields.Key = key;
    candidate.target.fields.Hint = result.hint;
    candidate.target.fields["Minimized context"] = result.minimizedContext;
    candidate.minimizedContextResolution = result.minimizedContextResolution;
    candidate.senseResolution = result.senseResolution;
    ++loaded;
  }
  return loaded;
}

async function appendCachedResult(cacheFile: string, result: CachedAIResult): Promise<void> {
  await Deno.mkdir(path.dirname(cacheFile), { recursive: true });
  await Deno.writeTextFile(cacheFile, `${JSON.stringify(result)}\n`, { append: true });
}

async function main(): Promise<void> {
  const options = parseArguments(Deno.args);
  const manifest = await loadWorkingManifest(options);
  const newlyDeferred = deferUnavailableSourceContexts(manifest);
  if (newlyDeferred > 0) {
    console.error(`Deferred ${newlyDeferred} candidates without source-backed full context.`);
  }
  const aiCachePath = options.cachePath;
  const cachedCount = await loadCachedResults(aiCachePath, manifest, options.model);
  if (cachedCount > 0) console.error(`Loaded ${cachedCount} cached AI results.`);
  let candidates = manifest.candidates.filter((candidate) =>
    candidate.approved !== false && needsCardFieldEnrichment(candidate)
  );
  if (options.limit !== undefined) candidates = candidates.slice(0, options.limit);
  if (candidates.length === 0) {
    console.error("No pending card-field enrichment.");
    await writeManifest(options.outputPath, manifest);
    await writeConversionAuditArtifacts(manifest, options.outputPath);
    return;
  }

  console.error(`Loading JMDict for ${candidates.length} AI card-field enrichments...`);
  const entries = await allJMDictEntries();
  let generated = 0;
  let failed = 0;
  let nextCandidateIndex = 0;
  let rateLimited = false;
  let cacheWrite = Promise.resolve();
  async function enrichNextCandidate(): Promise<void> {
    if (rateLimited) return;
    const candidateIndex = nextCandidateIndex++;
    if (candidateIndex >= candidates.length) return;
    const candidate = candidates[candidateIndex];
    const entry = entries.get(candidate.jmdictId);
    if (entry === undefined) throw new Error(`JMDict entry ${candidate.jmdictId} is missing.`);
    const context = enrichmentContext(candidate);
    const candidateInputFingerprint = await inputFingerprint(candidate, options.model);
    const attemptedAt = new Date().toISOString();
    try {
      const fields = await generateCardFields({
        context,
        recognitionTarget: candidate.recognitionTarget,
        jmdictEntry: entry,
        source: candidate.sourceResolution.name ?? undefined,
        sourceURL: candidate.sourceResolution.url ?? undefined,
        readingFromContext: candidate.readingKana,
      }, options.model);
      applyGeneratedCardFields(candidate, entry, fields, options.model, attemptedAt);
      ++generated;
      console.error(`  Generated ${candidate.noteId}: ${candidate.recognitionTarget}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (candidate.minimizedContextResolution.status !== "not-needed") {
        candidate.minimizedContextResolution = {
          status: "failed",
          model: options.model,
          attemptedAt,
          error: message,
        };
      }
      if (candidate.senseResolution.status !== "not-needed") {
        candidate.senseResolution = {
          status: "failed",
          model: options.model,
          attemptedAt,
          error: message,
        };
      }
      ++failed;
      console.error(`  Failed ${candidate.noteId}: ${message}`);
      if (/spend-based rate limit/iu.test(message)) {
        rateLimited = true;
        console.error("  Spend-rate limit reached; leaving unscheduled candidates pending.");
      }
    }
    cacheWrite = cacheWrite.then(() =>
      appendCachedResult(aiCachePath, {
        noteId: candidate.noteId,
        originalFingerprint: candidate.original.fingerprint,
        inputFingerprint: candidateInputFingerprint,
        model: options.model,
        key: candidate.target.fields.Key,
        hint: candidate.target.fields.Hint,
        minimizedContext: candidate.target.fields["Minimized context"],
        minimizedContextResolution: candidate.minimizedContextResolution,
        senseResolution: candidate.senseResolution,
      })
    );
    await cacheWrite;
    await enrichNextCandidate();
  }
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, candidates.length) },
      () => enrichNextCandidate(),
    ),
  );

  await writeManifest(options.outputPath, manifest);
  await writeConversionAuditArtifacts(manifest, options.outputPath);
  console.error(
    `Enrichment: ${generated} generated, ${failed} failed. Output: ${options.outputPath}`,
  );
  if (failed > 0) Deno.exitCode = 1;
}

if (import.meta.main) await main();
