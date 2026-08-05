/**
 * Adds canonical AI-owned sense, hint, and minimized-context fields to a conversion manifest.
 *
 * Run with: deno task animecards:enrich MANIFEST.json [--output=PATH] [--model=MODEL] [--generation-cache=PATH] [--limit=N] [--concurrency=N]
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { jmdictUsagesForSpelling } from "card_creator/jmdict";
import { buildSpellingIndex, findAllEntriesBySpelling } from "card_resolution";
import { allJMDictEntries, type JMDictWord } from "data";
import { isAIQuotaError, minimizeContext, MODEL_IDS, type ModelId } from "card_field_generation";
export { isAIQuotaError } from "card_field_generation";
import { JSONLGenerationCache } from "card_field_generation/file-cache";
import {
  markAuditedContextTargetWithinAnchor,
  markResolvedContextTargetWithinAnchor,
} from "../shared/anchored_context.ts";
import {
  selectSensesAndMaybeGenerateHint,
  type SenseAndHintResolution,
} from "../shared/focused_card_generation.ts";
import { applyGeneratedCardFields, needsCardFieldEnrichment } from "./enrichment.ts";
import { checkpointMatchesInput, createCheckpointManifest } from "./checkpoint.ts";
import { contextPlainText } from "./html.ts";
import { writeConversionAuditArtifacts } from "./report.ts";
import {
  CONVERSION_MANIFEST_VERSION,
  type ConversionCandidate,
  type ConversionManifest,
  deferUnavailableSourceContexts,
  minimizedContextNeedsGeneration,
  senseResolutionNeedsGeneration,
} from "./types.ts";

interface Options {
  manifestPath: string;
  outputPath: string;
  generationCachePath: string;
  model: ModelId | undefined;
  limit: number | undefined;
  concurrency: number;
}

type EnrichmentOperationName = "context minimization" | "sense/hint generation";

interface PendingEnrichmentOperation<Result> {
  promise: Promise<Result>;
  attemptedModelConfigurationIds: ReadonlySet<string>;
}

interface MinimizedContextResult {
  value: string | null;
  metadata: { modelConfigurationId: string };
}

export interface PendingCandidateEnrichment {
  sense?: PendingEnrichmentOperation<SenseAndHintResolution>;
  minimizedContext?: PendingEnrichmentOperation<MinimizedContextResult>;
}

export interface CandidateEnrichmentFailure {
  operation: EnrichmentOperationName;
  error: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function modelSummary(
  attempted: ReadonlySet<string>,
  completed: readonly string[] = [],
): string {
  return [...new Set([...attempted, ...completed])].join(", ") || "(unknown)";
}

/**
 * Settles and applies independent AI-owned fields without discarding a successful sibling result.
 *
 * Sense selection and hinting form one sequential operation, while context minimization is
 * independent and runs in parallel. Each fulfilled operation is validated and applied on its own;
 * only the operation that rejects or fails application is recorded as failed and retried later.
 */
export async function applySettledCandidateEnrichment(
  candidate: ConversionCandidate,
  entry: JMDictWord,
  sameSpellingEntries: readonly JMDictWord[],
  work: PendingCandidateEnrichment,
  attemptedAt: string,
): Promise<CandidateEnrichmentFailure[]> {
  if (work.sense === undefined && work.minimizedContext === undefined) {
    throw new Error("Candidate was scheduled without any pending AI-owned fields.");
  }
  const [senseResult, minimizedContextResult] = await Promise.allSettled(
    [
      work.sense?.promise,
      work.minimizedContext?.promise,
    ] as const,
  );
  const failures: CandidateEnrichmentFailure[] = [];

  function failSense(error: unknown, completedModels: readonly string[] = []): void {
    const message = errorMessage(error);
    failures.push({ operation: "sense/hint generation", error: message });
    if (senseResolutionNeedsGeneration(candidate.senseResolution)) {
      candidate.senseResolution = {
        status: "failed",
        model: modelSummary(
          work.sense?.attemptedModelConfigurationIds ?? new Set(),
          completedModels,
        ),
        attemptedAt,
        error: message,
        compatibleSenses: candidate.senseResolution.compatibleSenses,
      };
    }
  }

  if (work.sense !== undefined) {
    if (senseResult.status === "rejected") {
      failSense(senseResult.reason);
    } else if (senseResult.value !== undefined) {
      const resolution = senseResult.value;
      try {
        await applyGeneratedCardFields(
          candidate,
          entry,
          sameSpellingEntries,
          {
            senseSelection: resolution.senseSelection,
            hintOutcome: resolution.hintOutcome,
          },
          { senseSelection: modelSummary(new Set(), resolution.modelConfigurationIds) },
          attemptedAt,
        );
      } catch (error) {
        failSense(error, resolution.modelConfigurationIds);
      }
    }
  }

  function failMinimizedContext(error: unknown, completedModel?: string): void {
    const message = errorMessage(error);
    failures.push({ operation: "context minimization", error: message });
    if (minimizedContextNeedsGeneration(candidate.minimizedContextResolution)) {
      candidate.minimizedContextResolution = {
        status: "failed",
        model: modelSummary(
          work.minimizedContext?.attemptedModelConfigurationIds ?? new Set(),
          completedModel === undefined ? [] : [completedModel],
        ),
        attemptedAt,
        error: message,
      };
    }
  }

  if (work.minimizedContext !== undefined) {
    if (minimizedContextResult.status === "rejected") {
      failMinimizedContext(minimizedContextResult.reason);
    } else if (minimizedContextResult.value !== undefined) {
      const result = minimizedContextResult.value;
      try {
        await applyGeneratedCardFields(
          candidate,
          entry,
          sameSpellingEntries,
          { minimizedContext: result.value },
          { minimizedContext: result.metadata.modelConfigurationId },
          attemptedAt,
        );
      } catch (error) {
        failMinimizedContext(error, result.metadata.modelConfigurationId);
      }
    }
  }

  return failures;
}

function enrichedManifestPath(manifestPath: string): string {
  const extension = path.extname(manifestPath);
  return `${manifestPath.slice(0, -extension.length)}.enriched${extension}`;
}

function parseArguments(args: string[]): Options {
  const flags = parseArgs(args, {
    string: ["_", "output", "generation-cache", "model", "limit", "concurrency"],
  });
  const [manifestPath] = flags._;
  if (manifestPath === undefined) {
    throw new Error("A conversion manifest path is required.");
  }
  const model = flags.model as ModelId | undefined;
  if (model !== undefined && !MODEL_IDS.includes(model)) {
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
    generationCachePath: flags["generation-cache"] ??
      path.join(import.meta.dirname!, "..", "generated", "card-field-generation-cache.jsonl"),
    model,
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

export function enrichmentContext(candidate: ConversionCandidate): string {
  // This is already a canonical Miwake Card field produced by `card_creator`. The Animecards
  // input normalizer would strip its semantically meaningful `<mark>` elements.
  return candidate.target.fields["Full context"].trim();
}

function ankiFuriganaSurfaceHTML(html: string): string {
  return html.split(/(<[^>]+>)/gu).map((part) =>
    part.startsWith("<") ? part : part.replace(/(?:^|[ ])([^  \[\]]+)\[([^\]]+)\]/gu, "$1")
  ).join("");
}

/** Marks only target occurrences belonging to the accepted Full context within wider evidence. */
export async function markedSenseSelectionContext(
  candidate: ConversionCandidate,
  partOfSpeech: readonly string[],
): Promise<string> {
  const fullContext = contextPlainText(
    ankiFuriganaSurfaceHTML(candidate.target.fields["Full context"]),
  );
  try {
    const resolution = candidate.targetInContextResolution;
    if (resolution.method === "ai") {
      return markAuditedContextTargetWithinAnchor(
        candidate.senseSelectionContext,
        fullContext,
        [resolution.surface],
      );
    }
    return await markResolvedContextTargetWithinAnchor(
      candidate.senseSelectionContext,
      fullContext,
      candidate.keyRecognitionTarget,
      partOfSpeech,
    );
  } catch (cause) {
    throw new Error(
      `Could not locate accepted Full context within sense-selection evidence for note ${candidate.noteId}`,
      { cause },
    );
  }
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

async function main(): Promise<void> {
  const options = parseArguments(Deno.args);
  const manifest = await loadWorkingManifest(options);
  const newlyDeferred = deferUnavailableSourceContexts(manifest);
  if (newlyDeferred > 0) {
    console.error(`Deferred ${newlyDeferred} candidates without source-backed full context.`);
  }
  const generationCache = new JSONLGenerationCache(options.generationCachePath);
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
  const spellingIndex = buildSpellingIndex(entries.values());
  let generated = 0;
  let failed = 0;
  let nextCandidateIndex = 0;
  let rateLimited = false;
  async function enrichNextCandidate(): Promise<void> {
    if (rateLimited) return;
    const candidateIndex = nextCandidateIndex++;
    if (candidateIndex >= candidates.length) return;
    const candidate = candidates[candidateIndex];
    const entry = entries.get(candidate.jmdictId);
    if (entry === undefined) throw new Error(`JMDict entry ${candidate.jmdictId} is missing.`);
    const sameSpellingEntries = findAllEntriesBySpelling(
      spellingIndex,
      candidate.keyRecognitionTarget,
    );
    const cardContext = enrichmentContext(candidate);
    const needsMinimizedContext = minimizedContextNeedsGeneration(
      candidate.minimizedContextResolution,
    );
    const attemptedAt = new Date().toISOString();
    const attemptedSenseModelConfigurationIds = new Set<string>();
    const attemptedMinimizationModelConfigurationIds = new Set<string>();
    const generationOptions = {
      ...(options.model === undefined ? {} : { modelId: options.model }),
      cache: generationCache,
      maxAttempts: 3,
    };
    const attemptReporter = (
      operation: string,
      modelConfigurationIds: Set<string>,
    ): (attempt: {
      number: number;
      modelConfigurationId: string;
      validationError?: string;
    }) => void => {
      return (attempt) => {
        modelConfigurationIds.add(attempt.modelConfigurationId);
        if (attempt.validationError !== undefined && attempt.number < 3) {
          console.error(
            `  Retrying ${operation} for ${candidate.noteId} after invalid ${attempt.number}/3 result: ${attempt.validationError}`,
          );
        }
      };
    };
    const senseGenerationOptions = {
      ...generationOptions,
      onAttempt: attemptReporter("sense/hint generation", attemptedSenseModelConfigurationIds),
    };
    const minimizationGenerationOptions = {
      ...generationOptions,
      onAttempt: attemptReporter(
        "context minimization",
        attemptedMinimizationModelConfigurationIds,
      ),
    };
    let sensePromise: Promise<SenseAndHintResolution> | undefined;
    if (senseResolutionNeedsGeneration(candidate.senseResolution)) {
      const compatibleSenseNumbers = candidate.senseResolution.compatibleSenses;
      sensePromise = (async () =>
        await selectSensesAndMaybeGenerateHint(
          {
            senseSelection: {
              context: await markedSenseSelectionContext(
                candidate,
                entry.sense.flatMap((sense) => sense.partOfSpeech),
              ),
              recognitionTarget: candidate.keyRecognitionTarget,
              jmdictEntry: entry,
              compatibleSenseNumbers,
            },
            frontSideUsages: jmdictUsagesForSpelling(
              sameSpellingEntries,
              candidate.keyRecognitionTarget,
            ),
          },
          senseGenerationOptions,
        ))();
    }
    const minimizedContextPromise = needsMinimizedContext
      ? minimizeContext({ fullContext: cardContext }, minimizationGenerationOptions)
      : undefined;
    const failures = await applySettledCandidateEnrichment(
      candidate,
      entry,
      sameSpellingEntries,
      {
        ...(sensePromise === undefined ? {} : {
          sense: {
            promise: sensePromise,
            attemptedModelConfigurationIds: attemptedSenseModelConfigurationIds,
          },
        }),
        ...(minimizedContextPromise === undefined ? {} : {
          minimizedContext: {
            promise: minimizedContextPromise,
            attemptedModelConfigurationIds: attemptedMinimizationModelConfigurationIds,
          },
        }),
      },
      attemptedAt,
    );
    if (failures.length === 0) {
      ++generated;
      console.error(`  Generated ${candidate.noteId}: ${candidate.recognitionTarget}`);
    } else {
      ++failed;
      for (const failure of failures) {
        console.error(`  Failed ${candidate.noteId} (${failure.operation}): ${failure.error}`);
      }
      if (failures.some((failure) => isAIQuotaError(failure.error))) {
        rateLimited = true;
        console.error("  AI provider quota reached; leaving unscheduled candidates pending.");
      }
    }
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
