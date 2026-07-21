/**
 * Restores source-authored ruby and expands cutoff Animecards contexts from EPUB text.
 *
 * Run with: deno task animecards:restore-context MANIFEST.json [--model=MODEL] [--limit=N]
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { MODEL_IDS, type ModelId } from "card_creator/ai";
import { allJMDictEntries } from "data";
import { buildSpellingIndex } from "../shared/jmdict_resolution/recognition_target_lookup.ts";
import {
  EPUB_CONTEXT_PROMPT_VERSION,
  EPUB_RELEVANCE_SELECTION_VERSION,
  extractFullEPUBContext,
  selectRelevantEPUBContext,
} from "./epub_context_extraction.ts";
import { convertAnimecardsNote } from "./convert.ts";
import { checkpointMatchesInput, createCheckpointManifest } from "./checkpoint.ts";
import { normalizeContextHTML } from "./html.ts";
import { writeConversionAuditArtifacts } from "./report.ts";
import {
  elideLongQuotedEPUBContext,
  EPUBBracketsAreBalanced,
  expandEPUBContextToBalancedParagraphEnd,
  expandEPUBContextToSentence,
  extractEPUBHTMLSubstring,
  findUniqueEPUBContext,
  formatRelevantQuotedEPUBContext,
  hasCompleteContextBoundaries,
  loadEPUBSourceCorpus,
  quotedEPUBContextNeedsRelevanceSelection,
  searchableEPUBText,
} from "./source.ts";
import {
  type AnkiNoteInfo,
  CONVERSION_MANIFEST_VERSION,
  type ConversionCandidate,
  type ConversionManifest,
  deferUnavailableSourceContexts,
} from "./types.ts";

interface Options {
  manifestPath: string;
  outputPath: string;
  cachePath: string;
  epubTextsDirectory: string;
  model: ModelId;
  limit: number | undefined;
  concurrency: number;
}

interface CachedContextResult {
  noteId: number;
  inputFingerprint: string;
  model: ModelId;
  generatedAt: string;
  contextHTML?: string;
  error?: string;
}

function derivedPath(manifestPath: string, suffix: string): string {
  const extension = path.extname(manifestPath);
  return `${manifestPath.slice(0, -extension.length)}.${suffix}${extension}`;
}

function positiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be positive.`);
  return parsed;
}

function parseArguments(args: string[]): Options {
  const flags = parseArgs(args, {
    string: ["_", "output", "cache", "epub-texts-dir", "model", "limit", "concurrency"],
  });
  const [manifestPath] = flags._;
  if (manifestPath === undefined) throw new Error("A conversion manifest path is required.");
  const outputPath = flags.output ?? derivedPath(manifestPath, "context");
  const model = flags.model ?? "gemini-3.5-flash" satisfies ModelId;
  if (!MODEL_IDS.includes(model as ModelId)) {
    throw new Error(`Unknown model: ${model}. Available: ${MODEL_IDS.join(", ")}`);
  }
  return {
    manifestPath,
    outputPath,
    cachePath: flags.cache ?? `${outputPath}.context-cache.jsonl`,
    epubTextsDirectory: flags["epub-texts-dir"] ??
      path.join(import.meta.dirname!, "..", "epub_texts"),
    model: model as ModelId,
    limit: positiveInteger(flags.limit, "--limit"),
    concurrency: positiveInteger(flags.concurrency, "--concurrency") ?? 5,
  };
}

function parseManifest(json: string): ConversionManifest {
  const manifest = JSON.parse(json) as ConversionManifest;
  if (manifest.version !== CONVERSION_MANIFEST_VERSION || !Array.isArray(manifest.candidates)) {
    throw new Error(`Expected an Animecards manifest at version ${CONVERSION_MANIFEST_VERSION}.`);
  }
  return manifest;
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
      throw new Error(`Existing checkpoint ${options.outputPath} belongs to another manifest.`);
    }
    console.error(`Resuming checkpoint ${options.outputPath}.`);
    return checkpoint;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return await createCheckpointManifest(original);
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadCache(cachePath: string): Promise<Map<string, CachedContextResult>> {
  let content: string;
  try {
    content = await Deno.readTextFile(cachePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return new Map();
    throw error;
  }
  const results = new Map<string, CachedContextResult>();
  for (const line of content.split("\n").filter(Boolean)) {
    const result = JSON.parse(line) as CachedContextResult;
    if (result.contextHTML !== undefined) {
      results.set(`${result.noteId}:${result.inputFingerprint}`, result);
    }
  }
  return results;
}

function originalNote(candidate: ConversionCandidate): AnkiNoteInfo {
  return {
    noteId: candidate.noteId,
    modelName: candidate.original.modelName,
    tags: candidate.original.tags,
    cards: candidate.original.cards,
    fields: Object.fromEntries(
      Object.entries(candidate.original.fields).map(([name, value], order) => [
        name,
        { value, order },
      ]),
    ),
  };
}

function sourceField(candidate: ConversionCandidate, fieldName: string | null): string {
  return fieldName === null ? "" : candidate.original.fields[fieldName] ?? "";
}

async function main(): Promise<void> {
  const options = parseArguments(Deno.args);
  const manifest = await loadWorkingManifest(options);
  const newlyDeferred = deferUnavailableSourceContexts(manifest);
  if (newlyDeferred > 0) {
    console.error(`Deferred ${newlyDeferred} candidates without source-backed full context.`);
  }
  const cache = await loadCache(options.cachePath);
  console.error(`Loaded ${cache.size} successful cached context restorations.`);

  console.error(`Loading EPUB source corpus from ${options.epubTextsDirectory}...`);
  const corpus = await loadEPUBSourceCorpus(options.epubTextsDirectory);
  console.error("Loading JMDict...");
  const entries = await allJMDictEntries();
  const spellingIndex = buildSpellingIndex(entries.values());

  let candidates = manifest.candidates.filter((candidate) =>
    ["pending", "failed"].includes(candidate.fullContextResolution.status)
  );
  if (options.limit !== undefined) candidates = candidates.slice(0, options.limit);
  console.error(
    `Restoring ${candidates.length} cutoff contexts with ${options.model} at concurrency ${options.concurrency}...`,
  );

  const candidateIndexes = new Map(
    manifest.candidates.map((candidate, index) => [candidate.noteId, index]),
  );
  let generated = 0;
  let reused = 0;
  let failed = 0;
  let relevanceGenerated = 0;
  let relevanceReused = 0;
  let relevanceFailed = 0;
  let nextIndex = 0;
  let cacheWrite = Promise.resolve();

  async function cacheContextResult(cacheKey: string, result: CachedContextResult): Promise<void> {
    cache.set(cacheKey, result);
    cacheWrite = cacheWrite.then(() =>
      Deno.writeTextFile(options.cachePath, `${JSON.stringify(result)}\n`, { append: true })
    );
    await cacheWrite;
  }

  async function restoreNext(): Promise<void> {
    const workIndex = nextIndex++;
    if (workIndex >= candidates.length) return;
    const candidate = candidates[workIndex];
    const attemptedAt = new Date().toISOString();
    try {
      const originalContext = normalizeContextHTML(
        sourceField(candidate, manifest.sourceFields.sentence),
      );
      const source = candidate.fullContextResolution.status === "pending"
        ? candidate.fullContextResolution.source
        : candidate.sourceResolution.name;
      const match = findUniqueEPUBContext(corpus, originalContext, source ?? undefined);
      if (match === null) throw new Error("The original excerpt no longer has one EPUB match.");
      const inputFingerprint = await fingerprint({
        promptVersion: EPUB_CONTEXT_PROMPT_VERSION,
        model: options.model,
        word: candidate.recognitionTarget,
        originalContext,
        windowHTML: match.window.map((paragraph) => paragraph.html),
      });
      const cacheKey = `${candidate.noteId}:${inputFingerprint}`;
      const cached = cache.get(cacheKey);
      const originalText = searchableEPUBText(originalContext);
      let restoredHTML: string;
      let generatedAt: string;
      let resolution: ConversionCandidate["fullContextResolution"];
      const deterministicRecovery = candidate.fullContextResolution.status === "failed"
        ? (hasCompleteContextBoundaries(match.paragraph.plainText, originalText)
          ? extractEPUBHTMLSubstring(match.paragraph.html, originalText)
          : expandEPUBContextToSentence(match.paragraph, originalContext) ??
            expandEPUBContextToBalancedParagraphEnd(match.paragraph, originalContext))
        : null;
      if (deterministicRecovery !== null) {
        restoredHTML = deterministicRecovery;
        generatedAt = attemptedAt;
        resolution = { status: "restored", method: "exact" };
        ++reused;
      } else if (cached !== undefined && cached.contextHTML !== undefined) {
        restoredHTML = cached.contextHTML;
        generatedAt = cached.generatedAt;
        resolution = {
          status: "restored",
          method: "ai",
          model: cached.model,
          generatedAt,
        };
        ++reused;
      } else {
        const extracted = await extractFullEPUBContext({
          windowHTML: match.window.map((paragraph) => paragraph.html),
          word: candidate.recognitionTarget,
          originalContext,
        }, options.model);
        const extractedText = searchableEPUBText(extracted);
        if (!extractedText.includes(originalText)) {
          throw new Error("Extracted context does not contain the complete original excerpt.");
        }
        const windowHTML = match.window.map((paragraph) => paragraph.html).join("<br>");
        restoredHTML = extractEPUBHTMLSubstring(windowHTML, extractedText) ?? "";
        if (!restoredHTML) {
          throw new Error(
            "Extracted context is not a unique verbatim substring of the EPUB window.",
          );
        }
        const isCompleteWithinParagraph = match.window.some((paragraph) =>
          hasCompleteContextBoundaries(paragraph.plainText, extractedText)
        );
        if (
          extractedText.length <= originalText.length ||
          !EPUBBracketsAreBalanced(extractedText) ||
          (!isCompleteWithinParagraph && !restoredHTML.includes("<br>"))
        ) {
          throw new Error(
            "Extracted context is not a longer, complete, balanced source excerpt.",
          );
        }
        generatedAt = attemptedAt;
        const cachedResult: CachedContextResult = {
          noteId: candidate.noteId,
          inputFingerprint,
          model: options.model,
          generatedAt,
          contextHTML: restoredHTML,
        };
        await cacheContextResult(cacheKey, cachedResult);
        resolution = {
          status: "restored",
          method: "ai",
          model: options.model,
          generatedAt,
        };
        ++generated;
      }

      if (quotedEPUBContextNeedsRelevanceSelection(restoredHTML, originalContext)) {
        const relevanceInputFingerprint = await fingerprint({
          selectionVersion: EPUB_RELEVANCE_SELECTION_VERSION,
          stage: "quoted-context-relevance",
          model: options.model,
          word: candidate.recognitionTarget,
          originalContext,
          restoredHTML,
        });
        const relevanceCacheKey = `${candidate.noteId}:${relevanceInputFingerprint}`;
        const cachedRelevance = cache.get(relevanceCacheKey);
        if (cachedRelevance?.contextHTML !== undefined) {
          restoredHTML = cachedRelevance.contextHTML;
          generatedAt = cachedRelevance.generatedAt;
          resolution = {
            status: "restored",
            method: "ai",
            model: cachedRelevance.model,
            generatedAt,
          };
          ++relevanceReused;
        } else {
          try {
            const selected = await selectRelevantEPUBContext({
              restoredContext: restoredHTML,
              word: candidate.recognitionTarget,
              originalContext,
            }, options.model);
            const relevantHTML = formatRelevantQuotedEPUBContext(
              restoredHTML,
              selected,
              originalContext,
            );
            if (relevantHTML === null) {
              throw new Error(
                "Selected context was not a shorter, complete, verbatim source span.",
              );
            }
            restoredHTML = relevantHTML;
            generatedAt = attemptedAt;
            const cachedResult: CachedContextResult = {
              noteId: candidate.noteId,
              inputFingerprint: relevanceInputFingerprint,
              model: options.model,
              generatedAt,
              contextHTML: restoredHTML,
            };
            await cacheContextResult(relevanceCacheKey, cachedResult);
            resolution = {
              status: "restored",
              method: "ai",
              model: options.model,
              generatedAt,
            };
            ++relevanceGenerated;
            console.error(
              `  Minimized source context ${candidate.noteId}: ${candidate.recognitionTarget}`,
            );
          } catch (error) {
            ++relevanceFailed;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`  Kept full source context ${candidate.noteId}: ${message}`);
          }
        }
      }
      restoredHTML = elideLongQuotedEPUBContext(restoredHTML, originalContext);

      const converted = await convertAnimecardsNote(originalNote(candidate), {
        sourceModel: manifest.sourceModel,
        targetModel: manifest.targetModel,
        sourceFields: manifest.sourceFields,
        entries,
        spellingIndex,
        jmdictIdOverride: candidate.jmdictId,
        epubSourceCorpus: corpus,
        contextOverride: {
          html: restoredHTML,
          resolution,
          sourceResolution: candidate.sourceResolution,
        },
      });
      if (converted.candidate === undefined) {
        throw new Error(
          `Restored context failed deterministic conversion: ${converted.skipped.reason}${
            converted.skipped.detail ? ` (${converted.skipped.detail})` : ""
          }`,
        );
      }
      if (
        converted.candidate.jmdictId !== candidate.jmdictId ||
        converted.candidate.target.fields.Key !== candidate.target.fields.Key
      ) {
        throw new Error("Restored context changed the resolved JMDict entry or Miwake Card key.");
      }
      converted.candidate.approved = candidate.approved;
      manifest.candidates[candidateIndexes.get(candidate.noteId)!] = converted.candidate;
      console.error(`  Restored ${candidate.noteId}: ${candidate.recognitionTarget}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      candidate.fullContextResolution = {
        status: "failed",
        model: options.model,
        attemptedAt,
        error: message,
      };
      ++failed;
      console.error(`  Failed ${candidate.noteId}: ${message}`);
    }
    await restoreNext();
  }

  await Deno.mkdir(path.dirname(options.cachePath), { recursive: true });
  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, candidates.length) },
      () => restoreNext(),
    ),
  );
  await cacheWrite;
  await writeManifest(options.outputPath, manifest);
  await writeConversionAuditArtifacts(manifest, options.outputPath);
  console.error(
    `Context restoration: ${generated} generated, ${reused} cached, ${failed} failed. Output: ${options.outputPath}`,
  );
  console.error(
    `Quoted-context relevance: ${relevanceGenerated} generated, ${relevanceReused} cached, ${relevanceFailed} kept full.`,
  );
  if (failed > 0) Deno.exitCode = 1;
}

if (import.meta.main) await main();
