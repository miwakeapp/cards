import {
  type AIGeneratedFields,
  formatMiwakeKey,
  normalizeMinimizedContext,
  parseMiwakeKey,
} from "card_creator";
import type { JMDictWord } from "data";
import type { ConversionCandidate } from "./types.ts";

/** Whether a candidate still needs the canonical card-field AI call. */
export function needsCardFieldEnrichment(candidate: ConversionCandidate): boolean {
  return candidate.fullContextResolution.status === "restored" &&
    (!["not-needed", "generated"].includes(candidate.senseResolution.status) ||
      !["not-needed", "generated"].includes(candidate.minimizedContextResolution.status));
}

function validateApplicableSenses(values: number[], senseCount: number): number[] {
  if (
    values.some((value) => !Number.isInteger(value) || value < 1 || value > senseCount) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      `AI returned invalid applicable senses ${JSON.stringify(values)} for ${senseCount} senses.`,
    );
  }
  return [...values].sort((left, right) => left - right);
}

function normalizedHint(
  hint: string | null,
  recognitionTarget: string,
  applicableSenses: number[],
  senseCount: number,
): string {
  const allSensesApply = applicableSenses.length === 0 ||
    applicableSenses.length === senseCount;
  if (allSensesApply || hint === null || !hint.includes(recognitionTarget)) return "";
  return hint;
}

/** Reuses a cached sense selection while applying the candidate's current key spelling. */
export function rekeyCachedKey(
  candidate: ConversionCandidate,
  cachedKey: string,
): string | null {
  const parsed = parseMiwakeKey(cachedKey);
  if (parsed === null || parsed.jmdictId !== candidate.jmdictId) return null;

  const prefix = `${candidate.keyRecognitionTarget} | ${candidate.jmdictId}`;
  return parsed.senseNumbers === null ? prefix : `${prefix} | ${parsed.senseNumbers.join(",")}`;
}

/** Applies only the AI-owned portions of an otherwise deterministic conversion candidate. */
export function applyGeneratedCardFields(
  candidate: ConversionCandidate,
  entry: JMDictWord,
  fields: AIGeneratedFields,
  model: string,
  generatedAt: string,
): void {
  let key = candidate.target.fields.Key;
  let hint = candidate.target.fields.Hint;
  let minimizedContext = candidate.target.fields["Minimized context"];
  let senseResolution = candidate.senseResolution;
  let minimizedContextResolution = candidate.minimizedContextResolution;

  if (candidate.senseResolution.status !== "not-needed") {
    const applicableSenses = validateApplicableSenses(fields.applicableSenses, entry.sense.length);
    key = formatMiwakeKey(
      candidate.keyRecognitionTarget,
      candidate.jmdictId,
      applicableSenses,
      entry.sense.length,
    );
    hint = normalizedHint(
      fields.hint,
      candidate.recognitionTarget,
      applicableSenses,
      entry.sense.length,
    );
    senseResolution = { status: "generated", model, generatedAt, applicableSenses };
  }

  if (candidate.minimizedContextResolution.status !== "not-needed") {
    const normalized = normalizeMinimizedContext(
      candidate.target.fields["Full context"],
      fields.minimizedContext,
    );
    if (normalized !== null && !normalized.includes("<mark>")) {
      throw new Error("AI minimized context does not contain a <mark> target.");
    }
    minimizedContext = normalized ?? "";
    minimizedContextResolution = { status: "generated", model, generatedAt };
  }

  candidate.target.fields.Key = key;
  candidate.target.fields.Hint = hint;
  candidate.target.fields["Minimized context"] = minimizedContext;
  candidate.senseResolution = senseResolution;
  candidate.minimizedContextResolution = minimizedContextResolution;
}
