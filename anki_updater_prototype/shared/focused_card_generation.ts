import {
  generateSourceGroundedHint,
  type GenerationOptions,
  type HintGenerationOutcome,
  selectSensesForCard,
  type SenseSelectionInput,
  type SenseSelectionOutcome,
} from "card_field_generation";
import { jmdictAlternativesForCardFront, type JMDictSpellingUsage } from "card_creator";

/** Complete deterministic input for selecting one usage and deciding whether its front needs a hint. */
export interface SenseAndHintInput {
  /** Reading- and spelling-compatible senses among which the encounter must select. */
  senseSelection: SenseSelectionInput;

  /**
   * Every usage reachable from the exact undecorated spelling shown on the card front.
   *
   * This must include the selected entry plus same-spelling entries and senses available only
   * through another reading. Callers should obtain it with `jmdictUsagesForSpelling()` over an
   * exhaustive same-spelling entry set. The broader list is essential because the Reading field
   * is on the back and therefore cannot disambiguate recognition.
   */
  frontSideUsages: readonly JMDictSpellingUsage[];
}

export interface SenseAndHintResolution {
  /** Semantic disposition of the marked usage, including an explicit ambiguous result. */
  senseSelection: SenseSelectionOutcome;

  /**
   * Present whenever at least one other semantic usage is reachable from the card front.
   *
   * `not-needed` means no semantic distinction is useful, while `source-insufficient` records that
   * a distinction exists but the encounter cannot support a fair cue. Both deliberately produce
   * an unhinted card rather than a fabricated Hint.
   */
  hintOutcome: HintGenerationOutcome | null;

  /** Actual model-and-effort identities used by sense selection and, when needed, hinting. */
  modelConfigurationIds: string[];
}

export interface SenseAndHintDependencies {
  selectSenses?: typeof selectSensesForCard;
  generateHint?: typeof generateSourceGroundedHint;
}

/**
 * Selects the senses that belong on one card, then asks for a source-grounded hint whenever another
 * usage is reachable from the exact spelling shown on the card front.
 *
 * This is orchestration rather than a second prompt boundary: both steps remain independently
 * validated and content-addressably cached by `card_field_generation`.
 */
export async function selectSensesAndMaybeGenerateHint(
  input: SenseAndHintInput,
  options: GenerationOptions,
  {
    selectSenses = selectSensesForCard,
    generateHint = generateSourceGroundedHint,
  }: SenseAndHintDependencies = {},
): Promise<SenseAndHintResolution> {
  const senseInput = input.senseSelection;
  // This call is also the public validator for the complete card-front usage set. Preflight it
  // before sense selection so malformed acquisition scaffolding cannot incur a provider charge.
  jmdictAlternativesForCardFront(
    {
      entry: senseInput.jmdictEntry,
      senseNumbers: senseInput.compatibleSenseNumbers,
    },
    input.frontSideUsages,
  );
  const senseResult = await selectSenses(senseInput, options);
  const modelConfigurationIds = [senseResult.metadata.modelConfigurationId];
  const selection = senseResult.value;
  if (selection.outcome !== "selected") {
    return {
      senseSelection: selection,
      hintOutcome: null,
      modelConfigurationIds,
    };
  }

  const selectedSenseNumbers = selection.senseNumbers;
  const contrastingUsages = jmdictAlternativesForCardFront(
    { entry: senseInput.jmdictEntry, senseNumbers: selectedSenseNumbers },
    input.frontSideUsages,
  );
  if (contrastingUsages.length === 0) {
    return {
      senseSelection: selection,
      hintOutcome: null,
      modelConfigurationIds,
    };
  }

  const hintResult = await generateHint({
    context: senseInput.context,
    recognitionTarget: senseInput.recognitionTarget,
    selectedUsage: {
      entry: senseInput.jmdictEntry,
      senseNumbers: selectedSenseNumbers,
    },
    contrastingUsages,
  }, options);
  return {
    senseSelection: selection,
    hintOutcome: hintResult.value,
    modelConfigurationIds: [
      ...new Set([...modelConfigurationIds, hintResult.metadata.modelConfigurationId]),
    ],
  };
}
