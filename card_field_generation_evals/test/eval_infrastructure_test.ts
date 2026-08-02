import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  contextMinimizationPromptFixtureSignature,
  contextMinimizationPromptOutputSignature,
  hintPromptFixtureSignature,
  hintPromptOutputSignature,
  PROMPT_FEW_SHOT_FIXTURE_LINKS,
  promptFixtureSurfaceText,
  promptJMDictEntry,
  promptJMDictProjectionSignature,
  senseSelectionPromptFixtureSignature,
  senseSelectionPromptOutputSignature,
} from "card_field_generation/eval-metadata";
import { markedContextTextTemplate, renderMinimizedContextText } from "card_resolution";
import { preextractedJMDictEntry } from "data";
import {
  assertEvalSpendingApproved,
  MAX_CACHE_USING_PROVIDER_ATTEMPTS,
  MAX_CACHE_USING_PROVIDER_CALL_SLOTS,
  MAX_UNCACHED_PROVIDER_ATTEMPTS,
  MAX_UNCACHED_PROVIDER_CALL_SLOTS,
  parseEvalCacheMode,
} from "../src/cli.ts";
import {
  jmdictEntryIdsForEvalFixtures,
  loadEvalFixtures,
  validateKnownFailureReference,
} from "../src/fixtures.ts";
import { assertEvalFixtureGenerationInputs } from "../src/generation_inputs.ts";
import { renderMarkdownReport } from "../src/report.ts";
import {
  COST_ESTIMATE_DISCLAIMER,
  PRICING_AS_OF,
  PRICING_SOURCE_URLS,
  totalEstimatedUSDCost,
} from "../src/pricing.ts";
import {
  scoreContextMinimization,
  scoreHint,
  scoreSenseSelection,
  summarizeResults,
} from "../src/scoring.ts";
import { selectFixtures, selectSampleCases } from "../src/selection.ts";
import type {
  ContextMinimizationFixture,
  EvalCaseResult,
  EvalFixture,
  EvalReferenceBasis,
  EvalRun,
  HintFixture,
  SenseSelectionFixture,
} from "../src/types.ts";

const PROVENANCE = {
  corpus: "test",
  sourceNoteId: 1,
  artifact: "test.json",
};

function expectedOutcomeStratum(fixture: EvalFixture): string {
  if (fixture.operation === "context-minimization" || fixture.operation === "hint") {
    return fixture.expected.disposition;
  }
  if (fixture.expected.outcome.outcome !== "selected") {
    return fixture.expected.outcome.outcome;
  }
  return fixture.expected.outcome.senseNumbers.length ===
      fixture.input.compatibleSenseNumbers.length
    ? "selected-all"
    : "selected-subset";
}

function hintFixture(): HintFixture {
  return {
    operation: "hint",
    id: "hint-case",
    provenance: PROVENANCE,
    evaluation: { promptOverlap: false, referenceBasis: "agent-reviewed" },
    input: {
      context: "会社の<mark>方針</mark>を決めた。",
      recognitionTarget: "方針",
      selectedUsage: { jmdictId: "1", senseNumbers: [1] },
      contrastingUsages: [{ jmdictId: "1", senseNumbers: [2] }],
    },
    expected: {
      disposition: "generated",
      preferredHints: ["会社の方針"],
      acceptableHints: ["会社で方針を決める"],
      observedBadHints: ["経営方針"],
      rubricNotes: ["Stay grounded."],
    },
  };
}

function senseFixture(): SenseSelectionFixture {
  return {
    operation: "sense-selection",
    id: "sense-case",
    provenance: PROVENANCE,
    evaluation: { promptOverlap: false, referenceBasis: "agent-reviewed" },
    input: {
      context: "文脈。",
      recognitionTarget: "対象",
      jmdictId: "1",
      compatibleSenseNumbers: [1, 2, 3],
    },
    expected: {
      outcome: { outcome: "selected", senseNumbers: [1, 3] },
    },
  };
}

function minimizationFixture(): ContextMinimizationFixture {
  return {
    operation: "context-minimization",
    id: "minimization-case",
    provenance: PROVENANCE,
    evaluation: { promptOverlap: false, referenceBasis: "agent-reviewed" },
    input: { fullContext: "長い前置きのあとで、<mark>対象</mark>を選んだ。" },
    expected: {
      disposition: "minimize",
      acceptableMinimizedContexts: ["<mark>対象</mark>を選んだ。"],
      observedBadMinimizedContexts: ["前置きを捏造して<mark>対象</mark>を選んだ。"],
      rubricNotes: ["Drop the preface."],
    },
  };
}

function contextSubstrings(text: string, length: number): string[] {
  const normalizedText = promptFixtureSurfaceText(text);
  if (length > normalizedText.length) return [];
  return Array.from(
    { length: normalizedText.length - length + 1 },
    (_, index) => normalizedText.slice(index, index + length),
  );
}

function assertIncludesSignature(
  actualSignatures: readonly string[],
  expectedSignature: string,
  message: string,
): void {
  assert(
    actualSignatures.includes(expectedSignature),
    `${message}: ${expectedSignature} is not among ${JSON.stringify(actualSignatures)}`,
  );
}

function isOrderedSemanticSubset(subset: unknown, complete: unknown): boolean {
  if (Array.isArray(subset)) {
    if (!Array.isArray(complete)) return false;
    let completeIndex = 0;
    for (const subsetValue of subset) {
      while (
        completeIndex < complete.length &&
        !isOrderedSemanticSubset(subsetValue, complete[completeIndex])
      ) {
        ++completeIndex;
      }
      if (completeIndex === complete.length) return false;
      ++completeIndex;
    }
    return true;
  }
  if (subset !== null && typeof subset === "object") {
    if (complete === null || typeof complete !== "object" || Array.isArray(complete)) return false;
    const completeRecord = complete as Record<string, unknown>;
    return Object.entries(subset).every(([key, value]) =>
      Object.hasOwn(completeRecord, key) && isOrderedSemanticSubset(value, completeRecord[key])
    );
  }
  return Object.is(subset, complete);
}

function assertSemanticSubset(subset: unknown, complete: unknown, message: string): void {
  assert(
    isOrderedSemanticSubset(subset, complete),
    `${message}: prompt projection ${JSON.stringify(subset)} is not an ordered semantic subset of ${
      JSON.stringify(complete)
    }`,
  );
}

Deno.test("CLI cache mode accepts every policy, defaults to use, and rejects unknown modes", () => {
  assertEquals(parseEvalCacheMode(undefined), "use");
  assertEquals(parseEvalCacheMode("use"), "use");
  assertEquals(parseEvalCacheMode("refresh"), "refresh");
  assertEquals(parseEvalCacheMode("bypass"), "bypass");
  assertThrows(
    () => parseEvalCacheMode("stale"),
    Error,
    'Unknown cache mode "stale"; expected use, refresh, bypass',
  );
});

Deno.test("CLI spending guard permits ordinary cached and focused uncached plans", () => {
  assertEvalSpendingApproved({
    providerCallSlots: MAX_CACHE_USING_PROVIDER_CALL_SLOTS,
    maxAttempts: 3,
    cacheMode: "use",
    dryRun: false,
    allowExpensiveRun: false,
  });
  for (const cacheMode of ["refresh", "bypass"] as const) {
    assertEvalSpendingApproved({
      providerCallSlots: MAX_UNCACHED_PROVIDER_CALL_SLOTS,
      maxAttempts: 3,
      cacheMode,
      dryRun: false,
      allowExpensiveRun: false,
    });
  }
});

Deno.test("CLI spending guard rejects broad paid plans with actionable guidance", () => {
  assertThrows(
    () =>
      assertEvalSpendingApproved({
        providerCallSlots: MAX_CACHE_USING_PROVIDER_CALL_SLOTS + 1,
        maxAttempts: 1,
        cacheMode: "use",
        dryRun: false,
        allowExpensiveRun: false,
      }),
    Error,
    `Refusing ${
      MAX_CACHE_USING_PROVIDER_CALL_SLOTS + 1
    } model/case provider-call slots without explicit spending approval; the limit for cache mode "use" is ${MAX_CACHE_USING_PROVIDER_CALL_SLOTS}. A cold cache can still make every selected slot a paid provider call.`,
  );
  assertThrows(
    () =>
      assertEvalSpendingApproved({
        providerCallSlots: MAX_UNCACHED_PROVIDER_CALL_SLOTS + 1,
        maxAttempts: 1,
        cacheMode: "refresh",
        dryRun: false,
        allowExpensiveRun: false,
      }),
    Error,
    `Refusing ${
      MAX_UNCACHED_PROVIDER_CALL_SLOTS + 1
    } model/case provider-call slots without explicit spending approval; the limit for cache mode "refresh" is ${MAX_UNCACHED_PROVIDER_CALL_SLOTS}. Cache mode "refresh" necessarily calls a provider for every selected slot.`,
  );
  assertThrows(
    () =>
      assertEvalSpendingApproved({
        providerCallSlots: 1,
        maxAttempts: MAX_UNCACHED_PROVIDER_ATTEMPTS + 1,
        cacheMode: "bypass",
        dryRun: false,
        allowExpensiveRun: false,
      }),
    Error,
    `Refusing up to ${MAX_UNCACHED_PROVIDER_ATTEMPTS + 1} provider attempts (1 model/case slots × ${
      MAX_UNCACHED_PROVIDER_ATTEMPTS + 1
    } corrective attempts) without explicit spending approval`,
  );
  assertThrows(
    () =>
      assertEvalSpendingApproved({
        providerCallSlots: 1,
        maxAttempts: MAX_CACHE_USING_PROVIDER_ATTEMPTS + 1,
        cacheMode: "use",
        dryRun: false,
        allowExpensiveRun: false,
      }),
    Error,
    `Refusing up to ${
      MAX_CACHE_USING_PROVIDER_ATTEMPTS + 1
    } provider attempts (1 model/case slots × ${
      MAX_CACHE_USING_PROVIDER_ATTEMPTS + 1
    } corrective attempts) without explicit spending approval`,
  );
});

Deno.test("CLI spending guard always permits dry runs and explicit approval", () => {
  assertEvalSpendingApproved({
    providerCallSlots: 10_000,
    maxAttempts: 10_000,
    cacheMode: "bypass",
    dryRun: true,
    allowExpensiveRun: false,
  });
  assertEvalSpendingApproved({
    providerCallSlots: 10_000,
    maxAttempts: 10_000,
    cacheMode: "refresh",
    dryRun: false,
    allowExpensiveRun: true,
  });
});

Deno.test("tracked eval fixtures are complete and prompt overlaps are explicit", async () => {
  const fixtures = await loadEvalFixtures();
  assertEquals(fixtures.length, 242);
  assertEquals(
    fixtures.filter(({ operation }) => operation === "context-minimization").length,
    55,
  );
  assertEquals(
    fixtures.filter(({ operation }) => operation === "hint").length,
    94,
  );
  assertEquals(
    fixtures.filter(({ operation }) => operation === "sense-selection").length,
    93,
  );
  assert(
    fixtures.some((fixture) =>
      fixture.operation === "sense-selection" &&
      fixture.expected.outcome.outcome === "no-match" &&
      !fixture.evaluation.promptOverlap &&
      fixture.evaluation.referenceBasis === "user-reviewed"
    ),
    "sense selection must retain a user-reviewed no-match case outside the prompt examples",
  );
  // Derive overlap accounting from the production prompts. Prompt examples may simplify their
  // source fixtures, but changing which fixtures they derive from must update the annotations.
  const operations = ["context-minimization", "hint", "sense-selection"] as const;
  const expectedOverlaps = Object.fromEntries(
    operations.map((operation) => {
      const fixtureIds = PROMPT_FEW_SHOT_FIXTURE_LINKS[operation].map(({ fixtureId }) => fixtureId)
        .sort();
      assertEquals(new Set(fixtureIds).size, fixtureIds.length);
      return [operation, fixtureIds];
    }),
  );
  assertEquals(
    Object.fromEntries(
      operations.map((operation) => [
        operation,
        fixtures.filter((fixture) =>
          fixture.operation === operation && fixture.evaluation.promptOverlap
        )
          .map(({ id }) => id)
          .sort(),
      ]),
    ),
    expectedOverlaps,
  );
  for (const operation of operations) {
    for (const link of PROMPT_FEW_SHOT_FIXTURE_LINKS[operation]) {
      const fixture = fixtures.find((candidate) =>
        candidate.operation === operation && candidate.id === link.fixtureId
      );
      assert(fixture !== undefined, `${operation} prompt fixture ${link.fixtureId} is missing`);
      const label = `${operation} ${link.fixtureId}`;
      assert(
        fixture.evaluation.referenceBasis === "agent-reviewed" ||
          fixture.evaluation.referenceBasis === "user-reviewed",
        `${label} must be explicitly curated before teaching the production model`,
      );
      if (fixture.operation === "context-minimization") {
        const fixtureContext = markedContextTextTemplate(fixture.input.fullContext).text;
        assertIncludesSignature(
          contextSubstrings(fixtureContext, link.contextLength).map(
            contextMinimizationPromptFixtureSignature,
          ),
          link.inputSignature,
          `${label} prompt context must be a source-exact fixture excerpt`,
        );
        const acceptableOutputs = fixture.expected.disposition === "keep-full-context"
          ? [contextMinimizationPromptOutputSignature(null)]
          : fixture.expected.acceptableMinimizedContexts.map((context) =>
            contextMinimizationPromptOutputSignature(markedContextTextTemplate(context).text)
          );
        assertIncludesSignature(
          acceptableOutputs,
          link.outputSignature,
          `${label} prompt output must be an accepted fixture result`,
        );
      } else if (fixture.operation === "hint") {
        const fixtureContext = markedContextTextTemplate(fixture.input.context).text;
        assertIncludesSignature(
          contextSubstrings(fixtureContext, link.contextLength).map((context) =>
            hintPromptFixtureSignature({
              recognitionTarget: fixture.input.recognitionTarget,
              context,
              selectedUsage: fixture.input.selectedUsage,
            })
          ),
          link.inputSignature,
          `${label} prompt context and selected usage must derive from the fixture`,
        );
        const acceptableOutputs = fixture.expected.disposition === "generated"
          ? fixture.expected.preferredHints.map((hint) =>
            hintPromptOutputSignature({ disposition: "generated", hint })
          )
          : [hintPromptOutputSignature({ disposition: fixture.expected.disposition })];
        assertIncludesSignature(
          acceptableOutputs,
          link.outputSignature,
          `${label} prompt output must be an accepted fixture result`,
        );

        const selectedEntry = await preextractedJMDictEntry(
          fixture.input.selectedUsage.jmdictId,
        );
        assert(
          link.selectedJMDictProjection !== undefined,
          `${label} selected projection is missing`,
        );
        assertEquals(
          link.selectedJMDictProjectionSignature,
          promptJMDictProjectionSignature(link.selectedJMDictProjection),
          `${label} selected JMDict projection signature`,
        );
        assertSemanticSubset(
          link.selectedJMDictProjection,
          await promptJMDictEntry(selectedEntry, fixture.input.selectedUsage.senseNumbers),
          `${label} selected JMDict projection`,
        );
        const fixtureContrastProjections = await Promise.all(
          fixture.input.contrastingUsages.map(async (usage) =>
            promptJMDictEntry(
              await preextractedJMDictEntry(usage.jmdictId),
              usage.senseNumbers,
            )
          ),
        );
        const promptContrastProjections = link.contrastingJMDictProjections ?? [];
        const promptContrastSignatures = link.contrastingJMDictProjectionSignatures ?? [];
        assertEquals(
          promptContrastSignatures.length,
          promptContrastProjections.length,
          `${label} contrasting projection signature count`,
        );
        for (const [index, projection] of promptContrastProjections.entries()) {
          assertEquals(
            promptContrastSignatures[index],
            promptJMDictProjectionSignature(projection),
            `${label} contrasting JMDict projection ${index} signature`,
          );
          assert(
            fixtureContrastProjections.some((fixtureProjection) =>
              isOrderedSemanticSubset(projection, fixtureProjection)
            ),
            `${label} contrasting JMDict projection ${
              JSON.stringify(projection)
            } must be an ordered semantic subset of a fixture contrast`,
          );
        }
      } else {
        const fixtureContext = markedContextTextTemplate(fixture.input.context).text;
        assertIncludesSignature(
          contextSubstrings(fixtureContext, link.contextLength).map((context) =>
            senseSelectionPromptFixtureSignature({
              recognitionTarget: fixture.input.recognitionTarget,
              context,
              jmdictId: fixture.input.jmdictId,
              compatibleSenseNumbers: fixture.input.compatibleSenseNumbers,
            })
          ),
          link.inputSignature,
          `${label} prompt context and JMDict identity must derive from the fixture`,
        );
        assertEquals(
          link.outputSignature,
          senseSelectionPromptOutputSignature(fixture.expected.outcome),
          `${label} prompt outcome`,
        );
        const entry = await preextractedJMDictEntry(fixture.input.jmdictId);
        assert(
          link.selectedJMDictProjection !== undefined,
          `${label} selected projection is missing`,
        );
        assertEquals(
          link.selectedJMDictProjectionSignature,
          promptJMDictProjectionSignature(link.selectedJMDictProjection),
          `${label} compatible JMDict projection signature`,
        );
        assertSemanticSubset(
          link.selectedJMDictProjection,
          await promptJMDictEntry(entry, fixture.input.compatibleSenseNumbers),
          `${label} compatible JMDict projection`,
        );
      }
    }
  }
  const provisionalSenseFixtures = fixtures.filter((fixture) =>
    fixture.operation === "sense-selection" &&
    fixture.evaluation.referenceBasis === "provisional"
  );
  assert(provisionalSenseFixtures.length > 0);
  assert(
    provisionalSenseFixtures.some((fixture) =>
      fixture.operation === "sense-selection" &&
      fixture.expected.outcome.outcome === "ambiguous"
    ),
  );
  assert(
    fixtures.every((fixture) =>
      fixture.operation !== "hint" || fixture.input.contrastingUsages.length > 0
    ),
  );

  const multipleSenseSubset = fixtures.find(({ id }) =>
    id === "design-見込み-multiple-sense-subset"
  );
  assert(multipleSenseSubset?.operation === "sense-selection");
  assertEquals(multipleSenseSubset.input.compatibleSenseNumbers, [1, 2, 3]);
  assertEquals(multipleSenseSubset.expected.outcome, {
    outcome: "selected",
    senseNumbers: [1, 2],
  });
  assertEquals(multipleSenseSubset.evaluation.referenceBasis, "agent-reviewed");
});

Deno.test("eval-owned JMDict entry manifest stays synchronized with validated fixtures", async () => {
  const fixtures = await loadEvalFixtures();
  const manifest = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../data/resources/jmdict/card_field_generation_eval_entry_ids.json",
        import.meta.url,
      ),
    ),
  );
  assertEquals(manifest, jmdictEntryIdsForEvalFixtures(fixtures));
});

Deno.test("tracked eval fixtures pass production input validation without provider calls", async () => {
  const fixtures = await loadEvalFixtures();
  await assertEvalFixtureGenerationInputs(fixtures);

  const fixture = fixtures.find(({ id }) => id === "animecards-focused-1734611363834");
  assert(fixture?.operation === "sense-selection");
  const invalid = structuredClone(fixture);
  invalid.input.context = "犬";
  await assertRejects(
    () => assertEvalFixtureGenerationInputs([invalid]),
    Error,
    'sense-selection eval fixture "animecards-focused-1734611363834" has invalid generation input',
  );
});

Deno.test("known-failure provenance names a checked archived heading and table entry", async () => {
  const fixtures = await loadEvalFixtures();
  const references = fixtures.flatMap(({ provenance }) =>
    provenance.knownFailure === undefined ? [] : [provenance.knownFailure]
  );
  assertEquals(references.length, 68);
  assertEquals(
    new Set(references.map(({ artifact }) => artifact)),
    new Set(["archive/card_creator_evals/KNOWN_FAILURES.md"]),
  );

  const markdown = [
    "## Section",
    "",
    "| Target | Issue |",
    "| --- | --- |",
    "| broad | failure |",
    "",
    "### Subsection",
    "",
    "| Target | Issue |",
    "| --- | --- |",
    "| specific | failure |",
  ].join("\n");
  const baseReference = {
    artifact: "archive/example.md",
    section: "Section",
    entry: "broad",
  };
  validateKnownFailureReference(baseReference, markdown, "fixture");
  validateKnownFailureReference(
    { ...baseReference, subsection: "Subsection", entry: "specific" },
    markdown,
    "fixture",
  );
  assertThrows(
    () =>
      validateKnownFailureReference(
        { ...baseReference, section: "Missing" },
        markdown,
        "fixture",
      ),
    Error,
    'fixture.provenance.knownFailure.section "Missing" does not exist',
  );
  assertThrows(
    () =>
      validateKnownFailureReference(
        { ...baseReference, subsection: "Missing" },
        markdown,
        "fixture",
      ),
    Error,
    'fixture.provenance.knownFailure.subsection "Missing" does not exist under section "Section"',
  );
  assertThrows(
    () =>
      validateKnownFailureReference(
        { ...baseReference, entry: "missing" },
        markdown,
        "fixture",
      ),
    Error,
    'fixture.provenance.knownFailure.entry "missing" does not exist in section "Section"',
  );

  const duplicateMarkdown = [
    markdown,
    "",
    "### Another subsection",
    "",
    "| Target | Issue |",
    "| --- | --- |",
    "| broad | another failure |",
  ].join("\n");
  assertThrows(
    () => validateKnownFailureReference(baseReference, duplicateMarkdown, "fixture"),
    Error,
    'fixture.provenance.knownFailure.entry "broad" is ambiguous: it appears 2 times in section "Section"',
  );
  validateKnownFailureReference(
    { ...baseReference, context: "failure" },
    duplicateMarkdown,
    "fixture",
  );
});

Deno.test("positive hint fixtures do not invent observed failures", async () => {
  const fixture = (await loadEvalFixtures()).find(({ id }) =>
    id === "surfacepro11-live-1703038518657-牛"
  );
  assert(fixture?.operation === "hint");
  assertEquals(fixture.expected.disposition, "generated");
  assert(fixture.expected.preferredHints.includes("温和な牛"));
  assertEquals(fixture.expected.observedBadHints, []);
});

Deno.test("hint references never classify one output as both preferred and observed bad", async () => {
  const fixtures = (await loadEvalFixtures()).filter((fixture) => fixture.operation === "hint");
  for (const fixture of fixtures) {
    assertEquals(
      fixture.expected.preferredHints.filter((hint) =>
        fixture.expected.observedBadHints.includes(hint)
      ),
      [],
      fixture.id,
    );
  }
});

Deno.test("minimization references satisfy the deterministic context boundary", async () => {
  const fixtures = (await loadEvalFixtures()).filter((fixture) =>
    fixture.operation === "context-minimization"
  );
  assertEquals(
    fixtures.filter(({ expected }) => expected.disposition === "minimize").length,
    40,
  );
  assertEquals(
    fixtures.filter(({ expected }) => expected.disposition === "keep-full-context").length,
    15,
  );

  for (const fixture of fixtures) {
    const fullTemplate = markedContextTextTemplate(fixture.input.fullContext);
    for (const reference of fixture.expected.acceptableMinimizedContexts) {
      const rawReference = markedContextTextTemplate(reference).text;
      assertEquals(
        renderMinimizedContextText(fullTemplate, rawReference),
        reference,
        fixture.id,
      );
    }
  }
});

Deno.test("curated minimization fixtures preserve antecedents and complete comparisons", async () => {
  const fixtures = await loadEvalFixtures();
  const fixture = (id: string) => {
    const match = fixtures.find((candidate) => candidate.id === id);
    assert(match?.operation === "context-minimization");
    return match;
  };

  assertEquals(fixture("live-context-1740391568555-艘").expected.disposition, "keep-full-context");
  assertStringIncludes(
    fixture("live-context-1739082506679-境目").expected.acceptableMinimizedContexts[0],
    "「彼とは本当の友だちになったのですか？　それともあくまで演技だったんですか？」",
  );
  assertStringIncludes(
    fixture("live-context-1740803371826-何かの拍子").expected.acceptableMinimizedContexts[0],
    "前世のほんの一部",
  );
  assertStringIncludes(
    fixture("live-context-1737981970795-しっくり来る").expected.acceptableMinimizedContexts[0],
    "何となく納得できない",
  );
  assertEquals(
    fixture("historical-context-ベタ惚れ").expected.acceptableMinimizedContexts,
    [
      "匠くんは美晴に<mark>ベタ惚れ</mark>だった。",
      "美晴に<mark>ベタ惚れ</mark>だった。",
      "匠くんは、美晴に<mark>ベタ惚れ</mark>だった。",
    ],
  );
});

Deno.test("sample selection is stable and stratified without prompt overlaps", async () => {
  const fixtures = await loadEvalFixtures();
  const first = selectSampleCases(fixtures, 8, "sample-v1");
  const repeated = selectSampleCases(fixtures, 8, "sample-v1");
  const differentSeed = selectSampleCases(fixtures, 8, "another-seed");

  assertEquals(first.map(({ id }) => id), repeated.map(({ id }) => id));
  assertNotEquals(first.map(({ id }) => id), differentSeed.map(({ id }) => id));
  assertEquals(first.length, 8);
  const operationCounts = ["context-minimization", "hint", "sense-selection"].map(
    (operation) => first.filter((fixture) => fixture.operation === operation).length,
  );
  assert(
    Math.max(...operationCounts) - Math.min(...operationCounts) <= 1,
    `sample operation counts must differ by at most one; received ${operationCounts.join(", ")}`,
  );
  for (const operation of ["context-minimization", "hint", "sense-selection"] as const) {
    const selectedForOperation = first.filter((fixture) => fixture.operation === operation);
    const availableStrata = new Set(
      fixtures.filter((fixture) =>
        fixture.operation === operation && !fixture.evaluation.promptOverlap
      ).map(expectedOutcomeStratum),
    );
    const selectedStrata = new Set(selectedForOperation.map(expectedOutcomeStratum));
    assertEquals(
      selectedStrata.size,
      Math.min(selectedForOperation.length, availableStrata.size),
      `${operation} should cover each available outcome before repeating one`,
    );
  }
  assert(first.every(({ evaluation }) => !evaluation.promptOverlap));

  const developmentSample = selectSampleCases(fixtures, 30, "sample-v1");
  const authority = {
    "user-reviewed": 0,
    "agent-reviewed": 1,
    "corpus-replay": 2,
    provisional: 3,
  } as const;
  const selectedIds = new Set(developmentSample.map(({ id }) => id));
  for (const selected of developmentSample) {
    const moreAuthoritativePeers = fixtures.filter((candidate) =>
      !candidate.evaluation.promptOverlap &&
      candidate.operation === selected.operation &&
      expectedOutcomeStratum(candidate) === expectedOutcomeStratum(selected) &&
      authority[candidate.evaluation.referenceBasis] <
        authority[selected.evaluation.referenceBasis]
    );
    assert(
      moreAuthoritativePeers.every(({ id }) => selectedIds.has(id)),
      `${selected.id} must not crowd a more authoritative fixture out of its operation/outcome stratum`,
    );
  }
});

Deno.test("explicit case filters retain prompt-overlap fixtures when sampling is omitted", async () => {
  const fixtures = await loadEvalFixtures();
  const selected = selectFixtures(
    fixtures,
    ["hint"],
    ["animecards-1768115818658-沽券"],
    undefined,
    "unused",
  );

  assertEquals(selected.length, 1);
  assertEquals(selected[0].id, "animecards-1768115818658-沽券");
  assert(selected[0].evaluation.promptOverlap);
});

Deno.test("operation scores preserve exact decisions without overfitting text references", () => {
  assertEquals(
    scoreSenseSelection(senseFixture(), { outcome: "selected", senseNumbers: [3, 1] }),
    {
      kind: "sense-selection",
      exactMatch: true,
    },
  );
  assertEquals(scoreSenseSelection(senseFixture(), { outcome: "no-match" }), {
    kind: "sense-selection",
    exactMatch: false,
  });
  assertEquals(
    scoreHint(hintFixture(), {
      outcome: "generated",
      semanticEvidenceSpan: "会社の方針",
      hintSourceSpan: "会社の方針",
      hint: "会社の方針",
    }),
    {
      kind: "hint",
      disposition: "preferred",
      dispositionMatchesReference: true,
      preferredExactMatch: true,
      acceptableExactMatch: false,
      observedBadExactMatch: false,
      hintCharacterCount: 5,
      hintLengthDelta: 3,
    },
  );
  assertEquals(
    scoreHint(hintFixture(), {
      outcome: "generated",
      semanticEvidenceSpan: "会社で方針を決める",
      hintSourceSpan: "会社で方針を決める",
      hint: "会社で方針を決める",
    }),
    {
      kind: "hint",
      disposition: "acceptable",
      dispositionMatchesReference: true,
      preferredExactMatch: false,
      acceptableExactMatch: true,
      observedBadExactMatch: false,
      hintCharacterCount: 9,
      hintLengthDelta: 7,
    },
  );
  const noHintFixture = hintFixture();
  noHintFixture.expected = {
    disposition: "not-needed",
    preferredHints: [],
    acceptableHints: [],
    observedBadHints: [],
    rubricNotes: ["No semantic contrast."],
  };
  assertEquals(scoreHint(noHintFixture, { outcome: "not-needed" }), {
    kind: "hint",
    disposition: "not-needed",
    dispositionMatchesReference: true,
    preferredExactMatch: false,
    acceptableExactMatch: false,
    observedBadExactMatch: false,
    hintCharacterCount: null,
    hintLengthDelta: null,
  });
  assertEquals(scoreHint(noHintFixture, { outcome: "source-insufficient" }), {
    kind: "hint",
    disposition: "reference-disposition-mismatch",
    dispositionMatchesReference: false,
    preferredExactMatch: false,
    acceptableExactMatch: false,
    observedBadExactMatch: false,
    hintCharacterCount: null,
    hintLengthDelta: null,
  });
  const insufficientFixture = hintFixture();
  insufficientFixture.expected = {
    disposition: "source-insufficient",
    preferredHints: [],
    acceptableHints: [],
    observedBadHints: [],
    rubricNotes: ["The context does not support a distinction."],
  };
  assertEquals(scoreHint(insufficientFixture, { outcome: "source-insufficient" }), {
    kind: "hint",
    disposition: "source-insufficient",
    dispositionMatchesReference: true,
    preferredExactMatch: false,
    acceptableExactMatch: false,
    observedBadExactMatch: false,
    hintCharacterCount: null,
    hintLengthDelta: null,
  });
  assertEquals(
    scoreHint(hintFixture(), {
      outcome: "generated",
      semanticEvidenceSpan: "会社で新しい方針を決める",
      hintSourceSpan: "会社で新しい方針を決める",
      hint: "会社で新しい方針を決める",
    }),
    {
      kind: "hint",
      disposition: "novel",
      dispositionMatchesReference: true,
      preferredExactMatch: false,
      acceptableExactMatch: false,
      observedBadExactMatch: false,
      hintCharacterCount: 12,
      hintLengthDelta: 10,
    },
  );
  assertEquals(
    scoreContextMinimization(minimizationFixture(), "<mark>対象</mark>を選んだ。"),
    {
      kind: "context-minimization",
      disposition: "acceptable-reference",
      dispositionCorrect: true,
      acceptableExactMatch: true,
      observedBadExactMatch: false,
    },
  );
  assertEquals(
    scoreContextMinimization(
      minimizationFixture(),
      "前置きのあとで<mark>対象</mark>を選んだ。",
    ),
    {
      kind: "context-minimization",
      disposition: "novel",
      dispositionCorrect: true,
      acceptableExactMatch: false,
      observedBadExactMatch: false,
    },
  );
  assertEquals(
    scoreContextMinimization(
      minimizationFixture(),
      "前置きを捏造して<mark>対象</mark>を選んだ。",
    ),
    {
      kind: "context-minimization",
      disposition: "known-bad",
      dispositionCorrect: true,
      acceptableExactMatch: false,
      observedBadExactMatch: true,
    },
  );
  assertEquals(scoreContextMinimization(minimizationFixture(), null), {
    kind: "context-minimization",
    disposition: "missing",
    dispositionCorrect: false,
    acceptableExactMatch: false,
    observedBadExactMatch: false,
  });

  const keepFullFixture = minimizationFixture();
  keepFullFixture.expected = {
    disposition: "keep-full-context",
    acceptableMinimizedContexts: [],
    observedBadMinimizedContexts: [
      "前置きを捏造して<mark>対象</mark>を選んだ。",
    ],
    rubricNotes: ["Keep the complete context."],
  };
  assertEquals(
    scoreContextMinimization(
      keepFullFixture,
      "前置きを捏造して<mark>対象</mark>を選んだ。",
    ),
    {
      kind: "context-minimization",
      disposition: "known-bad",
      dispositionCorrect: false,
      acceptableExactMatch: false,
      observedBadExactMatch: true,
    },
  );
});

function successfulNovelHintResult(): Extract<EvalCaseResult, { status: "success" }> {
  const fixture = hintFixture();
  const value = {
    outcome: "generated" as const,
    semanticEvidenceSpan: "会社で新しい方針を決める",
    hintSourceSpan: "会社で新しい方針を決める",
    hint: "会社で新しい方針を決める",
  };
  const usage = {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  return {
    status: "success",
    operation: "hint",
    caseId: fixture.id,
    fixtureHash: "fixture-hint-case",
    fixtureEvaluation: fixture.evaluation,
    provenance: fixture.provenance,
    input: fixture.input,
    expected: fixture.expected,
    modelId: "gemini-3.6-flash",
    reasoningEffort: "low",
    startedAt: "2026-01-01T00:00:00.000Z",
    latencyMilliseconds: 10,
    attempts: [],
    usage,
    value,
    outputHash: "output-hint-case",
    score: scoreHint(fixture, value),
    generation: {
      operation: "hint",
      cacheKey: "hint-case",
      cacheStatus: "hit",
      modelConfigurationId: "gemini-3.6-flash@low",
      attempts: [],
      latencyMilliseconds: 10,
      usage,
      sourceUsage: usage,
      fingerprints: {
        basePrompt: "prompt-hint-case",
        stablePrompt: "stable-prompt-hint-case",
        schema: "schema-hint-case",
        configuration: "configuration-hint-case",
      },
    },
  };
}

Deno.test("hint reports measure reference agreement and require review of novel wording", () => {
  const result = successfulNovelHintResult();
  result.provenance = {
    ...result.provenance,
    knownFailure: {
      artifact: "archive/card_creator_evals/KNOWN_FAILURES.md",
      section: "Exposure migration",
      entry: "移転",
    },
  };
  const userReviewedResult = structuredClone(result);
  userReviewedResult.caseId = "user-reviewed-hint-case";
  userReviewedResult.fixtureEvaluation.referenceBasis = "user-reviewed";
  userReviewedResult.fixtureHash = "user-reviewed-hint-fixture";
  userReviewedResult.outputHash = "user-reviewed-hint-output";
  userReviewedResult.generation.cacheKey = "user-reviewed-hint-request";
  const results = [result, userReviewedResult];
  const summaries = summarizeResults(results);
  assertEquals(summaries[0].hint, {
    cohorts: {
      userReviewed: {
        caseCount: 1,
        referenceDispositionAgreementCount: 1,
        preferredCount: 0,
        acceptableCount: 0,
        knownBadCount: 0,
        novelCount: 1,
        notNeededCount: 0,
        sourceInsufficientCount: 0,
        referenceDispositionMismatchCount: 0,
        overSixHintLengthDeltaCount: 1,
        overTwelveHintLengthDeltaCount: 0,
      },
      agentReviewed: {
        caseCount: 1,
        referenceDispositionAgreementCount: 1,
        preferredCount: 0,
        acceptableCount: 0,
        knownBadCount: 0,
        novelCount: 1,
        notNeededCount: 0,
        sourceInsufficientCount: 0,
        referenceDispositionMismatchCount: 0,
        overSixHintLengthDeltaCount: 1,
        overTwelveHintLengthDeltaCount: 0,
      },
      corpusReplay: {
        caseCount: 0,
        referenceDispositionAgreementCount: 0,
        preferredCount: 0,
        acceptableCount: 0,
        knownBadCount: 0,
        novelCount: 0,
        notNeededCount: 0,
        sourceInsufficientCount: 0,
        referenceDispositionMismatchCount: 0,
        overSixHintLengthDeltaCount: 0,
        overTwelveHintLengthDeltaCount: 0,
      },
      provisional: {
        caseCount: 0,
        referenceDispositionAgreementCount: 0,
        preferredCount: 0,
        acceptableCount: 0,
        knownBadCount: 0,
        novelCount: 0,
        notNeededCount: 0,
        sourceInsufficientCount: 0,
        referenceDispositionMismatchCount: 0,
        overSixHintLengthDeltaCount: 0,
        overTwelveHintLengthDeltaCount: 0,
      },
    },
  });

  const run: EvalRun = {
    schemaVersion: 1,
    runId: "hint-report-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    configuration: {
      models: [{ modelId: "gemini-3.6-flash", reasoningEffort: "low" }],
      operations: ["hint"],
      requestedCaseFilters: [],
      concurrency: 1,
      maxAttempts: 3,
      cacheMode: "bypass",
    },
    fixtureCounts: {
      available: 2,
      selected: 2,
      selectedPromptOverlaps: 0,
      providerCallSlots: 2,
    },
    reproducibility: {
      hashAlgorithm: "sha-256-canonical-json",
      selectedFixtureSetHash: "hint-fixture-set-hash",
    },
    costEstimate: {
      currency: "USD",
      pricingAsOf: PRICING_AS_OF,
      total: 0,
      sources: PRICING_SOURCE_URLS,
      disclaimer: COST_ESTIMATE_DISCLAIMER,
    },
    summaries,
    results,
  };

  const markdown = renderMarkdownReport(run);
  assertStringIncludes(
    markdown,
    "Agent-reviewed development reference operation-disposition agreement: 1/1",
  );
  assertStringIncludes(markdown, "This is agent judgment, not a user preference judgment");
  assertStringIncludes(
    markdown,
    "User-reviewed development reference operation-disposition agreement: 1/1",
  );
  assertStringIncludes(
    markdown,
    "These visible cases are development evidence, not a blinded holdout",
  );
  assertStringIncludes(markdown, "novel package-validated result(s) requiring qualitative review");
  assertStringIncludes(markdown, "Disposition agreement does not establish hint wording quality");
  assertStringIncludes(markdown, "Novel generated wording still requires qualitative review");
  assertStringIncludes(
    markdown,
    "length diagnostics (not validation): 1 exceed the recognition target by more than 6 Unicode code points; 0 exceed it by more than 12",
  );
  assertStringIncludes(
    markdown,
    "Length diagnostic: 12 Unicode code points, 10 longer than recognitionTarget",
  );
  assertStringIncludes(
    markdown,
    'Claimed semantic evidence span: "会社で新しい方針を決める"',
  );
  assertStringIncludes(
    markdown,
    'Claimed local hint source span: "会社で新しい方針を決める"',
  );
  assertStringIncludes(markdown, "Completed-result cache mode: `bypass`");
  assertStringIncludes(
    markdown,
    'known-failure artifact "archive/card_creator_evals/KNOWN_FAILURES.md", section "Exposure migration", entry "移転"',
  );
  assertEquals(markdown.includes("outcome accuracy"), false);
  assertEquals(markdown.includes("semantic outcome"), false);

  const interruptedMarkdown = renderMarkdownReport({
    ...run,
    interruption: {
      reason: "provider-quota",
      error: { name: "AI_APICallError", message: "quota exhausted" },
      recordedProviderCallSlots: 1,
    },
  });
  assertStringIncludes(interruptedMarkdown, "stopped early");
  assertStringIncludes(
    interruptedMarkdown,
    "Interrupted by provider quota after recording 1/2 model/case slot(s)",
  );
  assertStringIncludes(interruptedMarkdown, "Estimated recorded partial-run standard list-price");
});

function successfulSenseResult(
  caseId: string,
  promptOverlap: boolean,
  exactMatch: boolean,
  referenceBasis: EvalReferenceBasis = "agent-reviewed",
): Extract<EvalCaseResult, { status: "success" }> {
  const fixture = senseFixture();
  return {
    status: "success",
    operation: "sense-selection",
    caseId,
    fixtureHash: `fixture-${caseId}`,
    fixtureEvaluation: { promptOverlap, referenceBasis },
    provenance: fixture.provenance,
    input: fixture.input,
    expected: fixture.expected,
    modelId: "gemini-3.6-flash",
    reasoningEffort: "low",
    startedAt: "2026-01-01T00:00:00.000Z",
    latencyMilliseconds: 10,
    attempts: [],
    usage: {
      inputTokens: 0,
      noCacheInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    },
    value: exactMatch
      ? { outcome: "selected", senseNumbers: [1, 3] }
      : { outcome: "ambiguous", possibleSenseNumbers: [1, 2] },
    outputHash: `output-${caseId}`,
    score: {
      kind: "sense-selection",
      exactMatch,
    },
    generation: {
      operation: "sense-selection",
      cacheKey: caseId,
      cacheStatus: "hit",
      modelConfigurationId: "gemini-3.6-flash@low",
      attempts: [],
      latencyMilliseconds: 10,
      usage: {
        inputTokens: 0,
        noCacheInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      sourceUsage: {
        inputTokens: 0,
        noCacheInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      fingerprints: {
        basePrompt: `prompt-${caseId}`,
        stablePrompt: `stable-prompt-${caseId}`,
        schema: `schema-${caseId}`,
        configuration: `configuration-${caseId}`,
      },
    },
  };
}

function successfulMinimizationResult(
  caseId: string,
  promptOverlap: boolean,
  value: string | null,
  referenceBasis: EvalReferenceBasis = "agent-reviewed",
): Extract<EvalCaseResult, { status: "success" }> {
  const fixture = minimizationFixture();
  const usage = {
    inputTokens: 0,
    noCacheInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  return {
    status: "success",
    operation: "context-minimization",
    caseId,
    fixtureHash: `fixture-${caseId}`,
    fixtureEvaluation: { promptOverlap, referenceBasis },
    provenance: fixture.provenance,
    input: fixture.input,
    expected: fixture.expected,
    modelId: "claude-opus-5",
    reasoningEffort: "low",
    startedAt: "2026-01-01T00:00:00.000Z",
    latencyMilliseconds: 10,
    attempts: [],
    usage,
    value,
    outputHash: `output-${caseId}`,
    score: scoreContextMinimization(fixture, value),
    generation: {
      operation: "context-minimization",
      cacheKey: caseId,
      cacheStatus: "hit",
      modelConfigurationId: "claude-opus-5@low",
      attempts: [],
      latencyMilliseconds: 10,
      usage,
      sourceUsage: usage,
      fingerprints: {
        basePrompt: `prompt-${caseId}`,
        stablePrompt: `stable-prompt-${caseId}`,
        schema: `schema-${caseId}`,
        configuration: `configuration-${caseId}`,
      },
    },
  };
}

Deno.test("minimization summaries separate reference-basis cohorts", () => {
  const exactReference = "<mark>対象</mark>を選んだ。";
  const novelMinimization = "前置きのあとで<mark>対象</mark>を選んだ。";
  const knownBad = "前置きを捏造して<mark>対象</mark>を選んだ。";
  const results = [
    successfulMinimizationResult(
      "user-reviewed",
      false,
      exactReference,
      "user-reviewed",
    ),
    successfulMinimizationResult("agent-reviewed", false, exactReference),
    successfulMinimizationResult(
      "accepted",
      false,
      novelMinimization,
      "corpus-replay",
    ),
    successfulMinimizationResult("provisional", false, exactReference, "provisional"),
    successfulMinimizationResult("prompt-overlap", true, knownBad),
  ];

  const summaries = summarizeResults(results);
  assertEquals(summaries.length, 1);
  assertEquals(summaries[0].caseCount, 5);
  assertEquals(summaries[0].nonPromptOverlapCaseCount, 4);
  assertEquals(summaries[0].contextMinimization, {
    cohorts: {
      userReviewed: {
        caseCount: 1,
        dispositionCorrectCount: 1,
        acceptableExactMatchCount: 1,
        knownBadCount: 0,
        keepFullContextCount: 0,
        novelCount: 0,
        missingCount: 0,
        unnecessaryCount: 0,
      },
      agentReviewed: {
        caseCount: 1,
        dispositionCorrectCount: 1,
        acceptableExactMatchCount: 1,
        knownBadCount: 0,
        keepFullContextCount: 0,
        novelCount: 0,
        missingCount: 0,
        unnecessaryCount: 0,
      },
      corpusReplay: {
        caseCount: 1,
        dispositionCorrectCount: 1,
        acceptableExactMatchCount: 0,
        knownBadCount: 0,
        keepFullContextCount: 0,
        novelCount: 1,
        missingCount: 0,
        unnecessaryCount: 0,
      },
      provisional: {
        caseCount: 1,
        dispositionCorrectCount: 1,
        acceptableExactMatchCount: 1,
        knownBadCount: 0,
        keepFullContextCount: 0,
        novelCount: 0,
        missingCount: 0,
        unnecessaryCount: 0,
      },
    },
  });

  const run: EvalRun = {
    schemaVersion: 1,
    runId: "minimization-report-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    configuration: {
      models: [{ modelId: "claude-opus-5", reasoningEffort: "low" }],
      operations: ["context-minimization"],
      requestedCaseFilters: [],
      concurrency: 1,
      maxAttempts: 3,
      cacheMode: "use",
    },
    fixtureCounts: {
      available: 5,
      selected: 5,
      selectedPromptOverlaps: 1,
      providerCallSlots: 5,
    },
    reproducibility: {
      hashAlgorithm: "sha-256-canonical-json",
      selectedFixtureSetHash: "minimization-fixture-set-hash",
    },
    costEstimate: {
      currency: "USD",
      pricingAsOf: PRICING_AS_OF,
      total: 0,
      sources: PRICING_SOURCE_URLS,
      disclaimer: COST_ESTIMATE_DISCLAIMER,
    },
    summaries,
    results,
  };
  const markdown = renderMarkdownReport(run);
  assertStringIncludes(
    markdown,
    "Agent-reviewed development reference minimize/keep disposition agreement: 1/1 (100.0%)",
  );
  assertStringIncludes(
    markdown,
    "User-reviewed development reference minimize/keep disposition agreement: 1/1 (100.0%)",
  );
  assertStringIncludes(
    markdown,
    "Corpus-replay reference minimize/keep disposition agreement: 1/1 (100.0%)",
  );
  assertStringIncludes(markdown, "not independent adjudication");
  assertStringIncludes(markdown, "Provisional reference minimize/keep disposition agreement: 1/1");
  assertEquals(markdown.includes("Headline disposition accuracy"), false);
  assertEquals(markdown.includes("Headline minimized text"), false);
});

Deno.test("sense summaries separate reference-basis cohorts", () => {
  const results = [
    successfulSenseResult("user-reviewed", false, true, "user-reviewed"),
    successfulSenseResult("agent-reviewed", false, true),
    successfulSenseResult("accepted", false, false, "corpus-replay"),
    successfulSenseResult("provisional", false, true, "provisional"),
    successfulSenseResult("prompt-overlap", true, false),
  ];
  results[0].usage = {
    inputTokens: 1_000,
    noCacheInputTokens: 800,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    unclassifiedInputTokens: 200,
    providerUsageIncomplete: true,
    outputTokens: 100,
    reasoningOutputTokens: 25,
  };
  const summaries = summarizeResults(results);
  assertEquals(summaries.length, 1);
  assertEquals(summaries[0].caseCount, 5);
  assertEquals(summaries[0].nonPromptOverlapCaseCount, 4);
  assertEquals(summaries[0].usage.unclassifiedInputTokens, 200);
  assertEquals(summaries[0].estimatedCostUSD.total, 0.00198);
  assertEquals(summaries[0].estimatedCostUSD.lowerBound, true);
  assertEquals(summaries[0].senseSelection, {
    cohorts: {
      userReviewed: { caseCount: 1, exactMatchCount: 1 },
      agentReviewed: { caseCount: 1, exactMatchCount: 1 },
      corpusReplay: { caseCount: 1, exactMatchCount: 0 },
      provisional: { caseCount: 1, exactMatchCount: 1 },
    },
  });

  const run: EvalRun = {
    schemaVersion: 1,
    runId: "test-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    configuration: {
      models: [{ modelId: "gemini-3.6-flash", reasoningEffort: "low" }],
      operations: ["sense-selection"],
      requestedCaseFilters: [],
      concurrency: 1,
      maxAttempts: 3,
      cacheMode: "use",
    },
    fixtureCounts: {
      available: 5,
      selected: 5,
      selectedPromptOverlaps: 1,
      providerCallSlots: 5,
    },
    reproducibility: {
      hashAlgorithm: "sha-256-canonical-json",
      selectedFixtureSetHash: "fixture-set-hash",
    },
    costEstimate: {
      currency: "USD",
      pricingAsOf: PRICING_AS_OF,
      total: totalEstimatedUSDCost(summaries.map(({ estimatedCostUSD }) => estimatedCostUSD)),
      lowerBound: true,
      sources: PRICING_SOURCE_URLS,
      disclaimer: COST_ESTIMATE_DISCLAIMER,
    },
    summaries,
    results,
  };
  const markdown = renderMarkdownReport(run);
  assertStringIncludes(
    markdown,
    "Agent-reviewed development reference exact outcome agreement: 1/1 (100.0%)",
  );
  assertStringIncludes(
    markdown,
    "User-reviewed development reference exact outcome agreement: 1/1 (100.0%)",
  );
  assertStringIncludes(
    markdown,
    "Corpus-replay reference exact outcome agreement: 0/1 (0.0%)",
  );
  assertStringIncludes(markdown, "not independent adjudication");
  assertEquals(markdown.includes("Gold primary exact selection"), false);
  assertEquals(
    markdown.includes("Successful exact outcome matches across all results"),
    false,
  );
  assertStringIncludes(markdown, "Provisional reference exact outcome agreement");
  assertStringIncludes(markdown, "prompt-overlap case(s) excluded");
  assertStringIncludes(markdown, "prompt-overlap");
  assertStringIncludes(
    markdown,
    "Estimated whole-run standard list-price cost lower bound: $0.001980",
  );
  assertStringIncludes(markdown, "Pricing sources: [Anthropic]");
  assertStringIncludes(markdown, "Estimated list-price cost lower bound: $0.001980");
  assertStringIncludes(markdown, "$0.001200 uncached input");
  assertStringIncludes(markdown, "$0.000030 unclassified input");
  assertStringIncludes(markdown, "$0.000750 output");
  assertStringIncludes(markdown, "800 uncached, 200 unclassified");
  assertStringIncludes(
    markdown,
    "Provider telemetry was incomplete, so these counts are lower bounds",
  );
  assertStringIncludes(
    markdown,
    "Provider usage telemetry was incomplete; reported token counts and this cost estimate are lower bounds",
  );
  assertStringIncludes(
    markdown,
    "200 input token(s) lacked provider cache classification and were priced at the lowest listed input-token rate",
  );
  assertStringIncludes(markdown, "Selected-fixture hash (sha-256-canonical-json)");
  assertStringIncludes(markdown, "fixture-set-hash");
  assertStringIncludes(markdown, 'artifact "test.json"');
  assertStringIncludes(markdown, "fixture-accepted");
  assertStringIncludes(markdown, "output-accepted");
});

Deno.test("reports inconsistent provider telemetry as run-level uncertainty", () => {
  const result = successfulSenseResult("uncertain-usage", false, true);
  result.usage = {
    inputTokens: 110,
    noCacheInputTokens: 80,
    cacheReadInputTokens: 20,
    cacheWriteInputTokens: 0,
    unclassifiedInputTokens: 10,
    providerUsageInconsistent: true,
    outputTokens: 12,
    reasoningOutputTokens: 2,
  };
  const summaries = summarizeResults([result]);
  assertEquals(summaries[0].usage.providerUsageInconsistent, true);
  assertEquals(summaries[0].estimatedCostUSD.uncertain, true);
  assertEquals(summaries[0].estimatedCostUSD.lowerBound, undefined);

  const run: EvalRun = {
    schemaVersion: 1,
    runId: "uncertain-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    configuration: {
      models: [{ modelId: "gemini-3.6-flash", reasoningEffort: "low" }],
      operations: ["sense-selection"],
      requestedCaseFilters: ["uncertain-usage"],
      concurrency: 1,
      maxAttempts: 3,
      cacheMode: "use",
    },
    fixtureCounts: {
      available: 1,
      selected: 1,
      selectedPromptOverlaps: 0,
      providerCallSlots: 1,
    },
    reproducibility: {
      hashAlgorithm: "sha-256-canonical-json",
      selectedFixtureSetHash: "uncertain-fixture-set-hash",
    },
    costEstimate: {
      currency: "USD",
      pricingAsOf: PRICING_AS_OF,
      total: totalEstimatedUSDCost(summaries.map(({ estimatedCostUSD }) => estimatedCostUSD)),
      uncertain: true,
      sources: PRICING_SOURCE_URLS,
      disclaimer: COST_ESTIMATE_DISCLAIMER,
    },
    summaries,
    results: [result],
  };

  const markdown = renderMarkdownReport(run);
  assertStringIncludes(
    markdown,
    "Estimated whole-run standard list-price cost (uncertain)",
  );
  assertStringIncludes(markdown, "Estimated list-price cost (uncertain)");
  assertStringIncludes(
    markdown,
    "normalized counts are uncertain and may be above or below actual usage",
  );
  assertStringIncludes(
    markdown,
    "normalized token counts and this cost estimate are uncertain and may overstate or understate actual usage and cost",
  );
  assertEquals(
    markdown.includes("Estimated whole-run standard list-price cost lower bound"),
    false,
  );
  assertEquals(markdown.includes("Estimated list-price cost lower bound"), false);
});

Deno.test("reports a single cached success whose original generation needed correction", () => {
  const result = successfulSenseResult("cached-correction", false, true);
  result.generation.sourceGeneration = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    validationVersion: 1,
    latencyMilliseconds: 20,
    usage: {
      inputTokens: 20,
      noCacheInputTokens: 20,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 4,
      reasoningOutputTokens: 0,
    },
    attempts: [
      {
        number: 1,
        modelConfigurationId: "gemini-3.6-flash@low",
        responseModelId: "gemini-3.6-flash-2026-07-01",
        responseId: "response-rejected",
        promptFingerprint: "rejected-prompt",
        latencyMilliseconds: 10,
        usage: {
          inputTokens: 10,
          noCacheInputTokens: 10,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 2,
          reasoningOutputTokens: 0,
        },
        validationError: "sense 9 is not compatible",
      },
      {
        number: 2,
        modelConfigurationId: "gemini-3.6-flash@low",
        responseModelId: "gemini-3.6-flash-2026-07-01",
        responseId: "response-accepted",
        promptFingerprint: "accepted-prompt",
        latencyMilliseconds: 10,
        usage: {
          inputTokens: 10,
          noCacheInputTokens: 10,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
          outputTokens: 2,
          reasoningOutputTokens: 0,
        },
      },
    ],
    fingerprints: {
      basePrompt: "base-prompt",
      stablePrompt: "stable-prompt",
      schema: "schema",
      configuration: "configuration",
    },
  };
  const summaries = summarizeResults([result]);
  const run: EvalRun = {
    schemaVersion: 1,
    runId: "cached-correction-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    configuration: {
      models: [{ modelId: "gemini-3.6-flash", reasoningEffort: "low" }],
      operations: ["sense-selection"],
      requestedCaseFilters: ["cached-correction"],
      concurrency: 1,
      maxAttempts: 3,
      cacheMode: "use",
    },
    fixtureCounts: {
      available: 1,
      selected: 1,
      selectedPromptOverlaps: 0,
      providerCallSlots: 1,
    },
    reproducibility: {
      hashAlgorithm: "sha-256-canonical-json",
      selectedFixtureSetHash: "cached-correction-fixture-set-hash",
    },
    costEstimate: {
      currency: "USD",
      pricingAsOf: PRICING_AS_OF,
      total: totalEstimatedUSDCost(
        summaries.map(({ estimatedCostUSD }) => estimatedCostUSD),
      ),
      sources: PRICING_SOURCE_URLS,
      disclaimer: COST_ESTIMATE_DISCLAIMER,
    },
    summaries,
    results: [result],
  };

  const markdown = renderMarkdownReport(run);
  assertStringIncludes(markdown, "## Cases requiring review");
  assertStringIncludes(markdown, "### 対象 — `cached-correction`");
  assertStringIncludes(markdown, "result-cache hit; original paid generation");
  assertStringIncludes(markdown, "rejected by deterministic validation");
  assertStringIncludes(markdown, "sense 9 is not compatible");
  assertStringIncludes(markdown, "Attempt 2: accepted");
});

Deno.test("reports group model comparisons by case and preserve cached retry validation", () => {
  const first = successfulSenseResult("comparison", false, true);
  const second = structuredClone(first);
  second.modelId = "gpt-5.6-luna";
  second.value = { outcome: "no-match" };
  second.outputHash = "different-output-hash";
  second.score = {
    kind: "sense-selection",
    exactMatch: false,
  };
  second.generation = {
    ...second.generation,
    cacheKey: "different-request-hash",
    cacheStatus: "hit",
    modelConfigurationId: "gpt-5.6-luna@low",
    sourceGeneration: {
      generatedAt: "2026-01-01T00:00:00.000Z",
      validationVersion: 1,
      latencyMilliseconds: 20,
      usage: {
        inputTokens: 20,
        noCacheInputTokens: 20,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 4,
        reasoningOutputTokens: 0,
      },
      attempts: [
        {
          number: 1,
          modelConfigurationId: "gpt-5.6-luna@low",
          responseModelId: "gpt-5.6-luna-2026-07-01",
          responseId: "response-rejected",
          promptFingerprint: "rejected-prompt",
          latencyMilliseconds: 10,
          usage: {
            inputTokens: 10,
            noCacheInputTokens: 10,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 2,
            reasoningOutputTokens: 0,
          },
          validationError: "sense 9 is not compatible",
        },
        {
          number: 2,
          modelConfigurationId: "gpt-5.6-luna@low",
          responseModelId: "gpt-5.6-luna-2026-07-01",
          responseId: "response-accepted",
          promptFingerprint: "accepted-prompt",
          latencyMilliseconds: 10,
          usage: {
            inputTokens: 10,
            noCacheInputTokens: 10,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            outputTokens: 2,
            reasoningOutputTokens: 0,
          },
        },
      ],
      fingerprints: {
        basePrompt: "base-prompt",
        stablePrompt: "stable-prompt",
        schema: "schema",
        configuration: "configuration",
      },
    },
  };

  const disabled = structuredClone(first);
  disabled.modelId = "claude-haiku-4-5";
  disabled.reasoningEffort = "disabled";
  disabled.generation = {
    ...disabled.generation,
    cacheKey: "haiku-request-hash",
    cacheStatus: "shared",
    modelConfigurationId: "claude-haiku-4-5@disabled",
    sourceGeneration: structuredClone(second.generation.sourceGeneration),
  };

  const summaries = summarizeResults([first, second, disabled]);
  const run: EvalRun = {
    schemaVersion: 1,
    runId: "comparison-run",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    configuration: {
      models: [
        { modelId: "gemini-3.6-flash", reasoningEffort: "low" },
        { modelId: "gpt-5.6-luna", reasoningEffort: "low" },
        { modelId: "claude-haiku-4-5", reasoningEffort: "disabled" },
      ],
      operations: ["sense-selection"],
      requestedCaseFilters: ["comparison"],
      concurrency: 1,
      maxAttempts: 3,
      cacheMode: "use",
    },
    fixtureCounts: {
      available: 1,
      selected: 1,
      selectedPromptOverlaps: 0,
      providerCallSlots: 3,
    },
    reproducibility: {
      hashAlgorithm: "sha-256-canonical-json",
      selectedFixtureSetHash: "comparison-fixture-set-hash",
    },
    costEstimate: {
      currency: "USD",
      pricingAsOf: PRICING_AS_OF,
      total: totalEstimatedUSDCost(summaries.map(({ estimatedCostUSD }) => estimatedCostUSD)),
      sources: PRICING_SOURCE_URLS,
      disclaimer: COST_ESTIMATE_DISCLAIMER,
    },
    summaries,
    results: [first, second, disabled],
  };

  const markdown = renderMarkdownReport(run);
  assertEquals(markdown.split("### 対象 — `comparison`").length - 1, 1);
  assertStringIncludes(markdown, "#### `gemini-3.6-flash@low`");
  assertStringIncludes(markdown, "#### `gpt-5.6-luna@low`");
  assertStringIncludes(markdown, "#### `claude-haiku-4-5@disabled`");
  assertStringIncludes(markdown, "result-cache hit; original paid generation");
  assertStringIncludes(markdown, "joined an in-flight generation; original paid generation");
  assertStringIncludes(markdown, "rejected by deterministic validation");
  assertStringIncludes(markdown, "sense 9 is not compatible");
  assertStringIncludes(markdown, "response-rejected");
  assertStringIncludes(markdown, "different-request-hash");
  assertStringIncludes(markdown, "different-output-hash");
});
