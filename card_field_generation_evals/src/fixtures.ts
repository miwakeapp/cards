import * as path from "@std/path";
import { z } from "zod";
import { markedContextTextTemplate } from "card_resolution";
import type {
  ContextMinimizationFixture,
  EvalFixture,
  EvalKnownFailureReference,
  HintFixture,
  ReadingSelectionFixture,
  SenseSelectionFixture,
} from "./types.ts";

const knownFailureReferenceSchema = z.strictObject({
  artifact: z.string().min(1),
  section: z.string().min(1),
  subsection: z.string().min(1).optional(),
  entry: z.string().min(1),
  context: z.string().min(1).optional(),
});

const provenanceSchema = z.strictObject({
  corpus: z.string().min(1),
  sourceNoteId: z.number().int().positive().optional(),
  artifact: z.string().min(1),
  knownFailure: knownFailureReferenceSchema.optional(),
});

const evaluationSchema = z.strictObject({
  promptOverlap: z.boolean(),
  referenceBasis: z.enum([
    "agent-reviewed",
    "corpus-replay",
    "provisional",
    "user-reviewed",
  ]),
  reviewNote: z.string().min(1).optional(),
});

const positiveSenseNumbersSchema = z.array(z.number().int().positive());
const senseSelectionOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("selected"),
    senseNumbers: positiveSenseNumbersSchema.min(1),
  }),
  z.strictObject({ outcome: z.literal("no-match") }),
  z.strictObject({
    outcome: z.literal("ambiguous"),
    possibleSenseNumbers: positiveSenseNumbersSchema.min(1),
  }),
]);

const senseSelectionFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().min(1).optional(),
  cases: z.array(z.strictObject({
    id: z.string().min(1),
    provenance: provenanceSchema,
    input: z.strictObject({
      context: z.string().min(1),
      recognitionTarget: z.string().min(1),
      jmdictId: z.string().regex(/^\d+$/u),
      compatibleSenseNumbers: positiveSenseNumbersSchema.min(1),
    }),
    expected: z.strictObject({
      outcome: senseSelectionOutcomeSchema,
      rationale: z.string().min(1).optional(),
    }),
    evaluation: evaluationSchema,
  })),
});

const readingEvidenceSchema = z.strictObject({
  kanaReading: z.string().min(1),
  bccwjFrequencyPerMillion: z.number().positive().finite().nullable(),
});

const readingSelectionFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().min(1).optional(),
  cases: z.array(z.strictObject({
    id: z.string().min(1),
    provenance: provenanceSchema,
    input: z.strictObject({
      context: z.string().min(1),
      recognitionTarget: z.string().min(1),
      jmdictId: z.string().regex(/^\d+$/u),
      senseNumbers: positiveSenseNumbersSchema.min(1),
      encountered: readingEvidenceSchema,
      alternatives: z.array(readingEvidenceSchema).min(1),
    }),
    expected: z.strictObject({
      decisions: z.array(z.strictObject({
        kanaReading: z.string().min(1),
        decision: z.enum(["include", "omit"]),
        rationale: z.string().min(1),
      })).min(1),
    }),
    evaluation: evaluationSchema,
  })),
});

const usageSchema = z.strictObject({
  jmdictId: z.string().regex(/^\d+$/u),
  senseNumbers: positiveSenseNumbersSchema.min(1),
});

const hintFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().min(1).optional(),
  cases: z.array(z.strictObject({
    id: z.string().min(1),
    provenance: provenanceSchema,
    input: z.strictObject({
      context: z.string().min(1),
      recognitionTarget: z.string().min(1),
      selectedUsage: usageSchema,
      contrastingUsages: z.array(usageSchema).min(1),
    }),
    expected: z.strictObject({
      disposition: z.enum(["generated", "not-needed", "source-insufficient"]),
      preferredHints: z.array(z.string().min(1)),
      acceptableHints: z.array(z.string().min(1)).default([]),
      observedBadHints: z.array(z.string().min(1)),
      rubricNotes: z.array(z.string().min(1)).min(1),
    }),
    evaluation: evaluationSchema,
  })),
});

const contextMinimizationFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().min(1).optional(),
  cases: z.array(z.strictObject({
    id: z.string().min(1),
    provenance: provenanceSchema,
    input: z.strictObject({
      fullContext: z.string().min(1),
    }),
    expected: z.strictObject({
      disposition: z.enum(["keep-full-context", "minimize"]),
      acceptableMinimizedContexts: z.array(z.string().min(1)),
      observedBadMinimizedContexts: z.array(z.string().min(1)),
      rubricNotes: z.array(z.string().min(1)).min(1),
    }),
    evaluation: evaluationSchema,
  })),
});

function assertUniqueSenseNumbers(
  values: readonly number[],
  label: string,
): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicate sense numbers`);
  }
}

function validateSenseFixture(fixture: SenseSelectionFixture): void {
  assertUniqueSenseNumbers(
    fixture.input.compatibleSenseNumbers,
    `${fixture.id}.input.compatibleSenseNumbers`,
  );
  const outcome = fixture.expected.outcome;
  if (outcome.outcome === "no-match") return;
  const senseNumbers = outcome.outcome === "selected"
    ? outcome.senseNumbers
    : outcome.possibleSenseNumbers;
  const label = outcome.outcome === "selected"
    ? `${fixture.id}.expected.outcome.senseNumbers`
    : `${fixture.id}.expected.outcome.possibleSenseNumbers`;
  assertUniqueSenseNumbers(senseNumbers, label);
  const incompatible = senseNumbers.filter((sense) =>
    !fixture.input.compatibleSenseNumbers.includes(sense)
  );
  if (incompatible.length > 0) {
    throw new Error(
      `${label} contains values outside compatibleSenseNumbers: ${incompatible.join(", ")}`,
    );
  }
}

function validateReadingFixture(fixture: ReadingSelectionFixture): void {
  assertUniqueSenseNumbers(fixture.input.senseNumbers, `${fixture.id}.input.senseNumbers`);
  const alternatives = fixture.input.alternatives.map(({ kanaReading }) => kanaReading);
  const decisions = fixture.expected.decisions.map(({ kanaReading }) => kanaReading);
  if (JSON.stringify(decisions) !== JSON.stringify(alternatives)) {
    throw new Error(
      `${fixture.id}.expected.decisions must correspond to every input alternative in order`,
    );
  }
}

function validateHintFixture(fixture: HintFixture): void {
  markedContextTextTemplate(fixture.input.context);
  assertUniqueSenseNumbers(
    fixture.input.selectedUsage.senseNumbers,
    `${fixture.id}.input.selectedUsage.senseNumbers`,
  );
  for (const [index, usage] of fixture.input.contrastingUsages.entries()) {
    assertUniqueSenseNumbers(
      usage.senseNumbers,
      `${fixture.id}.input.contrastingUsages[${index}].senseNumbers`,
    );
  }
  const preferredHints = fixture.expected.preferredHints;
  const acceptableHints = fixture.expected.acceptableHints;
  const observedBadHints = fixture.expected.observedBadHints;
  if (new Set(preferredHints).size !== preferredHints.length) {
    throw new Error(`${fixture.id}.expected.preferredHints must not contain duplicates`);
  }
  if (new Set(observedBadHints).size !== observedBadHints.length) {
    throw new Error(`${fixture.id}.expected.observedBadHints must not contain duplicates`);
  }
  if (new Set(acceptableHints).size !== acceptableHints.length) {
    throw new Error(`${fixture.id}.expected.acceptableHints must not contain duplicates`);
  }
  const contradictoryHints = [...preferredHints, ...acceptableHints].filter((hint, index, all) =>
    observedBadHints.includes(hint) || all.indexOf(hint) !== index
  );
  if (contradictoryHints.length > 0) {
    throw new Error(
      `${fixture.id}.expected must not classify the same hint in multiple quality tiers`,
    );
  }
  if (
    fixture.expected.disposition === "generated" &&
    preferredHints.length === 0
  ) {
    throw new Error(
      `${fixture.id}.expected must supply preferredHints when disposition is generated`,
    );
  }
  if (
    fixture.expected.disposition !== "generated" &&
    (preferredHints.length > 0 || acceptableHints.length > 0 || observedBadHints.length > 0)
  ) {
    throw new Error(
      `${fixture.id}.expected must not supply hint references when disposition is ${fixture.expected.disposition}`,
    );
  }
}

function validateContextMinimizationFixture(
  fixture: ContextMinimizationFixture,
): void {
  const acceptableReferences = fixture.expected.acceptableMinimizedContexts;
  const badReferences = fixture.expected.observedBadMinimizedContexts;
  if (new Set(acceptableReferences).size !== acceptableReferences.length) {
    throw new Error(
      `${fixture.id}.expected.acceptableMinimizedContexts must not contain duplicates`,
    );
  }
  if (new Set(badReferences).size !== badReferences.length) {
    throw new Error(
      `${fixture.id}.expected.observedBadMinimizedContexts must not contain duplicates`,
    );
  }
  const contradictoryReferences = acceptableReferences.filter((reference) =>
    badReferences.includes(reference)
  );
  if (contradictoryReferences.length > 0) {
    throw new Error(
      `${fixture.id}.expected must not classify the same minimized context as both acceptable and observed bad`,
    );
  }
  if (fixture.expected.disposition === "minimize" && acceptableReferences.length === 0) {
    throw new Error(
      `${fixture.id}.expected must provide an illustrative acceptableMinimizedContext when disposition is minimize`,
    );
  }
  if (
    fixture.expected.disposition === "keep-full-context" &&
    acceptableReferences.length > 0
  ) {
    throw new Error(
      `${fixture.id}.expected must not provide acceptableMinimizedContexts when disposition is keep-full-context`,
    );
  }
}

async function readJSON(filePath: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(filePath));
}

function headingText(line: string, level: number): string | undefined {
  const match = line.match(new RegExp(`^#{${level}}[ \\t]+(.+?)[ \\t]*#*[ \\t]*$`, "u"));
  return match?.[1];
}

function markdownTableCells(line: string): string[] | undefined {
  if (!line.startsWith("|")) return undefined;
  const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((cell) =>
    cell.trim()
  );
  return cells.length >= 2 ? cells : undefined;
}

/**
 * Validates that an explicit failure-log reference identifies a real heading hierarchy and row.
 *
 * This is exported only so malformed-reference behavior can be unit tested without creating
 * temporary fixture directories. Normal callers receive the same validation through
 * `loadEvalFixtures()`.
 */
export function validateKnownFailureReference(
  reference: EvalKnownFailureReference,
  markdown: string,
  fixtureId: string,
): void {
  let currentSection: string | undefined;
  let currentSubsection: string | undefined;
  let sectionFound = false;
  let subsectionFound = reference.subsection === undefined;
  let matchingEntryCount = 0;

  for (const line of markdown.split(/\r?\n/u)) {
    const section = headingText(line, 2);
    if (section !== undefined) {
      currentSection = section;
      currentSubsection = undefined;
      if (section === reference.section) sectionFound = true;
      continue;
    }
    const subsection = headingText(line, 3);
    if (subsection !== undefined) {
      currentSubsection = subsection;
      if (
        currentSection === reference.section &&
        subsection === reference.subsection
      ) {
        subsectionFound = true;
      }
      continue;
    }
    const tableCells = markdownTableCells(line);
    if (
      currentSection === reference.section &&
      (reference.subsection === undefined || currentSubsection === reference.subsection) &&
      tableCells?.[0] === reference.entry &&
      (reference.context === undefined || tableCells[1] === reference.context)
    ) {
      matchingEntryCount++;
    }
  }

  const label = `${fixtureId}.provenance.knownFailure`;
  if (!sectionFound) {
    throw new Error(
      `${label}.section ${JSON.stringify(reference.section)} does not exist in ${
        JSON.stringify(reference.artifact)
      }`,
    );
  }
  if (!subsectionFound) {
    throw new Error(
      `${label}.subsection ${JSON.stringify(reference.subsection)} does not exist under section ${
        JSON.stringify(reference.section)
      } in ${JSON.stringify(reference.artifact)}`,
    );
  }
  if (matchingEntryCount === 0) {
    const scope = reference.subsection === undefined
      ? `section ${JSON.stringify(reference.section)}`
      : `section ${JSON.stringify(reference.section)}, subsection ${
        JSON.stringify(reference.subsection)
      }`;
    const context = reference.context === undefined
      ? ""
      : ` with context ${JSON.stringify(reference.context)}`;
    throw new Error(
      `${label}.entry ${JSON.stringify(reference.entry)}${context} does not exist in ${scope} of ${
        JSON.stringify(reference.artifact)
      }`,
    );
  }
  if (matchingEntryCount > 1) {
    const scope = reference.subsection === undefined
      ? `section ${JSON.stringify(reference.section)}`
      : `section ${JSON.stringify(reference.section)}, subsection ${
        JSON.stringify(reference.subsection)
      }`;
    const context = reference.context === undefined
      ? ""
      : ` with context ${JSON.stringify(reference.context)}`;
    throw new Error(
      `${label}.entry ${
        JSON.stringify(reference.entry)
      }${context} is ambiguous: it appears ${matchingEntryCount} times in ${scope} of ${
        JSON.stringify(reference.artifact)
      }`,
    );
  }
}

async function validateKnownFailureReferences(fixtures: readonly EvalFixture[]): Promise<void> {
  const packageDirectory = path.resolve(import.meta.dirname!, "..");
  const markdownByArtifact = new Map<string, string>();
  for (const fixture of fixtures) {
    const reference = fixture.provenance.knownFailure;
    if (reference === undefined) continue;
    if (path.isAbsolute(reference.artifact)) {
      throw new Error(
        `${fixture.id}.provenance.knownFailure.artifact must be relative to card_field_generation_evals`,
      );
    }
    const artifactPath = path.resolve(packageDirectory, reference.artifact);
    const relativeArtifactPath = path.relative(packageDirectory, artifactPath);
    if (
      relativeArtifactPath === ".." ||
      relativeArtifactPath.startsWith(`..${path.SEPARATOR}`)
    ) {
      throw new Error(
        `${fixture.id}.provenance.knownFailure.artifact must stay within card_field_generation_evals`,
      );
    }
    let markdown = markdownByArtifact.get(reference.artifact);
    if (markdown === undefined) {
      try {
        markdown = await Deno.readTextFile(artifactPath);
      } catch (error) {
        throw new Error(
          `${fixture.id}.provenance.knownFailure.artifact ${
            JSON.stringify(reference.artifact)
          } could not be read`,
          { cause: error },
        );
      }
      markdownByArtifact.set(reference.artifact, markdown);
    }
    validateKnownFailureReference(reference, markdown, fixture.id);
  }
}

/** Loads and validates every tracked operation-specific fixture. */
export async function loadEvalFixtures(
  casesDirectory = path.resolve(import.meta.dirname!, "../cases"),
): Promise<EvalFixture[]> {
  const senseFile = senseSelectionFileSchema.parse(
    await readJSON(path.join(casesDirectory, "sense_selection.json")),
  );
  const hintFile = hintFileSchema.parse(
    await readJSON(path.join(casesDirectory, "hint.json")),
  );
  const readingFile = readingSelectionFileSchema.parse(
    await readJSON(path.join(casesDirectory, "reading_selection.json")),
  );
  const contextMinimizationFile = contextMinimizationFileSchema.parse(
    await readJSON(path.join(casesDirectory, "minimization.json")),
  );
  const fixtures: EvalFixture[] = [
    ...contextMinimizationFile.cases.map(
      (fixture): ContextMinimizationFixture => ({
        ...fixture,
        operation: "context-minimization",
      }),
    ),
    ...senseFile.cases.map((fixture): SenseSelectionFixture => ({
      ...fixture,
      operation: "sense-selection",
    })),
    ...readingFile.cases.map((fixture): ReadingSelectionFixture => ({
      ...fixture,
      operation: "reading-selection",
    })),
    ...hintFile.cases.map((fixture): HintFixture => ({
      ...fixture,
      operation: "hint",
    })),
  ];
  const duplicateIds = fixtures.filter((fixture, index) =>
    fixtures.findIndex((candidate) => candidate.id === fixture.id) !== index
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `Eval fixture IDs must be globally unique; duplicated: ${
        [...new Set(duplicateIds.map(({ id }) => id))].join(", ")
      }`,
    );
  }
  for (const fixture of fixtures) {
    if (fixture.operation === "context-minimization") {
      validateContextMinimizationFixture(fixture);
    } else if (fixture.operation === "hint") {
      validateHintFixture(fixture);
    } else if (fixture.operation === "reading-selection") {
      validateReadingFixture(fixture);
    } else {
      validateSenseFixture(fixture);
    }
  }
  await validateKnownFailureReferences(fixtures);
  return fixtures.sort((left, right) =>
    left.operation.localeCompare(right.operation) ||
    left.id.localeCompare(right.id)
  );
}

/** Collects the sorted JMDict entry IDs required by already-validated eval fixtures. */
export function jmdictEntryIdsForEvalFixtures(fixtures: readonly EvalFixture[]): string[] {
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (fixture.operation === "sense-selection") {
      ids.add(fixture.input.jmdictId);
    } else if (fixture.operation === "reading-selection") {
      ids.add(fixture.input.jmdictId);
    } else if (fixture.operation === "hint") {
      ids.add(fixture.input.selectedUsage.jmdictId);
      for (const usage of fixture.input.contrastingUsages) ids.add(usage.jmdictId);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}
