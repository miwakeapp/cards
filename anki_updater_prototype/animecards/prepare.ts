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
import { convertAnimecardsNote, MIWAKE_FIELD_NAMES } from "./convert.ts";
import { resolveSourceFields } from "./fields.ts";
import { normalizePlainText } from "./html.ts";
import { defaultReportPath, writeConversionAuditArtifacts } from "./report.ts";
import { type EPUBSourceCorpus, loadEPUBSourceCorpus } from "./source.ts";
import {
  CONVERSION_MANIFEST_VERSION,
  type ConversionCandidate,
  type ConversionManifest,
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
  fields: {
    word?: string;
    sentence?: string;
    glossary?: string;
    reading?: string;
    source?: string;
    sourceURL?: string;
  };
}

// The enrichment and deduplication stages retain support for multi-sense entries so that we can
// validate and enable it later. Production preparation remains deliberately single-sense-only.
const INCLUDE_MULTIPLE_SENSE_ENTRIES = false;

function positiveInteger(value: unknown, flag: string): number {
  const parsed = typeof value === "string" && value !== "" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArguments(args: string[]): Options {
  const flags = parseArgs(args, {
    boolean: ["no-epub-source-lookup"],
    string: [
      "query",
      "source-model",
      "target-model",
      "output",
      "limit",
      "anki-connect-url",
      "epub-texts-dir",
      "jmdict-overrides",
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
    unknown: (argument) => {
      throw new Error(`Unknown argument: ${argument}`);
    },
  });
  if (flags._.length > 0) {
    throw new Error(`Unexpected arguments: ${flags._.join(" ")}`);
  }

  const sourceModel = flags["source-model"];
  const date = new Date().toISOString().slice(0, 10);
  return {
    query: flags.query ?? `note:${ankiSearchValue(sourceModel)}`,
    sourceModel,
    targetModel: flags["target-model"],
    output: flags.output ??
      path.join(import.meta.dirname!, "..", "generated", `animecards-${date}.json`),
    limit: flags.limit === undefined ? undefined : positiveInteger(flags.limit, "--limit"),
    ankiConnectURL: flags["anki-connect-url"],
    epubTextsDirectory: flags["no-epub-source-lookup"]
      ? undefined
      : flags["epub-texts-dir"] ?? path.join(import.meta.dirname!, "..", "epub_texts"),
    jmdictOverridesPath: flags["jmdict-overrides"],
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

function removeDuplicateKeys(
  candidates: ConversionCandidate[],
  existingKeys: Map<string, number[]>,
  sourceWordField: string,
): { candidates: ConversionCandidate[]; skipped: SkippedNote[] } {
  const byKey = new Map<string, ConversionCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.senseResolution.status !== "not-needed") {
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
  kept.push(...candidates.filter((candidate) => candidate.senseResolution.status !== "not-needed"));
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
      "Usage: deno task animecards:prepare [--limit=N] [--query=...] [--source-model=Animecards] [--target-model=Miwake] [--output=PATH] [--anki-connect-url=URL] [--epub-texts-dir=PATH|--no-epub-source-lookup] [--jmdict-overrides=PATH] [--word-field=NAME] [--sentence-field=NAME] [--glossary-field=NAME] [--reading-field=NAME] [--source-field=NAME] [--source-url-field=NAME]",
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
      `Target model ${options.targetModel} fields do not match Miwake. Missing: ${
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
  let processed = 0;
  for (const note of notes) {
    const result = await convertAnimecardsNote(note, {
      sourceModel: options.sourceModel,
      targetModel: options.targetModel,
      sourceFields,
      entries,
      spellingIndex,
      jmdictIdOverride: jmdictOverrides.get(note.noteId),
      epubSourceCorpus,
      includeMultipleSenses: INCLUDE_MULTIPLE_SENSE_ENTRIES,
    });
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
  console.error(`Skipped ${skipped.length}: ${JSON.stringify(Object.fromEntries(reasonCounts))}`);
  console.error("Review the manifest, then run animecards:apply without --write first.");
}

if (import.meta.main) await main();
