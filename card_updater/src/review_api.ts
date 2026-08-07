import type { EnsureLatestFuriganaResult, EnsureLatestResult } from "data/download";
import type { ModelId } from "card_field_generation";
import type { ChangeChip, SenseView, Verdict } from "./analyze.ts";
import type { AppliedRecord, DecisionRecord } from "./state.ts";
import type { Suggestion } from "./suggest.ts";

export interface ReviewMeta {
  generatedAt: string;
  query: string;
  ankiConnectURL: string;
  ankiProfile: string;
  limit: number | undefined;
  dryRun: boolean;
  /** Explicit provider model override used for on-demand reruns, if the CLI supplied one. */
  modelOverride?: ModelId;
  /** Actual model-and-effort identities represented by pre-worked suggestions. */
  modelConfigurationIds: string[];
  jmdict: EnsureLatestResult;
  furigana: EnsureLatestFuriganaResult;
  scannedCount: number;
  counts: Record<Verdict, number>;
}

export interface DuplicateNoteContext {
  noteId: number;
  usages: Array<{
    jmdictId: string;
    senseNumbers: number[];
  }>;
}

export interface DuplicateEntryContext {
  jmdictId: string;
  senseCount: number;
  otherCards: Array<{
    noteId: number;
    recognitionTarget: string;
    senseNumbers: number[];
  }>;
}

export type ExceptionContext =
  | {
    kind: "reading-no-match";
    reading: string;
    kanaReading: string;
  }
  | {
    kind: "reading-not-applicable";
    kanaReading: string;
    recognitionTarget: string;
    jmdictId: string;
  }
  | {
    kind: "duplicate-recognition-unit";
    notes: DuplicateNoteContext[];
    entries: DuplicateEntryContext[];
  };

export type DecisionDraft = Omit<DecisionRecord, "fingerprint">;

export interface ReviewItem {
  noteId: number;
  verdict: Verdict;
  reason: string;
  detail: string;
  exceptionContext: ExceptionContext | null;
  word: string;
  key: string;
  hint: string;
  fullContext: string;
  currentEntryHTML: string;
  latestEntryHTML: string | null;
  oldSenseCount: number | null;
  mappedTargetSenses: number[];
  removedSenses: Array<{ number: number; text: string; wasTargeted: boolean }>;
  proposedKey: string | null;
  currentReading: string;
  proposedReading: string | null;
  senseViews: SenseView[];
  changeChips: ChangeChip[];
  suggestion: Suggestion | null;
  decision: DecisionDraft | null;
  applied: Pick<AppliedRecord, "wroteFields"> | null;
}

export interface ReviewPayload {
  meta: ReviewMeta;
  items: ReviewItem[];
}

export interface DecisionUpdate {
  noteId: number;
  record: DecisionDraft | null;
}

export interface ApplyResultPayload {
  noteId: number;
  ok: boolean;
  error?: string;
  wroteFields?: string[];
}
