export const CONVERSION_MANIFEST_VERSION = 7;

export interface AnkiFieldValue {
  value: string;
  order: number;
}

export interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  cards: number[];
  fields: Record<string, AnkiFieldValue>;
}

export interface SourceFieldMapping {
  word: string;
  sentence: string;
  glossary: string | null;
  reading: string | null;
  source: string | null;
  sourceURL: string | null;
}

export interface SourceResolution {
  name: string | null;
  method: "source-field" | "epub" | "none";
  url: string | null;
  urlIsPublic: boolean;
}

export type MinimizedContextResolution =
  | { status: "not-needed" }
  | { status: "pending" }
  | { status: "generated"; model: string; generatedAt: string }
  | { status: "failed"; model: string; attemptedAt: string; error: string };

export type SenseResolution =
  | { status: "not-needed" }
  | { status: "pending" }
  | { status: "generated"; model: string; generatedAt: string; applicableSenses: number[] }
  | { status: "failed"; model: string; attemptedAt: string; error: string };

export type FullContextResolution =
  | { status: "source-unavailable" }
  | { status: "pending"; source: string }
  | { status: "restored"; method: "exact" }
  | { status: "restored"; method: "ai"; model: string; generatedAt: string }
  | { status: "failed"; model: string; attemptedAt: string; error: string };

export interface OriginalNoteSnapshot {
  modelName: string;
  tags: string[];
  cards: number[];
  fields: Record<string, string>;
  fingerprint: string;
}

export interface ConversionCandidate {
  noteId: number;
  /** False for an automatic deferral or a manual hold; omitted by `apply`. */
  approved: boolean;
  jmdictId: string;
  recognitionTarget: string;
  keyRecognitionTarget: string;
  readingKana: string;
  sourceResolution: SourceResolution;
  fullContextResolution: FullContextResolution;
  minimizedContextResolution: MinimizedContextResolution;
  senseResolution: SenseResolution;
  original: OriginalNoteSnapshot;
  target: {
    modelName: string;
    fields: Record<string, string>;
  };
}

export interface SkippedNote {
  noteId: number;
  word: string;
  reason: string;
  detail?: string;
}

export interface ConversionManifest {
  version: typeof CONVERSION_MANIFEST_VERSION;
  /** Fingerprint of the input manifest from which a resumable stage output was created. */
  inputManifestFingerprint?: string;
  generatedAt: string;
  query: string;
  sourceModel: string;
  targetModel: string;
  sourceFields: SourceFieldMapping;
  candidates: ConversionCandidate[];
  skipped: SkippedNote[];
}

export type DeferredReason =
  | "full-context-source-unavailable"
  | "full-context-restoration-failed"
  | "ai-enrichment-failed"
  | "manual-hold";

/** Explains why a prepared candidate must not be applied automatically. */
export function deferredReason(candidate: ConversionCandidate): DeferredReason | null {
  if (candidate.fullContextResolution.status === "source-unavailable") {
    return "full-context-source-unavailable";
  }
  if (candidate.fullContextResolution.status === "failed") {
    return "full-context-restoration-failed";
  }
  if (
    candidate.minimizedContextResolution.status === "failed" ||
    candidate.senseResolution.status === "failed"
  ) {
    return "ai-enrichment-failed";
  }
  return candidate.approved === false ? "manual-hold" : null;
}

/** Defers source-unavailable candidates, including manifests prepared before automatic deferral. */
export function deferUnavailableSourceContexts(manifest: ConversionManifest): number {
  let deferred = 0;
  for (const candidate of manifest.candidates) {
    if (
      candidate.fullContextResolution.status === "source-unavailable" &&
      candidate.approved !== false
    ) {
      candidate.approved = false;
      ++deferred;
    }
  }
  return deferred;
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function noteFieldValues(note: AnkiNoteInfo): Record<string, string> {
  return Object.fromEntries(
    Object.entries(note.fields).map(([name, field]) => [name, field.value]),
  );
}

/** Fingerprints all source data that `updateNoteModel` will replace. */
export async function noteFingerprint(note: {
  modelName: string;
  tags: string[];
  cards: number[];
  fields: Record<string, string>;
}): Promise<string> {
  const canonical = {
    modelName: note.modelName,
    tags: [...note.tags].sort(),
    cards: [...note.cards].sort((left, right) => left - right),
    fields: sortedRecord(note.fields),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function snapshotNote(note: AnkiNoteInfo): Promise<OriginalNoteSnapshot> {
  const snapshot = {
    modelName: note.modelName,
    tags: [...note.tags],
    cards: [...note.cards],
    fields: noteFieldValues(note),
  };
  return { ...snapshot, fingerprint: await noteFingerprint(snapshot) };
}
