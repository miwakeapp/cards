import type { EnsureLatestResult } from "data/download";
import type { ModelId } from "card_creator/ai";
import type { ChangeChip, SenseView, Verdict } from "./analyze.ts";
import type { AppliedRecord, DecisionRecord } from "./state.ts";
import type { Suggestion } from "./suggest.ts";

export interface ReviewMeta {
  generatedAt: string;
  query: string;
  dryRun: boolean;
  modelId: ModelId;
  jmdict: EnsureLatestResult;
  scannedCount: number;
  counts: Record<Verdict, number>;
}

export type DecisionDraft = Omit<DecisionRecord, "fingerprint">;

export interface ReviewItem {
  noteId: number;
  verdict: Verdict;
  reason: string;
  detail: string;
  word: string;
  key: string;
  recognitionTarget: string | null;
  jmdictId: string | null;
  hint: string;
  fullContext: string;
  currentEntryHTML: string;
  latestEntryHTML: string | null;
  oldSenseCount: number | null;
  newSenseCount: number | null;
  totalNewSenses: number;
  targetSenseNumbers: number[];
  mappedTargetSenses: number[];
  removedSenses: Array<{ number: number; text: string; wasTargeted: boolean }>;
  proposedKey: string | null;
  needsAI: boolean;
  senseViews: SenseView[];
  changeChips: ChangeChip[];
  suggestion: Suggestion | null;
  decision: DecisionDraft | null;
  applied: Pick<AppliedRecord, "wroteFields"> | null;
  fingerprint: string | undefined;
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
