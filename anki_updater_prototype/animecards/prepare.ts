/**
 * Builds a reviewable manifest for Animecards conversions.
 *
 * Run with: deno task animecards:prepare [--limit=N] [--query=...]
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { allJMDictEntries } from "data";
import { createACInvoke, DEFAULT_ANKI_CONNECT_URL } from "../shared/anki_connect.ts";
import { buildSpellingIndex } from "../shared/jmdict_resolution/recognition_target_lookup.ts";
import { ankiSearchValue, fetchNoteInfos } from "./anki.ts";
import {
  DEFAULT_MODEL_ID,
  generateCardFields,
  MODEL_IDS,
  type ModelId,
} from "card_field_generation";
import {
  convertAnimecardsNote,
  MIWAKE_FIELD_NAMES,
  type UnresolvedTargetInContext,
} from "./convert.ts";
import { resolveSourceFields } from "./fields.ts";
import { normalizePlainText } from "./html.ts";
import { defaultReportPath, writeConversionAuditArtifacts } from "./report.ts";
import { type EPUBSourceCorpus, loadEPUBSourceCorpus } from "./source.ts";
import {
  CONVERSION_MANIFEST_VERSION,
  type ConversionCandidate,
  type ConversionManifest,
  senseResolutionIsComplete,
  type SkippedNote,
} from "./types.ts";

interface Options {
  query: string;
  sourceModel: string;
  targetModel: string;
  output: string;
  limit: number | undefined;
  ankiConnectURL: string;
  epubTextsDirectory: string | undefined;
  jmdictOverridesPath: string | undefined;
  includeMultipleSenses: boolean;
  resolveTargetsWithAI: boolean;
  aiModel: ModelId;
  targetAICachePath: string;
  fields: {
    word?: string;
    sentence?: string;
    glossary?: string;
    reading?: string;
    source?: string;
    sourceURL?: string;
  };
}

function positiveInteger(value: unknown, flag: string): number {
  const parsed = typeof value === "string" && value !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArguments(args: string[]): Options {
  const flags = parseArgs(args, {
    boolean: [
      "no-epub-source-lookup",
      "include-multiple-senses",
      "resolve-targets-with-ai",
    ],
    string: [
      "query",
      "source-model",
      "target-model",
      "output",
      "limit",
      "anki-connect-url",
      "epub-texts-dir",
      "jmdict-overrides",
      "ai-model",
      "target-ai-cache",
      "word-field",
      "sentence-field",
      "glossary-field",
      "reading-field",
      "source-field",
      "source-url-field",
    ],
    default: {
      "source-model": "Animecards",
      "target-model": "Miwake",
      "anki-connect-url": DEFAULT_ANKI_CONNECT_URL,
    },
  });

  const sourceModel = flags["source-model"];
  const date = new Date().toISOString().slice(0, 10);
  const output = flags.output ??
    path.join(import.meta.dirname!, "..", "generated", `animecards-${date}.json`);
  const aiModel = flags["ai-model"] ?? DEFAULT_MODEL_ID;
  if (!MODEL_IDS.includes(aiModel as ModelId)) {
    throw new Error(`Unknown AI model: ${aiModel}. Available: ${MODEL_IDS.join(", ")}`);
  }
  return {
    query: flags.query ?? `note:${ankiSearchValue(sourceModel)}`,
    sourceModel,
    targetModel: flags["target-model"],
    output,
    limit: flags.limit === undefined ? undefined : positiveInteger(flags.limit, "--limit"),
    ankiConnectURL: flags["anki-connect-url"],
    epubTextsDirectory: flags["no-epub-source-lookup"]
      ? undefined
      : flags["epub-texts-dir"] ?? path.join(import.meta.dirname!, "..", "epub_texts"),
    jmdictOverridesPath: flags["jmdict-overrides"],
    includeMultipleSenses: flags["include-multiple-senses"],
    resolveTargetsWithAI: flags["resolve-targets-with-ai"],
    aiModel: aiModel as ModelId,
    targetAICachePath: flags["target-ai-cache"] ?? `${output}.target-ai-cache.jsonl`,
    fields: {
      word: flags["word-field"],
      sentence: flags["sentence-field"],
      glossary: flags["glossary-field"],
      reading: flags["reading-field"],
      source: flags["source-field"],
      sourceURL: flags["source-url-field"],
    },
  };
}

interface CachedTargetInContext {
  inputFingerprint: string;
  model: ModelId;
  generatedAt: string;
  surface: string;
}

async function targetInputFingerprint(
  request: UnresolvedTargetInContext,
  model: ModelId,
): Promise<string> {
  const value = JSON.stringify({
    version: 1,
    model,
    jmdictId: request.entry.id,
    recognitionTarget: request.recognitionTarget,
    reading: request.reading,
    context: request.context,
    source: request.sourceResolution,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadTargetAICache(filePath: string): Promise<Map<string, CachedTargetInContext>> {
  let content: string;
  try {
    content = await Deno.readTextFile(filePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return new Map();
    throw error;
  }
  return new Map(
    content.split("\n").filter(Boolean).map((line) => {
      const item = JSON.parse(line) as CachedTargetInContext;
      return [`${item.model}:${item.inputFingerprint}`, item];
    }),
  );
}

async function appendTargetAICache(
  filePath: string,
  value: CachedTargetInContext,
): Promise<void> {
  await Deno.mkdir(path.dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, `${JSON.stringify(value)}\n`, { append: true });
}

function removeDuplicateKeys(
  candidates: ConversionCandidate[],
  existingKeys: Map<string, number[]>,
  sourceWordField: string,
): { candidates: ConversionCandidate[]; skipped: SkippedNote[] } {
  const byKey = new Map<string, ConversionCandidate[]>();
  for (const candidate of candidates) {
    if (!senseResolutionIsComplete(candidate.senseResolution)) {
      continue;
    }
    const key = candidate.target.fields["Key"];
    const values = byKey.get(key) ?? [];
    values.push(candidate);
    byKey.set(key, values);
  }

  const kept: ConversionCandidate[] = [];
  const skipped: SkippedNote[] = [];
  for (const [key, values] of byKey) {
    const existing = existingKeys.get(key) ?? [];
    const conflicts = [...values.map((candidate) => candidate.noteId), ...existing];
    if (conflicts.length > 1 || existing.length > 0) {
      for (const candidate of values) {
        skipped.push({
          noteId: candidate.noteId,
          word: normalizePlainText(candidate.original.fields[sourceWordField] ?? ""),
          reason: "duplicate-miwake-key",
          detail: `${key}; note IDs: ${conflicts.join(", ")}`,
        });
      }
    } else {
      kept.push(values[0]);
    }
  }
  kept.push(
    ...candidates.filter((candidate) => !senseResolutionIsComplete(candidate.senseResolution)),
  );
  return { candidates: kept, skipped };
}

async function loadJMDictOverrides(filePath: string | undefined): Promise<Map<number, string>> {
  if (filePath === undefined) return new Map();
  const value = JSON.parse(await Deno.readTextFile(filePath)) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("--jmdict-overrides must contain a JSON object mapping note IDs to JMDict IDs");
  }
  const overrides = new Map<number, string>();
  for (const [rawNoteId, rawJMDictId] of Object.entries(value)) {
    const noteId = Number(rawNoteId);
    if (
      !Number.isSafeInteger(noteId) || noteId <= 0 ||
      typeof rawJMDictId !== "string" || !/^\d+$/u.test(rawJMDictId)
    ) {
      throw new Error(
        `Invalid JMDict override: ${JSON.stringify(rawNoteId)}: ${JSON.stringify(rawJMDictId)}`,
      );
    }
    overrides.set(noteId, rawJMDictId);
  }
  return overrides;
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parseArguments(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Usage: deno task animecards:prepare [--limit=N] [--query=...] [--source-model=Animecards] [--target-model=Miwake] [--output=PATH] [--anki-connect-url=URL] [--epub-texts-dir=PATH|--no-epub-source-lookup] [--jmdict-overrides=PATH] [--include-multiple-senses] [--resolve-targets-with-ai] [--ai-model=MODEL] [--target-ai-cache=PATH] [--word-field=NAME] [--sentence-field=NAME] [--glossary-field=NAME] [--reading-field=NAME] [--source-field=NAME] [--source-url-field=NAME]",
    );
    Deno.exit(1);
  }

  const invoke = createACInvoke(options.ankiConnectURL);
  const [profile, sourceModelFields, targetModelFields] = await Promise.all([
    invoke<string>("getActiveProfile"),
    invoke<string[]>("modelFieldNames", { modelName: options.sourceModel }),
    invoke<string[]>("modelFieldNames", { modelName: options.targetModel }),
  ]);
  console.error(`Connected to Anki profile "${profile}".`);

  const missingTargetFields = MIWAKE_FIELD_NAMES.filter((name) =>
    !targetModelFields.includes(name)
  );
  const unexpectedTargetFields = targetModelFields.filter(
    (name) => !(MIWAKE_FIELD_NAMES as readonly string[]).includes(name),
  );
  if (missingTargetFields.length > 0 || unexpectedTargetFields.length > 0) {
    throw new Error(
      `Target model ${options.targetModel} fields do not match the Miwake Card format. Missing: ${
        missingTargetFields.join(", ") || "none"
      }; unexpected: ${unexpectedTargetFields.join(", ") || "none"}`,
    );
  }
  const sourceFields = resolveSourceFields(sourceModelFields, options.fields);
  console.error(`Source field mapping: ${JSON.stringify(sourceFields)}`);

  let noteIds = await invoke<number[]>("findNotes", { query: options.query });
  if (options.limit !== undefined) {
    noteIds = noteIds.slice(0, options.limit);
  }
  console.error(`Fetching ${noteIds.length} source notes for query: ${options.query}`);
  const notes = await fetchNoteInfos(
    noteIds,
    invoke,
    {
      onProgress: (fetched, total) => console.error(`  Fetched ${fetched}/${total}`),
    },
  );

  console.error("Loading JMDict...");
  const entries = await allJMDictEntries();
  const spellingIndex = buildSpellingIndex(entries.values());
  const jmdictOverrides = await loadJMDictOverrides(options.jmdictOverridesPath);
  let epubSourceCorpus: EPUBSourceCorpus | undefined;
  if (options.epubTextsDirectory !== undefined) {
    try {
      console.error(`Loading EPUB source corpus from ${options.epubTextsDirectory}...`);
      epubSourceCorpus = await loadEPUBSourceCorpus(options.epubTextsDirectory);
      console.error(`Loaded ${epubSourceCorpus.sources.length} EPUB sources.`);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        console.error("EPUB source directory not found; continuing without source recovery.");
      } else {
        throw error;
      }
    }
  }
  console.error(`Loaded ${entries.size} entries. Preparing conversions...`);

  const candidates: ConversionCandidate[] = [];
  const skipped: SkippedNote[] = [];
  const targetAICache = options.resolveTargetsWithAI
    ? await loadTargetAICache(options.targetAICachePath)
    : new Map<string, CachedTargetInContext>();
  let generatedTargetResolutions = 0;
  let reusedTargetResolutions = 0;
  let failedTargetResolutions = 0;
  let processed = 0;
  for (const note of notes) {
    const conversionOptions = {
      sourceModel: options.sourceModel,
      targetModel: options.targetModel,
      sourceFields,
      entries,
      spellingIndex,
      jmdictIdOverride: jmdictOverrides.get(note.noteId),
      epubSourceCorpus,
      includeMultipleSenses: options.includeMultipleSenses,
    };
    let result = await convertAnimecardsNote(note, conversionOptions);
    if (
      options.resolveTargetsWithAI &&
      "unresolvedTargetInContext" in result &&
      result.unresolvedTargetInContext !== undefined
    ) {
      const request = result.unresolvedTargetInContext;
      const inputFingerprint = await targetInputFingerprint(request, options.aiModel);
      const cacheKey = `${options.aiModel}:${inputFingerprint}`;
      let resolved = targetAICache.get(cacheKey);
      try {
        if (resolved === undefined) {
          const generatedAt = new Date().toISOString();
          // The canonical call also returns sense and minimized-context fields. This pass uses only
          // `targetInContext`; the normal enrichment stage remains authoritative for the others.
          const fields = await generateCardFields({
            context: request.context,
            recognitionTarget: request.recognitionTarget,
            jmdictEntry: request.entry,
            source: request.sourceResolution.name ?? undefined,
            sourceURL: request.sourceResolution.url ?? undefined,
            kanaReading: request.reading,
          }, options.aiModel);
          if (fields.applicableSenses === null) {
            throw new Error(
              `No JMDict sense applies to recognition target ${
                JSON.stringify(request.recognitionTarget)
              } in the supplied context.`,
            );
          }
          const surface = fields.targetInContext;
          if (surface.length === 0 || !request.context.includes(surface)) {
            throw new Error(
              `AI target is not a literal substring: ${JSON.stringify(surface)}`,
            );
          }
          resolved = { inputFingerprint, model: options.aiModel, generatedAt, surface };
          await appendTargetAICache(options.targetAICachePath, resolved);
          targetAICache.set(cacheKey, resolved);
          ++generatedTargetResolutions;
        } else {
          ++reusedTargetResolutions;
        }
        result = await convertAnimecardsNote(note, {
          ...conversionOptions,
          targetInContextOverride: resolved,
        });
      } catch (error) {
        ++failedTargetResolutions;
        console.error(
          `  Target AI failed for ${note.noteId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (result.candidate) {
      candidates.push(result.candidate);
    } else {
      skipped.push(result.skipped);
    }
    ++processed;
    if (processed % 100 === 0 || processed === notes.length) {
      console.error(`  Analyzed ${processed}/${notes.length}`);
    }
  }

  const targetNoteIds = await invoke<number[]>("findNotes", {
    query: `note:${ankiSearchValue(options.targetModel)}`,
  });
  const targetNotes = await fetchNoteInfos(targetNoteIds, invoke);
  const existingKeys = new Map<string, number[]>();
  for (const note of targetNotes) {
    const key = normalizePlainText(note.fields["Key"]?.value ?? "");
    if (!key) continue;
    const noteIdsForKey = existingKeys.get(key) ?? [];
    noteIdsForKey.push(note.noteId);
    existingKeys.set(key, noteIdsForKey);
  }
  const deduplicated = removeDuplicateKeys(candidates, existingKeys, sourceFields.word);
  skipped.push(...deduplicated.skipped);

  const manifest: ConversionManifest = {
    version: CONVERSION_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    query: options.query,
    sourceModel: options.sourceModel,
    targetModel: options.targetModel,
    sourceFields,
    candidates: deduplicated.candidates,
    skipped,
  };
  await Deno.mkdir(path.dirname(options.output), { recursive: true });
  await Deno.writeTextFile(options.output, `${JSON.stringify(manifest, undefined, 2)}\n`);
  const reportPath = defaultReportPath(options.output);
  await writeConversionAuditArtifacts(manifest, options.output, reportPath);

  const reasonCounts = new Map<string, number>();
  for (const item of skipped) {
    reasonCounts.set(item.reason, (reasonCounts.get(item.reason) ?? 0) + 1);
  }
  console.error(`Wrote ${manifest.candidates.length} conversion candidates to ${options.output}`);
  console.error(`Wrote audit report to ${reportPath}`);
  const sourceCounts = new Map<string, number>();
  for (const candidate of manifest.candidates) {
    const method = candidate.sourceResolution.method;
    sourceCounts.set(method, (sourceCounts.get(method) ?? 0) + 1);
  }
  console.error(`Sources: ${JSON.stringify(Object.fromEntries(sourceCounts))}`);
  if (options.resolveTargetsWithAI) {
    console.error(
      `Target-in-context AI: ${generatedTargetResolutions} generated, ${reusedTargetResolutions} cached, ${failedTargetResolutions} failed.`,
    );
  }
  console.error(`Skipped ${skipped.length}: ${JSON.stringify(Object.fromEntries(reasonCounts))}`);
  console.error("Review the manifest, then run animecards:apply without --write first.");
}

if (import.meta.main) await main();
