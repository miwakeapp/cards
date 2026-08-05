import {
  addGenerationUsage,
  EMPTY_GENERATION_USAGE,
  type SenseSelectionOutcome,
} from "card_field_generation";
import type {
  ContextMinimizationFixture,
  ContextMinimizationReferenceDisposition,
  ContextMinimizationScore,
  EvalCaseResult,
  EvalFixture,
  EvalReferenceBasis,
  EvalReferenceBasisCohorts,
  EvalScore,
  EvalSummary,
  EvalValue,
  HintFixture,
  HintScore,
  ReadingSelectionFixture,
  ReadingSelectionScore,
  SenseSelectionFixture,
  SenseSelectionScore,
} from "./types.ts";
import { estimateUSDCost } from "./pricing.ts";

function referenceBasisCohorts<T>(
  create: (referenceBasis: EvalReferenceBasis) => T,
): EvalReferenceBasisCohorts<T> {
  return {
    userReviewed: create("user-reviewed"),
    agentReviewed: create("agent-reviewed"),
    corpusReplay: create("corpus-replay"),
    provisional: create("provisional"),
  };
}

function isHintOutcome(
  value: EvalValue,
): value is Extract<EvalValue, { outcome: "generated" | "not-needed" | "source-insufficient" }> {
  return typeof value === "object" && value !== null && "outcome" in value &&
    ["generated", "not-needed", "source-insufficient"].includes(value.outcome);
}

function isSenseSelectionOutcome(value: EvalValue): value is SenseSelectionOutcome {
  return typeof value === "object" && value !== null && "outcome" in value &&
    ["ambiguous", "no-match", "selected"].includes(value.outcome);
}

function canonicalSenseOutcome(
  value: SenseSelectionOutcome,
): string {
  if (value.outcome === "no-match") return value.outcome;
  const senseNumbers = value.outcome === "selected"
    ? value.senseNumbers
    : value.possibleSenseNumbers;
  return `${value.outcome}:${
    JSON.stringify([...senseNumbers].sort((left, right) => left - right))
  }`;
}

/** Scores an enumerable sense-resolution outcome against its tracked reference. */
export function scoreSenseSelection(
  fixture: SenseSelectionFixture,
  value: EvalValue,
): SenseSelectionScore {
  return {
    kind: "sense-selection",
    exactMatch: isSenseSelectionOutcome(value) &&
      canonicalSenseOutcome(value) === canonicalSenseOutcome(fixture.expected.outcome),
  };
}

/** Scores exact include/omit decisions while leaving free-form rationales qualitative. */
export function scoreReadingSelection(
  fixture: ReadingSelectionFixture,
  value: EvalValue,
): ReadingSelectionScore {
  const actual = typeof value === "object" && value !== null && "decisions" in value
    ? value.decisions.map(({ kanaReading, decision }) => ({ kanaReading, decision }))
    : undefined;
  const expected = fixture.expected.decisions.map(({ kanaReading, decision }) => ({
    kanaReading,
    decision,
  }));
  return {
    kind: "reading-selection",
    exactMatch: JSON.stringify(actual) === JSON.stringify(expected),
  };
}

/** Classifies a hint against examples without treating a novel answer as automatically wrong. */
export function scoreHint(fixture: HintFixture, value: EvalValue): HintScore {
  const outcome = isHintOutcome(value) ? value : undefined;
  const hint = outcome?.outcome === "generated" ? outcome.hint : null;
  const hintCharacterCount = hint === null ? null : [...hint].length;
  const hintLengthDelta = hintCharacterCount === null
    ? null
    : hintCharacterCount - [...fixture.input.recognitionTarget].length;
  const dispositionMatchesReference = outcome?.outcome === fixture.expected.disposition;
  const preferredExactMatch = hint !== null &&
    fixture.expected.preferredHints.includes(hint);
  const acceptableExactMatch = hint !== null &&
    fixture.expected.acceptableHints.includes(hint);
  const observedBadExactMatch = hint !== null &&
    fixture.expected.observedBadHints.includes(hint);
  const disposition = !dispositionMatchesReference
    ? "reference-disposition-mismatch"
    : outcome?.outcome === "not-needed"
    ? "not-needed"
    : outcome?.outcome === "source-insufficient"
    ? "source-insufficient"
    : preferredExactMatch
    ? "preferred"
    : acceptableExactMatch
    ? "acceptable"
    : observedBadExactMatch
    ? "known-bad"
    : "novel";
  return {
    kind: "hint",
    disposition,
    dispositionMatchesReference,
    preferredExactMatch,
    acceptableExactMatch,
    observedBadExactMatch,
    hintCharacterCount,
    hintLengthDelta,
  };
}

/** Scores the exact null/text decision while treating curated text as non-exhaustive evidence. */
export function scoreContextMinimization(
  fixture: ContextMinimizationFixture,
  value: EvalValue,
): ContextMinimizationScore {
  const minimizedContext = typeof value === "string" ? value : null;
  const acceptableExactMatch = minimizedContext !== null &&
    fixture.expected.acceptableMinimizedContexts.includes(minimizedContext);
  const observedBadExactMatch = minimizedContext !== null &&
    fixture.expected.observedBadMinimizedContexts.includes(minimizedContext);
  const expectsMinimization = fixture.expected.disposition === "minimize";
  const disposition = observedBadExactMatch
    ? "known-bad"
    : expectsMinimization
    ? minimizedContext === null
      ? "missing"
      : acceptableExactMatch
      ? "acceptable-reference"
      : "novel"
    : minimizedContext === null
    ? "keep-full-context"
    : "unnecessary";
  return {
    kind: "context-minimization",
    disposition,
    dispositionCorrect: expectsMinimization === (minimizedContext !== null),
    acceptableExactMatch,
    observedBadExactMatch,
  };
}

/** Applies the appropriate reference checks to a package-validated result. */
export function scoreEvalValue(
  fixture: EvalFixture,
  value: EvalValue,
): EvalScore {
  if (fixture.operation === "context-minimization") {
    return scoreContextMinimization(fixture, value);
  }
  if (fixture.operation === "hint") return scoreHint(fixture, value);
  if (fixture.operation === "reading-selection") return scoreReadingSelection(fixture, value);
  return scoreSenseSelection(fixture, value);
}

/** Aggregates telemetry, cost at `pricingEffectiveDate`, and basis-specific reference scores. */
export function summarizeResults(
  results: readonly EvalCaseResult[],
  pricingEffectiveDate = new Date(),
): EvalSummary[] {
  const groups = new Map<string, EvalCaseResult[]>();
  for (const result of results) {
    const key = `${result.modelId}\0${result.reasoningEffort}\0${result.operation}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const successes = group.filter((result) => result.status === "success");
    const isNonPromptOverlap = (result: EvalCaseResult): boolean =>
      !result.fixtureEvaluation.promptOverlap;
    const usage = group.reduce(
      (total, result) => addGenerationUsage(total, result.usage),
      { ...EMPTY_GENERATION_USAGE },
    );
    const summary: EvalSummary = {
      operation: first.operation,
      modelId: first.modelId,
      reasoningEffort: first.reasoningEffort,
      caseCount: group.length,
      nonPromptOverlapCaseCount: group.filter(isNonPromptOverlap).length,
      promptOverlapCaseCount: group.filter((result) => result.fixtureEvaluation.promptOverlap)
        .length,
      successCount: successes.length,
      errorCount: group.length - successes.length,
      cacheHitCount: successes.filter((result) => result.generation.cacheStatus === "hit")
        .length,
      providerAttemptCount: group.reduce(
        (total, result) => total + result.attempts.length,
        0,
      ),
      retryCount: group.reduce(
        (total, result) => total + Math.max(0, result.attempts.length - 1),
        0,
      ),
      latencyMilliseconds: group.reduce(
        (total, result) => total + result.latencyMilliseconds,
        0,
      ),
      usage,
      estimatedCostUSD: estimateUSDCost(first.modelId, usage, pricingEffectiveDate),
    };
    if (first.operation === "sense-selection" || first.operation === "reading-selection") {
      const exactSelectionMatches = (
        subset: readonly typeof successes[number][],
      ) =>
        subset.filter((result) =>
          (result.score.kind === "sense-selection" ||
            result.score.kind === "reading-selection") &&
          result.score.kind === first.operation && result.score.exactMatch
        ).length;
      const selectionSummary = {
        cohorts: referenceBasisCohorts((referenceBasis) => {
          const cases = group.filter((result) =>
            isNonPromptOverlap(result) &&
            result.fixtureEvaluation.referenceBasis === referenceBasis
          );
          const cohortSuccesses = successes.filter((result) =>
            isNonPromptOverlap(result) &&
            result.fixtureEvaluation.referenceBasis === referenceBasis
          );
          return {
            caseCount: cases.length,
            exactMatchCount: exactSelectionMatches(cohortSuccesses),
          };
        }),
      };
      if (first.operation === "sense-selection") {
        summary.senseSelection = selectionSummary;
      } else {
        summary.readingSelection = selectionSummary;
      }
    } else if (first.operation === "hint") {
      const count = (
        subset: readonly typeof successes[number][],
        disposition: HintScore["disposition"],
      ) =>
        subset.filter((result) =>
          result.score.kind === "hint" &&
          result.score.disposition === disposition
        ).length;
      const cohort = (referenceBasis: EvalReferenceBasis) => {
        const cases = group.filter((result) =>
          isNonPromptOverlap(result) &&
          result.fixtureEvaluation.referenceBasis === referenceBasis
        );
        const cohortSuccesses = successes.filter((result) =>
          isNonPromptOverlap(result) &&
          result.fixtureEvaluation.referenceBasis === referenceBasis
        );
        return {
          caseCount: cases.length,
          referenceDispositionAgreementCount: cohortSuccesses.filter((result) =>
            result.score.kind === "hint" && result.score.dispositionMatchesReference
          ).length,
          preferredCount: count(cohortSuccesses, "preferred"),
          acceptableCount: count(cohortSuccesses, "acceptable"),
          knownBadCount: count(cohortSuccesses, "known-bad"),
          novelCount: count(cohortSuccesses, "novel"),
          notNeededCount: count(cohortSuccesses, "not-needed"),
          sourceInsufficientCount: count(cohortSuccesses, "source-insufficient"),
          referenceDispositionMismatchCount: count(
            cohortSuccesses,
            "reference-disposition-mismatch",
          ),
          overSixHintLengthDeltaCount: cohortSuccesses.filter((result) =>
            result.score.kind === "hint" &&
            result.score.hintLengthDelta !== null &&
            result.score.hintLengthDelta > 6
          ).length,
          overTwelveHintLengthDeltaCount: cohortSuccesses.filter((result) =>
            result.score.kind === "hint" &&
            result.score.hintLengthDelta !== null &&
            result.score.hintLengthDelta > 12
          ).length,
        };
      };
      summary.hint = {
        cohorts: referenceBasisCohorts(cohort),
      };
    } else {
      const count = (
        subset: readonly typeof successes[number][],
        disposition: ContextMinimizationReferenceDisposition,
      ) =>
        subset.filter((result) =>
          result.score.kind === "context-minimization" &&
          result.score.disposition === disposition
        ).length;
      const correct = (subset: readonly typeof successes[number][]) =>
        subset.filter((result) =>
          result.score.kind === "context-minimization" &&
          result.score.dispositionCorrect
        ).length;
      const exact = (subset: readonly typeof successes[number][]) =>
        subset.filter((result) =>
          result.score.kind === "context-minimization" &&
          result.score.acceptableExactMatch
        ).length;
      const cohort = (referenceBasis: EvalReferenceBasis) => {
        const cases = group.filter((result) =>
          isNonPromptOverlap(result) &&
          result.fixtureEvaluation.referenceBasis === referenceBasis
        );
        const cohortSuccesses = successes.filter((result) =>
          isNonPromptOverlap(result) &&
          result.fixtureEvaluation.referenceBasis === referenceBasis
        );
        return {
          caseCount: cases.length,
          dispositionCorrectCount: correct(cohortSuccesses),
          acceptableExactMatchCount: exact(cohortSuccesses),
          knownBadCount: count(cohortSuccesses, "known-bad"),
          keepFullContextCount: count(cohortSuccesses, "keep-full-context"),
          novelCount: count(cohortSuccesses, "novel"),
          missingCount: count(cohortSuccesses, "missing"),
          unnecessaryCount: count(cohortSuccesses, "unnecessary"),
        };
      };
      summary.contextMinimization = {
        cohorts: referenceBasisCohorts(cohort),
      };
    }
    return summary;
  }).sort((left, right) =>
    left.modelId.localeCompare(right.modelId) ||
    left.reasoningEffort.localeCompare(right.reasoningEffort) ||
    left.operation.localeCompare(right.operation)
  );
}
