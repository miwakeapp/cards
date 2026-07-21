/**
 * Applies an Animecards conversion manifest in place with `updateNoteModel`.
 *
 * Dry-run is the default. Add `--write` only after reviewing the preflight report.
 */

import { parseArgs } from "@std/cli/parse-args";
import * as path from "@std/path";
import { createACInvoke, DEFAULT_ANKI_CONNECT_URL } from "../shared/anki_connect.ts";
import { ankiSearchValue, fetchNoteInfos } from "./anki.ts";
import { preflightCandidate } from "./apply_policy.ts";
import { MIWAKE_FIELD_NAMES } from "./convert.ts";
import { normalizePlainText } from "./html.ts";
import {
  CONVERSION_MANIFEST_VERSION,
  type ConversionCandidate,
  type ConversionManifest,
  deferredReason,
} from "./types.ts";

/** Validated command-line options for applying a conversion manifest. */
export interface ApplyOptions {
  /** Conversion manifest to validate or apply. */
  manifestPath: string;
  /** Whether collection writes are explicitly enabled. */
  write: boolean;
  /** Whether converted cards should be reset to Anki's new queue. */
  reset: boolean;
  /** Optional maximum number of approved candidates to process. */
  limit: number | undefined;
  /** Append-only result log used during writes. */
  logPath: string;
  /** AnkiConnect endpoint. */
  ankiConnectURL: string;
}

/** Parses the conversion manifest path and safe apply options. */
export function parseApplyArguments(args: string[]): ApplyOptions {
  const flags = parseArgs(args, {
    boolean: ["write", "reset"],
    string: ["_", "limit", "log", "anki-connect-url"],
    default: { "anki-connect-url": DEFAULT_ANKI_CONNECT_URL },
  });
  const [manifestPath] = flags._;
  if (manifestPath === undefined) {
    throw new Error("A conversion manifest path is required.");
  }
  let limit: number | undefined;
  if (flags.limit !== undefined) {
    limit = Number(flags.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("--limit must be a positive integer");
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  return {
    manifestPath,
    write: flags.write,
    reset: flags.reset,
    limit,
    logPath: flags.log ??
      path.join(import.meta.dirname!, "..", "generated", `animecards-apply-${date}.jsonl`),
    ankiConnectURL: flags["anki-connect-url"],
  };
}

function parseManifest(json: string): ConversionManifest {
  const value = JSON.parse(json) as Partial<ConversionManifest>;
  if (value.version !== CONVERSION_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported manifest version ${
        String(value.version)
      }; expected ${CONVERSION_MANIFEST_VERSION}.`,
    );
  }
  if (
    typeof value.sourceModel !== "string" ||
    typeof value.targetModel !== "string" ||
    !Array.isArray(value.candidates)
  ) {
    throw new Error("Malformed conversion manifest.");
  }
  return value as ConversionManifest;
}

function exactStringSet(left: string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function targetFieldsAreValid(candidate: ConversionCandidate): boolean {
  return exactStringSet(Object.keys(candidate.target.fields), MIWAKE_FIELD_NAMES);
}

async function appendLog(logPath: string, value: unknown): Promise<void> {
  await Deno.mkdir(path.dirname(logPath), { recursive: true });
  await Deno.writeTextFile(logPath, `${JSON.stringify(value)}\n`, { append: true });
}

async function main(): Promise<void> {
  let options: ApplyOptions;
  try {
    options = parseApplyArguments(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Usage: deno task animecards:apply MANIFEST.json [--limit=N] [--log=PATH] [--anki-connect-url=URL] [--reset] [--write]",
    );
    Deno.exit(1);
  }

  const manifest = parseManifest(await Deno.readTextFile(options.manifestPath));
  let candidates = manifest.candidates.filter((candidate) => deferredReason(candidate) === null);
  if (options.limit !== undefined) {
    candidates = candidates.slice(0, options.limit);
  }
  if (candidates.length === 0) {
    console.error("No approved conversion candidates to apply.");
    return;
  }
  const incompleteFullContexts = candidates.filter((candidate) =>
    candidate.fullContextResolution.status !== "restored"
  );
  if (incompleteFullContexts.length > 0) {
    throw new Error(
      `${incompleteFullContexts.length} approved candidates still need full-context restoration. Run animecards:restore-context before apply.`,
    );
  }
  const incompleteMinimizations = candidates.filter((candidate) =>
    !["not-needed", "generated"].includes(candidate.minimizedContextResolution.status)
  );
  if (incompleteMinimizations.length > 0) {
    throw new Error(
      `${incompleteMinimizations.length} approved candidates still need AI minimized-context enrichment. Run animecards:enrich before apply.`,
    );
  }
  const incompleteSenseSelections = candidates.filter((candidate) =>
    !["not-needed", "generated"].includes(candidate.senseResolution.status)
  );
  if (incompleteSenseSelections.length > 0) {
    throw new Error(
      `${incompleteSenseSelections.length} approved candidates still need AI sense selection. Run animecards:enrich before apply.`,
    );
  }

  const invoke = createACInvoke(options.ankiConnectURL);
  const [profile, sourceTemplates, targetTemplates, targetModelFields] = await Promise.all([
    invoke<string>("getActiveProfile"),
    invoke<Record<string, unknown>>("modelTemplates", { modelName: manifest.sourceModel }),
    invoke<Record<string, unknown>>("modelTemplates", { modelName: manifest.targetModel }),
    invoke<string[]>("modelFieldNames", { modelName: manifest.targetModel }),
  ]);
  console.error(`Connected to Anki profile "${profile}".`);
  if (Object.keys(sourceTemplates).length !== 1 || Object.keys(targetTemplates).length !== 1) {
    throw new Error(
      `In-place conversion requires one card template on each model; found ${
        Object.keys(sourceTemplates).length
      } on ${manifest.sourceModel} and ${
        Object.keys(targetTemplates).length
      } on ${manifest.targetModel}.`,
    );
  }
  if (!exactStringSet(targetModelFields, MIWAKE_FIELD_NAMES)) {
    throw new Error(
      `Target model ${manifest.targetModel} no longer has the expected Miwake Card fields.`,
    );
  }

  const invalidCandidates = candidates.filter((candidate) =>
    !targetFieldsAreValid(candidate) ||
    candidate.original.modelName !== manifest.sourceModel ||
    candidate.target.modelName !== manifest.targetModel
  );
  if (invalidCandidates.length > 0) {
    throw new Error(
      `Manifest candidates have invalid source/target models or fields: ${
        invalidCandidates.map((item) => item.noteId).join(", ")
      }`,
    );
  }

  console.error(`Fetching ${candidates.length} current source notes for preflight...`);
  const currentNotes = await fetchNoteInfos(
    candidates.map((candidate) => candidate.noteId),
    invoke,
    {
      chunkSize: 50,
      onProgress: (fetched, total) => console.error(`  Fetched source notes ${fetched}/${total}`),
      onRetry: (error, attempt, maxAttempts) =>
        console.error(
          `  Source-note batch failed (attempt ${attempt}/${maxAttempts}); retrying: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    },
  );
  const targetNoteIds = await invoke<number[]>("findNotes", {
    query: `note:${ankiSearchValue(manifest.targetModel)}`,
  });
  console.error(`Fetching ${targetNoteIds.length} existing target notes for key conflicts...`);
  const targetNotes = await fetchNoteInfos(
    targetNoteIds,
    invoke,
    {
      chunkSize: 50,
      onProgress: (fetched, total) => console.error(`  Fetched target notes ${fetched}/${total}`),
      onRetry: (error, attempt, maxAttempts) =>
        console.error(
          `  Target-note batch failed (attempt ${attempt}/${maxAttempts}); retrying: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
    },
  );
  const currentById = new Map(currentNotes.map((note) => [note.noteId, note]));
  const targetIdsByKey = new Map<string, number[]>();
  for (const note of targetNotes) {
    const key = normalizePlainText(note.fields["Key"]?.value ?? "");
    if (!key) continue;
    const ids = targetIdsByKey.get(key) ?? [];
    ids.push(note.noteId);
    targetIdsByKey.set(key, ids);
  }
  const candidateIdsByKey = new Map<string, number[]>();
  for (const candidate of candidates) {
    const key = candidate.target.fields["Key"];
    const ids = candidateIdsByKey.get(key) ?? [];
    ids.push(candidate.noteId);
    candidateIdsByKey.set(key, ids);
  }

  const ready: ConversionCandidate[] = [];
  const alreadyAppliedCandidates: ConversionCandidate[] = [];
  let alreadyApplied = 0;
  let rejected = 0;
  for (const candidate of candidates) {
    const key = candidate.target.fields["Key"];
    const result = await preflightCandidate(
      candidate,
      currentById.get(candidate.noteId),
      [...(targetIdsByKey.get(key) ?? []), ...(candidateIdsByKey.get(key) ?? [])],
    );
    if (result.status === "ready") {
      ready.push(candidate);
    } else if (result.status === "already-applied") {
      alreadyAppliedCandidates.push(candidate);
      ++alreadyApplied;
      console.error(`  Already applied: ${candidate.noteId} ${key}`);
    } else {
      ++rejected;
      console.error(`  Rejected: ${candidate.noteId} ${key}: ${result.error}`);
    }
  }
  console.error(
    `Preflight: ${ready.length} ready, ${alreadyApplied} already applied, ${rejected} rejected.`,
  );

  if (!options.write) {
    const resetCount = options.reset ? ready.length + alreadyAppliedCandidates.length : 0;
    console.error(
      `Dry run only. Re-run with --write to perform the in-place conversions${
        resetCount > 0 ? ` and reset ${resetCount} cards` : ""
      }.`,
    );
    return;
  }
  if (ready.length === 0 && (!options.reset || alreadyAppliedCandidates.length === 0)) {
    console.error("Nothing to write.");
    return;
  }

  console.error(
    `Writing ${ready.length} conversions. The manifest at ${options.manifestPath} is the source-note backup.`,
  );
  let applied = 0;
  let reset = 0;
  let failed = 0;
  for (const candidate of ready) {
    const logBase = {
      at: new Date().toISOString(),
      noteId: candidate.noteId,
      key: candidate.target.fields["Key"],
      original: candidate.original,
      target: candidate.target,
    };
    try {
      await invoke("updateNoteModel", {
        note: {
          id: candidate.noteId,
          modelName: candidate.target.modelName,
          fields: candidate.target.fields,
          tags: candidate.original.tags,
        },
      });
      const [updated] = await fetchNoteInfos([candidate.noteId], invoke);
      const verification = await preflightCandidate(candidate, updated, [candidate.noteId]);
      if (verification.status !== "already-applied") {
        throw new Error(
          verification.status === "rejected"
            ? `Post-write verification failed: ${verification.error}`
            : "Post-write verification did not observe the target note.",
        );
      }
      if (options.reset) {
        await invoke("forgetCards", { cards: candidate.original.cards });
        ++reset;
      }
      ++applied;
      await appendLog(options.logPath, {
        ...logBase,
        status: options.reset ? "applied-and-reset" : "applied",
      });
      console.error(
        `  Applied${options.reset ? " and reset" : ""} ${candidate.noteId}: ${
          candidate.target.fields["Key"]
        }`,
      );
    } catch (error) {
      ++failed;
      const message = error instanceof Error ? error.message : String(error);
      await appendLog(options.logPath, { ...logBase, status: "failed", error: message });
      console.error(`  Failed ${candidate.noteId}: ${message}`);
    }
  }
  if (options.reset) {
    for (const candidate of alreadyAppliedCandidates) {
      const logBase = {
        at: new Date().toISOString(),
        noteId: candidate.noteId,
        key: candidate.target.fields.Key,
        original: candidate.original,
        target: candidate.target,
      };
      try {
        await invoke("forgetCards", { cards: candidate.original.cards });
        ++reset;
        await appendLog(options.logPath, { ...logBase, status: "already-applied-and-reset" });
        console.error(
          `  Reset already-applied card ${candidate.noteId}: ${candidate.target.fields.Key}`,
        );
      } catch (error) {
        ++failed;
        const message = error instanceof Error ? error.message : String(error);
        await appendLog(options.logPath, { ...logBase, status: "reset-failed", error: message });
        console.error(`  Failed to reset ${candidate.noteId}: ${message}`);
      }
    }
  }
  console.error(
    `Done: ${applied} applied, ${reset} reset, ${failed} failed. Log: ${options.logPath}`,
  );
  if (failed > 0) {
    Deno.exitCode = 1;
  }
}

if (import.meta.main) await main();
