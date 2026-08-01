import * as path from "@std/path";
import type { EvalCaseResult, EvalRun, EvalSummary } from "./types.ts";

function percentage(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${(numerator / denominator * 100).toFixed(1)}%`;
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function dollars(value: number): string {
  if (value === 0 || value >= 0.000001) return `$${value.toFixed(6)}`;
  return `$${value.toExponential(3)}`;
}

function formatActual(result: Extract<EvalCaseResult, { status: "success" }>): string {
  const value = result.value;
  if (value === null) return "`null`";
  if (typeof value === "string") return JSON.stringify(value);
  if ("outcome" in value) {
    if (value.outcome === "generated") {
      return `generated hint ${JSON.stringify(value.hint)}`;
    }
    if (value.outcome === "not-needed") return "no hint needed";
    if (value.outcome === "source-insufficient") {
      return "source context insufficient for a required hint";
    }
    if (value.outcome === "no-match") return "no compatible sense matches";
    if (value.outcome === "ambiguous") {
      return `ambiguous among senses ${value.possibleSenseNumbers.join(", ")}`;
    }
    const compatibleSenseNumbers = (result.input as { compatibleSenseNumbers: number[] })
      .compatibleSenseNumbers;
    return value.senseNumbers.length === compatibleSenseNumbers.length
      ? "all compatible senses"
      : `senses ${value.senseNumbers.join(", ")}`;
  }
  throw new TypeError("Unexpected package-validated eval value");
}

function quotedContext(context: string): string {
  return context.split("\n").map((line) => `> ${line}`).join("\n");
}

const REFERENCE_COHORTS = [
  {
    key: "userReviewed",
    label: "User-reviewed development reference",
    qualification: "These visible cases are development evidence, not a blinded holdout.",
  },
  {
    key: "agentReviewed",
    label: "Agent-reviewed development reference",
    qualification: "This is agent judgment, not a user preference judgment.",
  },
  {
    key: "corpusReplay",
    label: "Corpus-replay reference",
    qualification:
      "This measures reproduction of observed artifacts, not independent adjudication.",
  },
  {
    key: "provisional",
    label: "Provisional reference",
    qualification: "This cohort is diagnostic only.",
  },
] as const;

function summaryMarkdown(summary: EvalSummary): string {
  const lines = [
    `### \`${summary.modelId}@${summary.reasoningEffort}\` — ${summary.operation}`,
    "",
    `- Reference corpus: ${summary.nonPromptOverlapCaseCount} non-prompt-overlap case(s); ${summary.promptOverlapCaseCount} prompt-overlap case(s) excluded from basis-specific metrics.`,
    `- Execution: ${summary.successCount} succeeded, ${summary.errorCount} errored, ${summary.cacheHitCount} cache hit(s), ${summary.providerAttemptCount} provider attempt(s), ${summary.retryCount} retry attempt(s).`,
  ];
  if (summary.senseSelection !== undefined) {
    for (const { key, label, qualification } of REFERENCE_COHORTS) {
      const cohort = summary.senseSelection.cohorts[key];
      if (cohort.caseCount === 0) continue;
      lines.push(
        `- ${label} exact outcome agreement: ${cohort.exactMatchCount}/${cohort.caseCount} (${
          percentage(cohort.exactMatchCount, cohort.caseCount)
        }). ${qualification}`,
      );
    }
  }
  if (summary.hint !== undefined) {
    for (const { key, label, qualification } of REFERENCE_COHORTS) {
      const cohort = summary.hint.cohorts[key];
      if (cohort.caseCount === 0) continue;
      lines.push(
        `- ${label} operation-disposition agreement: ${cohort.referenceDispositionAgreementCount}/${cohort.caseCount} (${
          percentage(cohort.referenceDispositionAgreementCount, cohort.caseCount)
        }); ${cohort.notNeededCount} matched not-needed, ${cohort.sourceInsufficientCount} matched source-insufficient, ${cohort.referenceDispositionMismatchCount} differed from the reference. ${qualification}`,
        `- ${label} generated-hint wording: ${cohort.preferredCount} preferred-reference exact, ${cohort.acceptableCount} acceptable-reference exact, ${cohort.novelCount} novel package-validated result(s) requiring qualitative review, ${cohort.knownBadCount} known-bad exact. Disposition agreement does not establish hint wording quality.`,
        `- ${label} generated-hint length diagnostics (not validation): ${cohort.overSixHintLengthDeltaCount} exceed the recognition target by more than 6 Unicode code points; ${cohort.overTwelveHintLengthDeltaCount} exceed it by more than 12.`,
      );
    }
  }
  if (summary.contextMinimization !== undefined) {
    for (const { key, label, qualification } of REFERENCE_COHORTS) {
      const cohort = summary.contextMinimization.cohorts[key];
      if (cohort.caseCount === 0) continue;
      lines.push(
        `- ${label} minimize/keep disposition agreement: ${cohort.dispositionCorrectCount}/${cohort.caseCount} (${
          percentage(cohort.dispositionCorrectCount, cohort.caseCount)
        }); ${cohort.acceptableExactMatchCount} illustrative reference match(es), ${cohort.keepFullContextCount} matched keep-full-context, ${cohort.novelCount} novel package-validated result(s) needing review, ${cohort.knownBadCount} known-bad exact, ${cohort.missingCount} missing, ${cohort.unnecessaryCount} unnecessary. ${qualification}`,
      );
    }
  }
  const unclassifiedInputUsage = summary.usage.unclassifiedInputTokens === undefined
    ? ""
    : `, ${summary.usage.unclassifiedInputTokens} unclassified`;
  const usageQualification = summary.usage.providerUsageInconsistent === true
    ? " Provider telemetry was internally inconsistent, so these normalized counts are uncertain and may be above or below actual usage."
    : summary.usage.providerUsageIncomplete === true
    ? " Provider telemetry was incomplete, so these counts are lower bounds."
    : "";
  const unclassifiedInputCost = summary.estimatedCostUSD.breakdown.unclassifiedInput === undefined
    ? ""
    : `, ${dollars(summary.estimatedCostUSD.breakdown.unclassifiedInput)} unclassified input`;
  lines.push(
    `- Usage: ${summary.usage.inputTokens} input tokens (${summary.usage.cacheReadInputTokens} cache-read, ${summary.usage.cacheWriteInputTokens} cache-write, ${summary.usage.noCacheInputTokens} uncached${unclassifiedInputUsage}); ${summary.usage.outputTokens} output tokens (${summary.usage.reasoningOutputTokens} reasoning).${usageQualification}`,
    `- Estimated list-price cost${
      summary.estimatedCostUSD.uncertain === true
        ? " (uncertain)"
        : summary.estimatedCostUSD.lowerBound === true
        ? " lower bound"
        : ""
    }: ${dollars(summary.estimatedCostUSD.total)} (${
      dollars(summary.estimatedCostUSD.breakdown.uncachedInput)
    } uncached input, ${
      dollars(summary.estimatedCostUSD.breakdown.cacheWriteInput)
    } cache writes, ${
      dollars(summary.estimatedCostUSD.breakdown.cacheReadInput)
    } cache reads${unclassifiedInputCost}, ${
      dollars(summary.estimatedCostUSD.breakdown.output)
    } output). Rates per million tokens: $${summary.estimatedCostUSD.ratesPerMillionTokens.uncachedInput} / $${summary.estimatedCostUSD.ratesPerMillionTokens.cacheWriteInput} / $${summary.estimatedCostUSD.ratesPerMillionTokens.cacheReadInput} / $${summary.estimatedCostUSD.ratesPerMillionTokens.output}, respectively.`,
    ...(summary.estimatedCostUSD.pricingNote === undefined
      ? []
      : [`- Pricing note: ${summary.estimatedCostUSD.pricingNote}`]),
    `- Summed case latency: ${
      seconds(summary.latencyMilliseconds)
    }. Concurrent wall time is recorded at run level.`,
  );
  return lines.join("\n");
}

function resultNeedsDetail(result: EvalCaseResult): boolean {
  if (result.fixtureEvaluation.promptOverlap) return true;
  if (result.fixtureEvaluation.referenceBasis === "provisional") return true;
  if (result.status === "error") return true;
  if (needsAttemptAudit(result)) return true;
  if (result.score.kind === "sense-selection") {
    return !result.score.exactMatch;
  }
  if (result.score.kind === "context-minimization") {
    return result.score.disposition !== "acceptable-reference" &&
      result.score.disposition !== "keep-full-context";
  }
  if (
    result.score.kind === "hint" &&
    result.score.hintLengthDelta !== null &&
    result.score.hintLengthDelta > 6
  ) {
    return true;
  }
  return result.score.disposition !== "preferred" &&
    result.score.disposition !== "acceptable" &&
    result.score.disposition !== "not-needed" &&
    result.score.disposition !== "source-insufficient";
}

function expectedDescription(result: EvalCaseResult): string {
  if (result.operation === "context-minimization") {
    const expected = result.expected as {
      disposition: "keep-full-context" | "minimize";
      acceptableMinimizedContexts: string[];
    };
    if (expected.disposition === "keep-full-context") {
      return "keep full context (`null`)";
    }
    return `a useful shortening; illustrative reference(s): ${
      expected.acceptableMinimizedContexts.map((context) => JSON.stringify(context)).join(" or ")
    }`;
  }
  if (result.operation === "sense-selection") {
    const expected = result.expected as {
      outcome:
        | { outcome: "selected"; senseNumbers: number[] }
        | { outcome: "no-match" }
        | { outcome: "ambiguous"; possibleSenseNumbers: number[] };
    };
    if (expected.outcome.outcome === "no-match") return "no compatible sense matches";
    if (expected.outcome.outcome === "ambiguous") {
      return `defer as ambiguous among senses ${expected.outcome.possibleSenseNumbers.join(", ")}`;
    }
    const compatibleSenseNumbers = (result.input as { compatibleSenseNumbers: number[] })
      .compatibleSenseNumbers;
    return expected.outcome.senseNumbers.length === compatibleSenseNumbers.length
      ? "select all compatible senses"
      : `select senses ${expected.outcome.senseNumbers.join(", ")}`;
  }
  const expected = result.expected as {
    disposition: "generated" | "not-needed" | "source-insufficient";
    preferredHints: string[];
    acceptableHints: string[];
    observedBadHints: string[];
    rubricNotes: string[];
  };
  if (expected.disposition === "not-needed") {
    return "no hint needed because the usages are semantically indistinguishable";
  }
  if (expected.disposition === "source-insufficient") {
    return "hint required, but source context insufficient (defer)";
  }
  return `preferred ${
    expected.preferredHints.map((hint) => JSON.stringify(hint)).join(" or ")
  }; acceptable ${
    expected.acceptableHints.map((hint) => JSON.stringify(hint)).join(" or ")
  }; known-bad ${expected.observedBadHints.map((hint) => JSON.stringify(hint)).join(" or ")}`;
}

function fixtureProvenance(result: EvalCaseResult): string {
  const fields = [
    result.provenance.corpus,
    `artifact ${JSON.stringify(result.provenance.artifact)}`,
  ];
  if (result.provenance.sourceNoteId !== undefined) {
    fields.push(`source note ${result.provenance.sourceNoteId}`);
  }
  if (result.provenance.knownFailure !== undefined) {
    const reference = result.provenance.knownFailure;
    const subsection = reference.subsection === undefined ? "" : ` / ${reference.subsection}`;
    fields.push(
      `known-failure artifact ${JSON.stringify(reference.artifact)}, section ${
        JSON.stringify(reference.section + subsection)
      }, entry ${JSON.stringify(reference.entry)}`,
    );
  }
  return fields.join("; ");
}

function originalAttempts(
  result: EvalCaseResult,
): readonly EvalCaseResult["attempts"][number][] {
  if (result.status === "success" && result.generation.sourceGeneration !== undefined) {
    return result.generation.sourceGeneration.attempts;
  }
  return result.attempts;
}

function needsAttemptAudit(result: EvalCaseResult): boolean {
  const attempts = originalAttempts(result);
  return result.status === "error" || attempts.length > 1 ||
    attempts.some(({ requestError, validationError }) =>
      requestError !== undefined || validationError !== undefined
    );
}

function generationDescription(result: EvalCaseResult): string {
  const attempts = originalAttempts(result);
  if (result.status === "error") {
    return `${attempts.length} paid attempt(s) before failure`;
  }
  const responseModels = [
    ...new Set(
      attempts.flatMap(({ responseModelId }) =>
        responseModelId === undefined ? [] : [responseModelId]
      ),
    ),
  ];
  const modelSuffix = responseModels.length === 0
    ? ""
    : `; provider model(s) ${responseModels.map((model) => JSON.stringify(model)).join(", ")}`;
  if (result.generation.sourceGeneration !== undefined) {
    if (result.generation.cacheStatus === "shared") {
      return `joined an in-flight generation; original paid generation ${result.generation.sourceGeneration.generatedAt}; ${attempts.length} attempt(s)${modelSuffix}`;
    }
    return `result-cache hit; original paid generation ${result.generation.sourceGeneration.generatedAt}; ${attempts.length} attempt(s)${modelSuffix}`;
  }
  return `provider result; ${attempts.length} paid attempt(s)${modelSuffix}`;
}

function retryDetails(result: EvalCaseResult): string[] {
  const attempts = originalAttempts(result);
  if (!needsAttemptAudit(result)) return [];
  const lines = ["- Paid-attempt audit:"];
  for (const attempt of attempts) {
    const outcome = attempt.validationError !== undefined
      ? `rejected by deterministic validation — ${JSON.stringify(attempt.validationError)}`
      : attempt.requestError !== undefined
      ? `request failed — ${JSON.stringify(attempt.requestError)}`
      : "accepted";
    const identity = [
      attempt.responseModelId === undefined
        ? undefined
        : `model ${JSON.stringify(attempt.responseModelId)}`,
      attempt.responseId === undefined
        ? undefined
        : `response ${JSON.stringify(attempt.responseId)}`,
      `${seconds(attempt.latencyMilliseconds)}`,
      `${attempt.usage.inputTokens} input / ${attempt.usage.outputTokens} output tokens`,
    ].filter((value) => value !== undefined).join("; ");
    lines.push(`  - Attempt ${attempt.number}: ${outcome} (${identity}).`);
  }
  return lines;
}

function resultConfigurationMarkdown(result: EvalCaseResult): string {
  const lines = [
    `#### \`${result.modelId}@${result.reasoningEffort}\``,
    "",
  ];
  if (result.status === "error") {
    lines.push(`- Error: ${result.error.name}: ${result.error.message}`);
  } else {
    lines.push(`- Actual: ${formatActual(result)}.`);
    if (result.value !== null && typeof result.value === "object" && "outcome" in result.value) {
      if (result.value.outcome === "generated") {
        lines.push(
          `- Claimed semantic evidence span: ${JSON.stringify(result.value.semanticEvidenceSpan)}.`,
          `- Claimed local hint source span: ${JSON.stringify(result.value.hintSourceSpan)}.`,
        );
      }
    }
    if (result.score.kind === "hint") {
      const referenceDisposition = (result.expected as { disposition: string }).disposition;
      const qualitativeReview = result.score.disposition === "novel"
        ? " Novel generated wording still requires qualitative review."
        : "";
      lines.push(
        `- Reference comparison: ${result.score.disposition}; operation disposition ${
          result.score.dispositionMatchesReference ? "agrees with" : "differs from"
        } tracked ${result.fixtureEvaluation.referenceBasis} reference ${
          JSON.stringify(referenceDisposition)
        }.${qualitativeReview}`,
      );
      if (
        result.score.hintLengthDelta !== null &&
        result.score.hintLengthDelta > 6
      ) {
        lines.push(
          `- Length diagnostic: ${result.score.hintCharacterCount} Unicode code points, ${result.score.hintLengthDelta} longer than recognitionTarget; the 6- and 12-character thresholds are review signals, not validator limits.`,
        );
      }
    } else if (result.score.kind === "sense-selection") {
      lines.push(
        `- Reference judgment: exact outcome ${result.score.exactMatch ? "yes" : "no"}.`,
      );
    } else {
      lines.push(
        `- Reference judgment: ${result.score.disposition}; null/text decision ${
          result.score.dispositionCorrect ? "agrees with" : "differs from"
        } the tracked disposition; illustrative exact match ${
          result.score.acceptableExactMatch ? "yes" : "no"
        }; known-bad exact match ${result.score.observedBadExactMatch ? "yes" : "no"}.`,
      );
    }
    lines.push(
      `- Hashes: request \`${result.generation.cacheKey}\`; output \`${result.outputHash}\`.`,
    );
  }
  lines.push(`- Generation provenance: ${generationDescription(result)}.`);
  lines.push(...retryDetails(result));
  return lines.join("\n");
}

function caseDetailMarkdown(results: readonly EvalCaseResult[]): string {
  const result = results[0];
  const isContextMinimization = result.operation === "context-minimization";
  let heading: string;
  let context: string;
  if (isContextMinimization) {
    const input = result.input as { fullContext: string };
    heading = `Context minimization — \`${result.caseId}\``;
    context = input.fullContext;
  } else {
    const input = result.input as { context: string; recognitionTarget: string };
    heading = `${input.recognitionTarget} — \`${result.caseId}\``;
    context = input.context;
  }
  const lines = [
    `### ${heading}`,
    "",
    `- Operation: ${result.operation}${
      result.fixtureEvaluation.promptOverlap ? "; prompt overlap" : ""
    }.`,
    `- Expected reference: ${expectedDescription(result)}.`,
    `- Reference basis: ${result.fixtureEvaluation.referenceBasis}${
      result.fixtureEvaluation.reviewNote === undefined
        ? ""
        : `; ${result.fixtureEvaluation.reviewNote}`
    }.`,
    `- Provenance: ${fixtureProvenance(result)}.`,
    `- Fixture hash: \`${result.fixtureHash}\`.`,
  ];
  if (result.operation === "sense-selection") {
    const expected = result.expected as { rationale?: string };
    if (expected.rationale !== undefined) {
      lines.push(`- Reference rationale: ${expected.rationale}`);
    }
  } else {
    const expected = result.expected as { rubricNotes: string[] };
    for (const note of expected.rubricNotes) {
      lines.push(`- Reference rubric: ${note}`);
    }
  }
  lines.push(
    "",
    quotedContext(context),
    "",
    results.map(resultConfigurationMarkdown).join("\n\n"),
  );
  return lines.join("\n");
}

function comparisonKey(result: EvalCaseResult): string {
  return result.status === "error"
    ? `error:${result.error.name}:${result.error.message}`
    : `success:${JSON.stringify(result.value)}`;
}

function caseNeedsDetail(results: readonly EvalCaseResult[]): boolean {
  return results.some(resultNeedsDetail) || new Set(results.map(comparisonKey)).size > 1;
}

function resultCases(results: readonly EvalCaseResult[]): EvalCaseResult[][] {
  const groups = new Map<string, EvalCaseResult[]>();
  for (const result of results) {
    const key = `${result.operation}\u0000${result.caseId}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    left[0].operation.localeCompare(right[0].operation) ||
    left[0].caseId.localeCompare(right[0].caseId)
  );
}

/** Produces a compact report whose detail section emphasizes failures and novel judgments. */
export function renderMarkdownReport(run: EvalRun): string {
  const duration = Date.parse(run.completedAt) - Date.parse(run.startedAt);
  const interrupted = run.interruption !== undefined;
  const lines = [
    "# Card-field generation eval",
    "",
    `Run \`${run.runId}\` ${interrupted ? "stopped early" : "completed"} in ${seconds(duration)}.`,
    "",
    `Selected ${run.fixtureCounts.selected}/${run.fixtureCounts.available} fixture(s), producing ${run.fixtureCounts.providerCallSlots} model/case slot(s). Basis-specific metrics exclude ${run.fixtureCounts.selectedPromptOverlaps} selected prompt-overlap fixture(s).`,
    `Selected-fixture hash (${run.reproducibility.hashAlgorithm}): \`${run.reproducibility.selectedFixtureSetHash}\`.`,
    `Completed-result cache mode: \`${run.configuration.cacheMode}\`.`,
    "",
    ...(run.interruption === undefined ? [] : [
      `Interrupted by provider quota after recording ${run.interruption.recordedProviderCallSlots}/${run.fixtureCounts.providerCallSlots} model/case slot(s): ${run.interruption.error.name}: ${run.interruption.error.message}. Metrics and cost below cover only recorded slots; completed raw outputs remain reusable through the result cache.`,
      "",
    ]),
    `Estimated ${interrupted ? "recorded partial-run" : "whole-run"} standard list-price cost${
      run.costEstimate.uncertain === true
        ? " (uncertain)"
        : run.costEstimate.lowerBound === true
        ? " lower bound"
        : ""
    }: ${
      dollars(run.costEstimate.total)
    } USD, using prices verified ${run.costEstimate.pricingAsOf}. This is an estimate, not invoice truth.`,
    `Pricing sources: [Anthropic](${run.costEstimate.sources.anthropic}), [Google](${run.costEstimate.sources.google}), and [OpenAI](${run.costEstimate.sources.openai}).`,
    run.costEstimate.disclaimer,
  ];
  if (run.configuration.sampleSize !== undefined) {
    lines.push(
      "",
      `Development sample: ${run.configuration.sampleSize} requested case(s), stratified by operation and expected outcome with seed ${
        JSON.stringify(run.configuration.sampleSeed)
      }.`,
    );
  }
  lines.push("", "## Results", "", run.summaries.map(summaryMarkdown).join("\n\n"));
  const detailedCases = resultCases(run.results).filter(caseNeedsDetail);
  if (detailedCases.length > 0) {
    lines.push(
      "",
      "## Cases requiring review",
      "",
      "Each case appears once with every tested configuration. Novel hints and minimized contexts are shown for review instead of being scored wrong merely because they differ from non-exhaustive reference examples; differing model outputs are shown even when both satisfy their references.",
      "",
      detailedCases.map(caseDetailMarkdown).join("\n\n"),
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Writes paired self-contained JSON and readable Markdown artifacts. */
export async function writeRunArtifacts(
  run: EvalRun,
  runsDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await Deno.mkdir(runsDirectory, { recursive: true });
  const jsonPath = path.join(runsDirectory, `${run.runId}.json`);
  const markdownPath = path.join(runsDirectory, `${run.runId}.md`);
  await Deno.writeTextFile(jsonPath, `${JSON.stringify(run, undefined, 2)}\n`);
  await Deno.writeTextFile(markdownPath, renderMarkdownReport(run));
  return { jsonPath, markdownPath };
}
