import { createCard } from "card_creator";
import {
  compatibleSenseNumbersForJMDictUsage,
  jmdictAlternativesForCardFront,
  jmdictUsagesForSpelling,
} from "card_creator/jmdict";
import type { HintGenerationOutcome, SenseSelectionOutcome } from "card_field_generation";
import type { JMDictWord } from "data";
import { cardCreatorInputForAcceptedReadings } from "./card_creator_input.ts";
import { applyDisplayTargetOverride, disambiguationHintForJMDictUsage } from "./display_target.ts";
import { cardSourceFromResolution } from "./source.ts";
import {
  type ConversionCandidate,
  minimizedContextNeedsGeneration,
  senseResolutionIsComplete,
  senseResolutionNeedsGeneration,
} from "./types.ts";

export interface CandidateGeneratedFields {
  /** Present only when this enrichment run was responsible for sense selection. */
  senseSelection?: SenseSelectionOutcome;
  /**
   * Explicit hint disposition for a generated sense selection.
   *
   * `null` means the deterministic front-side ambiguity check found no contrasting usage, while
   * `not-needed` and `source-insufficient` are successful unhinted outcomes from hint generation.
   * Keeping those states distinct prevents a validated unhinted result from looking like omitted
   * model output.
   */
  hintOutcome?: HintGenerationOutcome | null;
  /** Present only when this enrichment run was also responsible for context minimization. */
  minimizedContext?: string | null;
}

export interface CandidateGeneratedFieldProvenance {
  /** Model-and-effort identities used by sense selection and any required hint generation. */
  senseSelection?: string;
  /** Model-and-effort identity used by context minimization. */
  minimizedContext?: string;
}

/** Whether a candidate still needs one or more focused card-field operations. */
export function needsCardFieldEnrichment(candidate: ConversionCandidate): boolean {
  if (
    candidate.senseResolution.status === "no-match" ||
    candidate.senseResolution.status === "ambiguous"
  ) {
    return false;
  }
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
      `AI returned card senses ${JSON.stringify(values)}; expected unique integers from ` +
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
  sameSpellingEntries: readonly JMDictWord[],
  fields: CandidateGeneratedFields,
  provenance: CandidateGeneratedFieldProvenance,
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

  const hasSenseResult = fields.senseSelection !== undefined ||
    provenance.senseSelection !== undefined;
  if (senseResolutionNeedsGeneration(candidate.senseResolution) && hasSenseResult) {
    if (provenance.senseSelection === undefined) {
      throw new Error("Generated sense fields are missing their model configuration provenance.");
    }
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
    if (fields.senseSelection === undefined) {
      throw new Error("AI result is missing senseSelection for a candidate that requires it.");
    }
    if (fields.senseSelection.outcome === "no-match") {
      if (fields.hintOutcome !== null) {
        throw new Error("A no-match sense selection must have a null hintOutcome.");
      }
      senseResolution = {
        status: "no-match",
        model: provenance.senseSelection,
        generatedAt,
        compatibleSenses,
      };
    } else {
      const selectedOrPossible = fields.senseSelection.outcome === "ambiguous"
        ? fields.senseSelection.possibleSenseNumbers
        : fields.senseSelection.senseNumbers;
      const validated = validateApplicableSenses([...selectedOrPossible], compatibleSenses);
      if (fields.senseSelection.outcome === "ambiguous") {
        if (fields.hintOutcome !== null) {
          throw new Error("An ambiguous sense selection must have a null hintOutcome.");
        }
        if (selectedOrPossible.length === 0) {
          throw new Error("AI returned an ambiguous sense selection without any possible senses.");
        }
        senseResolution = {
          status: "ambiguous",
          model: provenance.senseSelection,
          generatedAt,
          compatibleSenses,
          possibleSenses: validated.length === 0 ? [...compatibleSenses] : validated,
        };
      } else {
        applicableSenses = validated;
        if (!Object.hasOwn(fields, "hintOutcome") || fields.hintOutcome === undefined) {
          throw new Error("AI result is missing hintOutcome for its selected sense usage.");
        }
        // `[]` is the card key's canonical representation of selecting every compatible sense;
        // the front-side ambiguity check needs the concrete selected sense numbers.
        const selectedSenseNumbers = applicableSenses.length === 0
          ? compatibleSenses
          : applicableSenses;
        const contrastingUsages = jmdictAlternativesForCardFront(
          { entry, senseNumbers: selectedSenseNumbers },
          jmdictUsagesForSpelling(sameSpellingEntries, candidate.keyRecognitionTarget),
        );
        if (contrastingUsages.length === 0 && fields.hintOutcome !== null) {
          throw new Error(
            "AI returned a hintOutcome even though the selected usage has no front-side contrast.",
          );
        }
        if (contrastingUsages.length > 0 && fields.hintOutcome === null) {
          throw new Error("The validated AI sense selection is missing its hint outcome.");
        }
        hint = fields.hintOutcome?.outcome === "generated" ? fields.hintOutcome.hint : "";
        // Selecting every reading-compatible sense removes the sense suffix from the key, but it
        // does not prove that the front spelling is globally unambiguous. A generated hint may be
        // distinguishing another same-spelling entry or a sense reachable through another reading.
        senseResolution = {
          status: "generated",
          model: provenance.senseSelection,
          generatedAt,
          compatibleSenses,
          applicableSenses,
        };
      }
    }
  }

  const hasMinimizedContextResult = Object.hasOwn(fields, "minimizedContext") ||
    provenance.minimizedContext !== undefined;
  if (
    minimizedContextNeedsGeneration(candidate.minimizedContextResolution) &&
    hasMinimizedContextResult
  ) {
    if (provenance.minimizedContext === undefined) {
      throw new Error(
        "Generated minimized context is missing its model configuration provenance.",
      );
    }
    if (!("minimizedContext" in fields)) {
      throw new Error("AI result is missing minimizedContext for a candidate that requires it.");
    }
    minimizedContext = fields.minimizedContext ?? "";
    minimizedContextResolution = {
      status: "generated",
      model: provenance.minimizedContext,
      generatedAt,
    };
  }

  if (senseResolution.status === "no-match" || senseResolution.status === "ambiguous") {
    candidate.target.fields["Minimized context"] = minimizedContext;
    candidate.senseResolution = senseResolution;
    candidate.minimizedContextResolution = minimizedContextResolution;
    return;
  }

  const selectedSenses = applicableSenses.length === 0 ? undefined : applicableSenses;
  const additionalAcceptedReadings = (candidate.additionalAcceptedReadings ?? []).map(
    (additional) => {
      const additionalEntry = sameSpellingEntries.find(({ id }) => id === additional.jmdictId);
      if (additionalEntry === undefined) {
        throw new Error(
          `Candidate additional accepted reading refers to missing same-spelling JMDict entry ${
            JSON.stringify(additional.jmdictId)
          }.`,
        );
      }
      return {
        entry: additionalEntry,
        kanaReading: additional.kanaReading,
        applicableSenseNumbers: additional.jmdictId === entry.id
          ? selectedSenses ?? compatibleSenseNumbersForJMDictUsage(
            entry,
            candidate.keyRecognitionTarget,
            candidate.readingKana,
          )
          : additional.applicableSenseNumbers,
      };
    },
  );
  const usesReadingField = entry.kanji.some(({ text }) => text === candidate.keyRecognitionTarget);
  const cardCreatorJMDictInput = usesReadingField
    ? cardCreatorInputForAcceptedReadings([{
      entry,
      kanaReading: candidate.readingKana,
      applicableSenseNumbers: selectedSenses ?? compatibleSenseNumbersForJMDictUsage(
        entry,
        candidate.keyRecognitionTarget,
        candidate.readingKana,
      ),
    }, ...additionalAcceptedReadings])
    : {
      jmdictUsages: [{
        entry,
        ...(selectedSenses === undefined ? {} : { applicableSenseNumbers: selectedSenses }),
      }] as const,
    };
  const card = await createCard({
    ...cardCreatorJMDictInput,
    recognitionTarget: candidate.keyRecognitionTarget,
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
  candidate.target.fields.Hint = candidate.jmdictEntryResolution === undefined
    ? disambiguationHintForJMDictUsage(
      card.hint ?? undefined,
      displayTarget.recognitionTarget,
      candidate.keyRecognitionTarget,
      entry,
      selectedSenses ?? compatibleSenseNumbersForJMDictUsage(
        entry,
        candidate.keyRecognitionTarget,
        entry.kanji.some(({ text }) => text === candidate.keyRecognitionTarget)
          ? candidate.readingKana
          : undefined,
      ),
      sameSpellingEntries,
    ) ?? ""
    : card.hint ?? "";
  candidate.target.fields["Full context"] = card.fullContext;
  candidate.target.fields["Minimized context"] = card.minimizedContext ?? "";
  candidate.target.fields["Dictionary"] = card.dictionary;
  candidate.target.fields.Source = card.source ?? "";
  candidate.recognitionTarget = displayTarget.recognitionTarget;
  if (candidate.additionalAcceptedReadings !== undefined) {
    candidate.additionalAcceptedReadings = additionalAcceptedReadings.map((additional) => ({
      jmdictId: additional.entry.id,
      kanaReading: additional.kanaReading,
      applicableSenseNumbers: [...additional.applicableSenseNumbers],
    }));
  }
  candidate.senseResolution = senseResolution;
  candidate.minimizedContextResolution = minimizedContextResolution;
}
