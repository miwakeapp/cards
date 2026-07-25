import { createCard } from "card_creator";
import type { GeneratedCardFields } from "card_field_generation";
import type { JMDictWord } from "data";
import { applyDisplayTargetOverride } from "./display_target.ts";
import { cardSourceFromResolution } from "./source.ts";
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

/**
 * Applies AI-owned decisions only after rebuilding the candidate's renderable fields through
 * `card_creator`.
 *
 * The candidate is mutated only after every generated field passes deterministic validation.
 */
export async function applyGeneratedCardFields(
  candidate: ConversionCandidate,
  entry: JMDictWord,
  fields: GeneratedCardFields,
  model: string,
  generatedAt: string,
): Promise<void> {
  let applicableSenses: number[] = [];
  let hint = candidate.target.fields.Hint;
  let minimizedContext = candidate.target.fields["Minimized context"];
  let senseResolution = candidate.senseResolution;
  let minimizedContextResolution = candidate.minimizedContextResolution;

  if (candidate.senseResolution.status !== "not-needed") {
    applicableSenses = validateApplicableSenses(fields.applicableSenses, entry.sense.length);
    hint = normalizedHint(
      fields.hint,
      candidate.keyRecognitionTarget,
      applicableSenses,
      entry.sense.length,
    );
    senseResolution = { status: "generated", model, generatedAt, applicableSenses };
  }

  if (candidate.minimizedContextResolution.status !== "not-needed") {
    minimizedContext = fields.minimizedContext ?? "";
    minimizedContextResolution = { status: "generated", model, generatedAt };
  }

  const selectedSenses =
    applicableSenses.length === 0 || applicableSenses.length === entry.sense.length
      ? undefined
      : applicableSenses;
  const card = await createCard({
    jmdictEntry: entry,
    recognitionTarget: candidate.keyRecognitionTarget,
    ...(entry.kanji.some(({ text }) => text === candidate.keyRecognitionTarget)
      ? { kanaReading: candidate.readingKana }
      : {}),
    applicableSenseNumbers: selectedSenses,
    hint: hint || undefined,
    fullContext: candidate.target.fields["Full context"],
    minimizedContext: minimizedContext === "" ? undefined : minimizedContext,
    source: cardSourceFromResolution(candidate.sourceResolution),
  });
  const displayTarget = applyDisplayTargetOverride(
    card,
    candidate.keyRecognitionTarget,
    candidate.recognitionTargetOverride,
  );

  candidate.target.fields.Key = card.key;
  candidate.target.fields["Recognition target"] = displayTarget.recognitionTarget;
  candidate.target.fields.Reading = displayTarget.reading ?? "";
  candidate.target.fields.Hint = card.hint ?? "";
  candidate.target.fields["Full context"] = card.fullContext;
  candidate.target.fields["Minimized context"] = card.minimizedContext ?? "";
  candidate.target.fields["Dictionary entry"] = card.dictionaryEntry;
  candidate.target.fields.Source = card.source ?? "";
  candidate.recognitionTarget = displayTarget.recognitionTarget;
  candidate.senseResolution = senseResolution;
  candidate.minimizedContextResolution = minimizedContextResolution;
}
