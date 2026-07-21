import {
  type AnkiNoteInfo,
  type ConversionCandidate,
  noteFieldValues,
  noteFingerprint,
} from "./types.ts";

export type PreflightResult =
  | { status: "ready" | "already-applied"; error?: never }
  | { status: "rejected"; error: string };

function recordsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function arraysEqual<T>(left: T[], right: T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isAppliedCandidate(
  candidate: ConversionCandidate,
  current: AnkiNoteInfo,
): boolean {
  return current.modelName === candidate.target.modelName &&
    recordsEqual(noteFieldValues(current), candidate.target.fields) &&
    arraysEqual([...current.tags].sort(), [...candidate.original.tags].sort()) &&
    arraysEqual(
      [...current.cards].sort((left, right) => left - right),
      [...candidate.original.cards].sort((left, right) => left - right),
    );
}

/** Checks idempotency, duplicate keys, and source-note freshness before a destructive model swap. */
export async function preflightCandidate(
  candidate: ConversionCandidate,
  current: AnkiNoteInfo | undefined,
  targetNoteIdsWithKey: number[],
): Promise<PreflightResult> {
  if (current === undefined || !current.noteId) {
    return { status: "rejected", error: "Note no longer exists." };
  }
  if (isAppliedCandidate(candidate, current)) {
    return { status: "already-applied" };
  }
  if (current.modelName !== candidate.original.modelName) {
    return {
      status: "rejected",
      error: `Expected model ${candidate.original.modelName}, found ${current.modelName}.`,
    };
  }

  const currentFingerprint = await noteFingerprint({
    modelName: current.modelName,
    tags: current.tags,
    cards: current.cards,
    fields: noteFieldValues(current),
  });
  if (currentFingerprint !== candidate.original.fingerprint) {
    return {
      status: "rejected",
      error: "Note changed after the manifest was prepared. Prepare a fresh manifest.",
    };
  }

  const conflictingIds = targetNoteIdsWithKey.filter((noteId) => noteId !== candidate.noteId);
  if (conflictingIds.length > 0) {
    return {
      status: "rejected",
      error: `Miwake Card key is already used or claimed by note(s) ${conflictingIds.join(", ")}.`,
    };
  }
  return { status: "ready" };
}
