import { compatibleSenseNumbersForJMDictUsage, createCard } from "card_creator";
import type { GeneratedCardFields, GeneratedSenseAndHint } from "card_field_generation";
import type { JMDictWord } from "data";
import { applyDisplayTargetOverride } from "./display_target.ts";
import { cardSourceFromResolution } from "./source.ts";
import {
  type ConversionCandidate,
  minimizedContextNeedsGeneration,
  senseResolutionIsComplete,
  senseResolutionNeedsGeneration,
} from "./types.ts";

type CandidateGeneratedFields =
  | GeneratedCardFields
  | (GeneratedSenseAndHint & Partial<Pick<GeneratedCardFields, "minimizedContext">>);

/** Whether a candidate still needs the canonical card-field AI call. */
export function needsCardFieldEnrichment(candidate: ConversionCandidate): boolean {
  if (candidate.senseResolution.status === "no-match") return false;
  return candidate.fullContextResolution.status === "restored" &&
    (!senseResolutionIsComplete(candidate.senseResolution) ||
      minimizedContextNeedsGeneration(candidate.minimizedContextResolution));
}

function validateApplicableSenses(values: number[], compatibleSenses: number[]): number[] {
  if (
    values.some((value) => !Number.isInteger(value) || !compatibleSenses.includes(value)) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      `AI returned applicable senses ${JSON.stringify(values)}; expected unique integers from ` +
        `the JMDict-compatible senses ${JSON.stringify(compatibleSenses)}.`,
    );
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === compatibleSenses.length &&
      sorted.every((value, index) => value === compatibleSenses[index])
    ? []
    : sorted;
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
  fields: CandidateGeneratedFields,
  model: string,
  generatedAt: string,
): Promise<void> {
  let applicableSenses = candidate.senseResolution.status === "determined" ||
      candidate.senseResolution.status === "generated"
    ? candidate.senseResolution.applicableSenses
    : [];
  let hint = candidate.target.fields.Hint;
  let minimizedContext = candidate.target.fields["Minimized context"];
  let senseResolution = candidate.senseResolution;
  let minimizedContextResolution = candidate.minimizedContextResolution;

  if (senseResolutionNeedsGeneration(candidate.senseResolution)) {
    const compatibleSenses = compatibleSenseNumbersForJMDictUsage(
      entry,
      candidate.keyRecognitionTarget,
      entry.kanji.some(({ text }) => text === candidate.keyRecognitionTarget)
        ? candidate.readingKana
        : undefined,
    );
    if (
      JSON.stringify(candidate.senseResolution.compatibleSenses) !==
        JSON.stringify(compatibleSenses)
    ) {
      throw new Error(
        `Candidate records JMDict-compatible senses ${
          JSON.stringify(candidate.senseResolution.compatibleSenses)
        }, but the selected spelling and reading now permit ${JSON.stringify(compatibleSenses)}.`,
      );
    }
    if (fields.applicableSenses === null) {
      candidate.senseResolution = {
        status: "no-match",
        model,
        generatedAt,
        compatibleSenses,
      };
      return;
    }
    applicableSenses = validateApplicableSenses(fields.applicableSenses, compatibleSenses);
    if (applicableSenses.length === 0) {
      hint = "";
    } else {
      if (fields.hint === null) {
        throw new Error("The validated AI sense selection is missing its hint.");
      }
      hint = fields.hint;
    }
    senseResolution = {
      status: "generated",
      model,
      generatedAt,
      compatibleSenses,
      applicableSenses,
    };
  }

  if (minimizedContextNeedsGeneration(candidate.minimizedContextResolution)) {
    if (!("minimizedContext" in fields)) {
      throw new Error("AI result is missing minimizedContext for a candidate that requires it.");
    }
    minimizedContext = fields.minimizedContext ?? "";
    minimizedContextResolution = { status: "generated", model, generatedAt };
  }

  const selectedSenses = applicableSenses.length === 0 ? undefined : applicableSenses;
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
