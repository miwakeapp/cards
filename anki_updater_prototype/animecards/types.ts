export const CONVERSION_MANIFEST_VERSION = 14;

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

/** Whether minimized-context generation still needs an AI result, including a retry after failure. */
export function minimizedContextNeedsGeneration(
  resolution: MinimizedContextResolution,
): resolution is Extract<MinimizedContextResolution, { status: "pending" | "failed" }> {
  return resolution.status === "pending" || resolution.status === "failed";
}

export type SenseResolution =
  | { status: "not-needed" }
  | { status: "determined"; applicableSenses: number[] }
  | { status: "pending"; compatibleSenses: number[] }
  | {
    status: "generated";
    model: string;
    generatedAt: string;
    compatibleSenses: number[];
    applicableSenses: number[];
  }
  | {
    status: "no-match";
    model: string;
    generatedAt: string;
    compatibleSenses: number[];
  }
  | {
    status: "failed";
    model: string;
    attemptedAt: string;
    error: string;
    compatibleSenses: number[];
  };

/** Whether a candidate's JMDict senses are final and safe to render or apply. */
export function senseResolutionIsComplete(resolution: SenseResolution): boolean {
  return ["not-needed", "determined", "generated"].includes(resolution.status);
}

/** Whether sense selection still needs an AI result, including a retry after failure. */
export function senseResolutionNeedsGeneration(
  resolution: SenseResolution,
): resolution is Extract<SenseResolution, { status: "pending" | "failed" }> {
  return resolution.status === "pending" || resolution.status === "failed";
}

interface FullContextSelectionInput {
  /** EPUB source containing the required context. */
  source: string;
  /**
   * Source-faithful structural lower bound for AI selection, including restored ruby and any
   * sentence or dialogue completion required before semantic judgment.
   */
  requiredContextHTML: string;
}

export type FullContextResolution =
  | { status: "source-unavailable" }
  | ({ status: "pending" } & FullContextSelectionInput)
  | { status: "restored"; method: "original" }
  | { status: "restored"; method: "exact" }
  | { status: "restored"; method: "deterministic" }
  | { status: "restored"; method: "ai"; model: string; generatedAt: string }
  | ({
    status: "failed";
    model: string;
    attemptedAt: string;
    error: string;
  } & FullContextSelectionInput);

export type TargetInContextResolution =
  | { method: "deterministic"; surface: string; additionalSurfaces?: string[] }
  | { method: "ai"; surface: string; model: string; generatedAt: string };

export interface OriginalNoteSnapshot {
  modelName: string;
  tags: string[];
  cards: number[];
  fields: Record<string, string>;
  fingerprint: string;
}

export interface JMDictEntryResolution {
  model: string;
  generatedAt: string;
  /** Original sense numbers selected within the chosen entry; retained for deterministic replay. */
  applicableSenseNumbers: number[];
  /** Canonically validated hint, or `null` when final `～` notation makes it redundant. */
  hint: string | null;
  /** All same-spelling entries shown to the model as contrastive evidence. */
  candidateJMDictIds: string[];
  /** Entries that the Animecard's glossary permitted the model to select. */
  allowedJMDictIds: string[];
}

export interface ConversionCandidate {
  noteId: number;
  /** False for an automatic deferral or a manual hold; omitted by `apply`. */
  approved: boolean;
  jmdictId: string;
  /** Current rendered display target, including automatic or user-edited `～` notation. */
  recognitionTarget: string;
  /** Exact undecorated JMDict spelling used in the key and passed to Card Creator. */
  keyRecognitionTarget: string;
  /** Explicit notation retained from the source Animecard, if any. */
  recognitionTargetOverride?: string;
  readingKana: string;
  /**
   * Plain-text evidence supplied to sense-selection AI.
   *
   * This can include neighboring source paragraphs that are useful for interpretation but must
   * never be rendered as the card's `Full context`.
   */
  senseSelectionContext: string;
  sourceResolution: SourceResolution;
  targetInContextResolution: TargetInContextResolution;
  fullContextResolution: FullContextResolution;
  minimizedContextResolution: MinimizedContextResolution;
  senseResolution: SenseResolution;
  /** Present when AI selected or verified the JMDict entry. */
  jmdictEntryResolution?: JMDictEntryResolution;
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
  entrySelection?: {
    model: string;
    recognitionTarget: string;
    context: string;
    candidateJMDictIds: string[];
    allowedJMDictIds: string[];
    /** Compact English gloss summaries keyed by candidate entry ID. */
    candidateDescriptions: Record<string, string>;
  };
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
  | "no-applicable-jmdict-sense"
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
  if (candidate.senseResolution.status === "no-match") {
    return "no-applicable-jmdict-sense";
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
