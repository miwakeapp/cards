/**
 * Builds a reviewable manifest for Animecards conversions.
 *
 * Run with: deno task animecards:prepare [--limit=N] [--query=...]
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { fieldOrder } from "card_model";
import { allJMDictEntries, type JMDictWord } from "data";
import { createACInvoke, DEFAULT_ANKI_CONNECT_URL } from "../shared/anki_connect.ts";
import { buildSpellingIndex } from "card_resolution";
import { ankiSearchValue, fetchNoteInfos } from "./anki.ts";
import { isAIQuotaError, MODEL_IDS, type ModelId } from "card_field_generation";
import { JSONLGenerationCache } from "card_field_generation/file-cache";
import { convertAnimecardsNote } from "./convert.ts";
import { type ExistingMiwakeCard, removeDuplicateKeys } from "./duplicate_keys.ts";
import { readingConflictForJMDictEntrySelection, selectJMDictEntry } from "./entry_selection.ts";
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
  includeMultipleSenses: boolean;
  includeSourceless: boolean;
  resolveEntriesWithAI: boolean;
  aiModel: ModelId | undefined;
  entryGenerationCachePath: string;
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
      "include-sourceless",
      "resolve-entries-with-ai",
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
      "entry-generation-cache",
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
  const aiModel = flags["ai-model"] as ModelId | undefined;
  if (aiModel !== undefined && !MODEL_IDS.includes(aiModel)) {
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
    includeSourceless: flags["include-sourceless"],
    resolveEntriesWithAI: flags["resolve-entries-with-ai"],
    aiModel,
    entryGenerationCachePath: flags["entry-generation-cache"] ??
      path.join(import.meta.dirname!, "..", "generated", "card-field-generation-cache.jsonl"),
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

function describeEntry(entry: JMDictWord): string {
  return entry.sense.map((sense, index) => {
    const glosses = sense.gloss
      .filter(({ lang }) => lang === "eng")
      .map(({ text }) => text)
      .join("; ");
    const qualifiers = [
      sense.partOfSpeech.length > 0 ? `part of speech: ${sense.partOfSpeech.join(", ")}` : "",
      sense.field.length > 0 ? `field: ${sense.field.join(", ")}` : "",
      sense.misc.length > 0 ? `usage: ${sense.misc.join(", ")}` : "",
      sense.info.length > 0 ? `note: ${sense.info.join("; ")}` : "",
    ].filter(Boolean);
    return `${index + 1}. ${glosses || "(no English gloss)"}${
      qualifiers.length === 0 ? "" : ` [${qualifiers.join("; ")}]`
    }`;
  }).join(" | ");
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
      "Usage: deno task animecards:prepare [--limit=N] [--query=...] [--source-model=Animecards] [--target-model=Miwake] [--output=PATH] [--anki-connect-url=URL] [--epub-texts-dir=PATH|--no-epub-source-lookup] [--jmdict-overrides=PATH] [--include-multiple-senses] [--include-sourceless] [--resolve-entries-with-ai] [--ai-model=MODEL] [--entry-generation-cache=PATH] [--word-field=NAME] [--sentence-field=NAME] [--glossary-field=NAME] [--reading-field=NAME] [--source-field=NAME] [--source-url-field=NAME]",
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

  const missingTargetFields = fieldOrder.filter((name) => !targetModelFields.includes(name));
  const unexpectedTargetFields = targetModelFields.filter(
    (name) => !(fieldOrder as readonly string[]).includes(name),
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
  const entryGenerationCache = new JSONLGenerationCache(options.entryGenerationCachePath);
  let selectedEntryResolutions = 0;
  let inconclusiveEntryResolutions = 0;
  let failedEntryResolutions = 0;
  let processed = 0;
  for (const note of notes) {
    const conversionOptions: Parameters<typeof convertAnimecardsNote>[1] = {
      sourceModel: options.sourceModel,
      targetModel: options.targetModel,
      sourceFields,
      entries,
      spellingIndex,
      jmdictIdOverride: jmdictOverrides.get(note.noteId),
      epubSourceCorpus,
      includeMultipleSenses: options.includeMultipleSenses,
      includeSourceless: options.includeSourceless,
      resolveAmbiguousEntries: options.resolveEntriesWithAI,
    };
    let result = await convertAnimecardsNote(note, conversionOptions);
    if (options.resolveEntriesWithAI) {
      for (let attempt = 0; attempt < 3 && result.unresolvedJMDictEntry !== undefined; ++attempt) {
        const request = result.unresolvedJMDictEntry;
        try {
          let selection = await selectJMDictEntry(request, {
            ...(options.aiModel === undefined ? {} : { modelId: options.aiModel }),
            cache: entryGenerationCache,
            maxAttempts: 3,
            onAttempt(attempt) {
              if (attempt.validationError !== undefined && attempt.number < 3) {
                console.error(
                  `  Retrying entry selection for ${note.noteId} after invalid result ${attempt.number}/3: ${attempt.validationError}`,
                );
              }
            },
          });
          if (selection.status === "selected") {
            const readingConflict = readingConflictForJMDictEntrySelection(
              request,
              selection.jmdictId,
            );
            if (readingConflict === null) {
              ++selectedEntryResolutions;
              result = await convertAnimecardsNote(note, {
                ...conversionOptions,
                jmdictEntrySelectionOverride: selection,
              });
              continue;
            }
            selection = {
              ...readingConflict,
              modelConfigurationIds: selection.modelConfigurationIds,
            };
          }

          ++inconclusiveEntryResolutions;
          let reason: string;
          let detail: string;
          if (selection.status === "no-match") {
            reason = "no-applicable-jmdict-entry";
            detail = request.candidateEntries.map(({ id }) => id).join(", ");
          } else if (selection.status === "no-reading-match") {
            reason = "source-reading-matches-no-jmdict-entry";
            detail = request.kanaReading;
          } else if (selection.status === "ambiguous") {
            reason = "ai-ambiguous-jmdict-entry";
            detail = selection.possibleJMDictIds.join(", ");
          } else if (selection.status === "sense-ambiguous") {
            reason = "ai-ambiguous-jmdict-sense";
            detail = `${selection.possibleJMDictId}: ${selection.possibleSenseNumbers.join(", ")}`;
          } else if (selection.status === "disallowed") {
            reason = "ai-selected-unlinked-jmdict-entry";
            detail = selection.selectedJMDictId;
          } else {
            reason = "ai-selected-reading-incompatible-jmdict-entry";
            detail = `${selection.selectedJMDictId}; Animecard: ${request.kanaReading}; JMDict: ${
              selection.compatibleReadings.join(", ") || "none"
            }`;
          }
          result = {
            skipped: {
              noteId: note.noteId,
              word: request.recognitionTarget,
              reason,
              detail,
              entrySelection: {
                model: selection.modelConfigurationIds.join(", ") || "(no AI call)",
                recognitionTarget: request.recognitionTarget,
                context: request.context,
                candidateJMDictIds: request.candidateEntries.map(({ id }) => id).toSorted(),
                allowedJMDictIds: [...request.allowedJMDictIds].toSorted(),
                candidateDescriptions: Object.fromEntries(
                  request.candidateEntries.map((entry) => [entry.id, describeEntry(entry)]),
                ),
              },
            },
          };
        } catch (error) {
          if (isAIQuotaError(error)) throw error;
          ++failedEntryResolutions;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`  Entry AI failed for ${note.noteId}: ${message}`);
          result = {
            skipped: {
              noteId: note.noteId,
              word: request.recognitionTarget,
              reason: "jmdict-entry-ai-failed",
              detail: message,
            },
          };
        }
      }
      if (result.unresolvedJMDictEntry !== undefined) {
        ++failedEntryResolutions;
        result = {
          skipped: {
            noteId: note.noteId,
            word: result.unresolvedJMDictEntry.recognitionTarget,
            reason: "jmdict-entry-resolution-did-not-converge",
            detail: result.unresolvedJMDictEntry.candidateEntries.map(({ id }) => id).join(", "),
          },
        };
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
  const existingCards: ExistingMiwakeCard[] = [];
  for (const note of targetNotes) {
    const key = normalizePlainText(note.fields["Key"]?.value ?? "");
    if (!key) continue;
    existingCards.push({
      noteId: note.noteId,
      key,
    });
  }
  const deduplicated = removeDuplicateKeys(candidates, existingCards, sourceFields.word, entries);
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
  if (options.resolveEntriesWithAI) {
    console.error(
      `JMDict-entry AI: ${selectedEntryResolutions} selected, ${inconclusiveEntryResolutions} inconclusive, ${failedEntryResolutions} failed.`,
    );
  }
  console.error(`Skipped ${skipped.length}: ${JSON.stringify(Object.fromEntries(reasonCounts))}`);
  console.error("Review the manifest, then run animecards:apply without --write first.");
}

if (import.meta.main) await main();
