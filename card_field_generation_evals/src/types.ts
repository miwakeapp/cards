import type {
  EffectiveReasoningEffort,
  FieldGenerationOperation,
  GenerationAttempt,
  GenerationMetadata,
  GenerationOptions,
  GenerationUsage,
  HintGenerationOutcome,
  ModelId,
  SenseSelectionOutcome,
} from "card_field_generation";
import type { EstimatedUSDCost, PricingSourceURLs } from "./pricing.ts";

/** Focused generation operations represented by tracked eval fixtures. */
export type EvalOperation = FieldGenerationOperation;

/** Completed-result cache policy selected for an eval invocation. */
export type EvalCacheMode = NonNullable<GenerationOptions["cacheMode"]>;

/** A checked reference to one entry in a tracked Markdown failure log. */
export interface EvalKnownFailureReference {
  /** Path relative to the `card_field_generation_evals` package. */
  artifact: string;
  /** Level-two heading containing the referenced failure. */
  section: string;
  /** Optional level-three heading within `section`. */
  subsection?: string;
  /** Exact first-column value of the referenced Markdown table row. */
  entry: string;
  /** Exact second-column context, required when `entry` alone does not identify one row. */
  context?: string;
}

/** Fixture provenance retained in reports so a surprising judgment can be traced to its corpus. */
export interface EvalProvenance {
  corpus: string;
  sourceNoteId?: number;
  artifact: string;
  knownFailure?: EvalKnownFailureReference;
}

/** Evidence supporting a fixture's tracked expected value. */
export type EvalReferenceBasis =
  | "agent-reviewed"
  | "corpus-replay"
  | "provisional"
  | "user-reviewed";

/** Reference provenance attached to a tracked fixture. */
export interface EvalFixtureEvaluation {
  promptOverlap: boolean;
  referenceBasis: EvalReferenceBasis;
  reviewNote?: string;
}

/** Sense-selection evidence copied from a card-conversion artifact or explicit review. */
export interface SenseSelectionFixture {
  operation: "sense-selection";
  id: string;
  provenance: EvalProvenance;
  input: {
    /** Sanitized source HTML whose intended occurrence(s) are wrapped in `<mark>`. */
    context: string;
    recognitionTarget: string;
    jmdictId: string;
    compatibleSenseNumbers: number[];
  };
  expected: {
    outcome: SenseSelectionOutcome;
    rationale?: string;
  };
  evaluation: EvalFixtureEvaluation;
}

/** An explicit selected or contrasting JMDict usage in a hint fixture. */
export interface FixtureJMDictUsage {
  jmdictId: string;
  senseNumbers: number[];
}

/** Hint evidence and reference judgments from a known failure. */
export interface HintFixture {
  operation: "hint";
  id: string;
  provenance: EvalProvenance;
  input: {
    /** Sanitized source HTML whose intended occurrence(s) are wrapped in `<mark>`. */
    context: string;
    recognitionTarget: string;
    selectedUsage: FixtureJMDictUsage;
    contrastingUsages: FixtureJMDictUsage[];
  };
  expected: {
    disposition: "generated" | "not-needed" | "source-insufficient";
    /** Curated high-quality answers that embody the preferred hint policy. */
    preferredHints: string[];
    /** Curated usable answers that are faithful but less concise or polished than preferred. */
    acceptableHints: string[];
    observedBadHints: string[];
    rubricNotes: string[];
  };
  evaluation: EvalFixtureEvaluation;
}

/** Reference disposition and illustrative outputs for one full-context minimization. */
export interface ContextMinimizationFixture {
  operation: "context-minimization";
  id: string;
  provenance: EvalProvenance;
  input: {
    fullContext: string;
  };
  expected: {
    /** Whether a separate minimized field would materially improve review. */
    disposition: "keep-full-context" | "minimize";

    /**
     * Curated good outputs, not an exhaustive string-valued gold set.
     *
     * This is empty for `keep-full-context`; in that case the exact expected operation result is
     * `null`. For `minimize`, a novel package-validated output still requires rubric-based review.
     */
    acceptableMinimizedContexts: string[];

    /** Concrete provider outputs rejected during qualitative review. */
    observedBadMinimizedContexts: string[];
    rubricNotes: string[];
  };
  evaluation: EvalFixtureEvaluation;
}

/** Any operation-specific tracked fixture. */
export type EvalFixture =
  | ContextMinimizationFixture
  | HintFixture
  | SenseSelectionFixture;

/** One concrete provider preset under evaluation. */
export interface EvalModelConfiguration {
  modelId: ModelId;
  /** Provider-effective setting; equivalent requested settings are collapsed before evaluation. */
  reasoningEffort: EffectiveReasoningEffort;
}

/** Reference matches for the objectively enumerable sense-selection operation. */
export interface SenseSelectionScore {
  kind: "sense-selection";
  exactMatch: boolean;
}

/**
 * Reference disposition for a generated hint.
 *
 * A novel hint requires review: reference answers are examples, not an exhaustive gold set.
 */
export type HintReferenceDisposition =
  | "acceptable"
  | "known-bad"
  | "not-needed"
  | "novel"
  | "preferred"
  | "reference-disposition-mismatch"
  | "source-insufficient";

/** Auditable reference checks for a generated source-grounded hint. */
export interface HintScore {
  kind: "hint";
  disposition: HintReferenceDisposition;
  dispositionMatchesReference: boolean;
  preferredExactMatch: boolean;
  acceptableExactMatch: boolean;
  observedBadExactMatch: boolean;
  /** Unicode code-point count of a generated hint, or `null` for a non-generated outcome. */
  hintCharacterCount: number | null;
  /** Generated hint length minus recognition-target length, or `null` without a hint. */
  hintLengthDelta: number | null;
}

/** Reference classification for one package-validated context-minimization result. */
export type ContextMinimizationReferenceDisposition =
  | "acceptable-reference"
  | "keep-full-context"
  | "known-bad"
  | "missing"
  | "novel"
  | "unnecessary";

/** Exact disposition score plus a non-exhaustive reference-string diagnostic. */
export interface ContextMinimizationScore {
  kind: "context-minimization";
  disposition: ContextMinimizationReferenceDisposition;
  dispositionCorrect: boolean;
  acceptableExactMatch: boolean;
  observedBadExactMatch: boolean;
}

/** Operation-specific value after package validation. */
export type EvalValue = HintGenerationOutcome | SenseSelectionOutcome | string | null;

/** Operation-specific reference score. */
export type EvalScore = ContextMinimizationScore | HintScore | SenseSelectionScore;

interface EvalCaseResultBase {
  operation: EvalOperation;
  caseId: string;
  /** SHA-256 of the tracked fixture plus the JMDict semantics its prompt used. */
  fixtureHash: string;
  fixtureEvaluation: EvalFixtureEvaluation;
  provenance: EvalProvenance;
  input:
    | ContextMinimizationFixture["input"]
    | HintFixture["input"]
    | SenseSelectionFixture["input"];
  expected:
    | ContextMinimizationFixture["expected"]
    | HintFixture["expected"]
    | SenseSelectionFixture["expected"];
  modelId: ModelId;
  reasoningEffort: EffectiveReasoningEffort;
  startedAt: string;
  latencyMilliseconds: number;
  attempts: GenerationAttempt[];
  usage: GenerationUsage;
}

/** A package-validated generation and its operation-specific score. */
export interface SuccessfulEvalCaseResult extends EvalCaseResultBase {
  status: "success";
  value: EvalValue;
  /** SHA-256 of the recursively canonicalized package-validated value. */
  outputHash: string;
  score: EvalScore;
  generation: GenerationMetadata;
}

/** A case which exhausted generation attempts or failed before generation. */
export interface FailedEvalCaseResult extends EvalCaseResultBase {
  status: "error";
  error: {
    name: string;
    message: string;
    stack?: string;
  };
}

/** One case/model/effort result. */
export type EvalCaseResult = FailedEvalCaseResult | SuccessfulEvalCaseResult;

/** Sense-selection reference scores for one non-prompt-overlap evidence cohort. */
export interface SenseSelectionCohortSummary {
  caseCount: number;
  exactMatchCount: number;
}

/** Hint reference scores for one non-prompt-overlap evidence cohort. */
export interface HintCohortSummary {
  caseCount: number;
  referenceDispositionAgreementCount: number;
  preferredCount: number;
  acceptableCount: number;
  knownBadCount: number;
  novelCount: number;
  notNeededCount: number;
  sourceInsufficientCount: number;
  referenceDispositionMismatchCount: number;
  /** Non-blocking review diagnostic; these results still passed package validation. */
  overSixHintLengthDeltaCount: number;
  /** Stronger non-blocking outlier diagnostic; this is deliberately not a hard cap. */
  overTwelveHintLengthDeltaCount: number;
}

/** Context-minimization reference scores for one non-prompt-overlap evidence cohort. */
export interface ContextMinimizationCohortSummary {
  caseCount: number;
  dispositionCorrectCount: number;
  acceptableExactMatchCount: number;
  knownBadCount: number;
  keepFullContextCount: number;
  novelCount: number;
  missingCount: number;
  unnecessaryCount: number;
}

/** Operation-specific scores partitioned by the provenance of each reference judgment. */
export interface EvalReferenceBasisCohorts<T> {
  userReviewed: T;
  agentReviewed: T;
  corpusReplay: T;
  provisional: T;
}

/** Aggregate telemetry and reference scores for one operation/model/effort. */
export interface EvalSummary {
  operation: EvalOperation;
  modelId: ModelId;
  reasoningEffort: EffectiveReasoningEffort;
  caseCount: number;
  nonPromptOverlapCaseCount: number;
  promptOverlapCaseCount: number;
  successCount: number;
  errorCount: number;
  cacheHitCount: number;
  providerAttemptCount: number;
  retryCount: number;
  latencyMilliseconds: number;
  usage: GenerationUsage;
  /** Approximate standard list-price cost for this summary's provider attempts. */
  estimatedCostUSD: EstimatedUSDCost;
  senseSelection?: {
    cohorts: EvalReferenceBasisCohorts<SenseSelectionCohortSummary>;
  };
  hint?: {
    cohorts: EvalReferenceBasisCohorts<HintCohortSummary>;
  };
  contextMinimization?: {
    cohorts: EvalReferenceBasisCohorts<ContextMinimizationCohortSummary>;
  };
}

/** Self-contained JSON artifact for one invocation of the eval CLI. */
export interface EvalRun {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  completedAt: string;
  /** Present when the CLI stopped before every selected model/case slot was attempted. */
  interruption?: {
    reason: "provider-quota";
    error: { name: string; message: string };
    /** Slots whose success or failure is represented in `results`. */
    recordedProviderCallSlots: number;
  };
  configuration: {
    models: EvalModelConfiguration[];
    operations: EvalOperation[];
    requestedCaseFilters: string[];
    sampleSize?: number;
    sampleSeed?: string;
    concurrency: number;
    maxAttempts: number;
    cacheMode: EvalCacheMode;
  };
  fixtureCounts: {
    available: number;
    selected: number;
    selectedPromptOverlaps: number;
    providerCallSlots: number;
  };
  reproducibility: {
    hashAlgorithm: "sha-256-canonical-json";
    /** Hash of the selected fixtures and their prompt-visible JMDict semantics, in run order. */
    selectedFixtureSetHash: string;
  };
  /** Whole-invocation estimate; local completed-result cache hits contribute no paid usage. */
  costEstimate: {
    currency: "USD";
    pricingAsOf: string;
    total: number;
    /** Present when at least one summary is a lower bound and none is uncertain. */
    lowerBound?: true;
    /** Present when at least one summary may overstate or understate actual cost. */
    uncertain?: true;
    sources: PricingSourceURLs;
    disclaimer: string;
  };
  summaries: EvalSummary[];
  results: EvalCaseResult[];
}
