import type { EvalFixture, EvalOperation, EvalReferenceBasis } from "./types.ts";

const REFERENCE_BASES: readonly EvalReferenceBasis[] = [
  "user-reviewed",
  "agent-reviewed",
  "corpus-replay",
  "provisional",
];

function stableRank(seed: string, fixture: EvalFixture): number {
  // FNV-1a is sufficient here: this is deterministic corpus ordering, not security.
  let hash = 0x811c9dc5;
  for (const character of `${seed}\0${fixture.operation}\0${fixture.id}`) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sampleStratum(fixture: EvalFixture): string {
  switch (fixture.operation) {
    case "context-minimization":
      return fixture.expected.disposition;
    case "hint":
      return fixture.expected.disposition;
    case "reading-selection":
      return fixture.expected.decisions.map(({ decision }) => decision).join("+");
    case "sense-selection":
      if (fixture.expected.outcome.outcome !== "selected") {
        return fixture.expected.outcome.outcome;
      }
      return fixture.expected.outcome.senseNumbers.length ===
          fixture.input.compatibleSenseNumbers.length
        ? "selected-all"
        : "selected-subset";
  }
}

interface OperationSampleState {
  nextUncoveredStratumIndex: number;
  nextStratumIndex: number;
  selectedCount: number;
  strata: SampleStratumState[];
}

interface SampleStratumState {
  fixturesByReferenceBasis: Map<EvalReferenceBasis, EvalFixture[]>;
  nextReferenceBasisIndex: number;
}

function nextFixtureFromStratum(state: SampleStratumState): EvalFixture | undefined {
  for (let offset = 0; offset < REFERENCE_BASES.length; ++offset) {
    const referenceBasisIndex = (state.nextReferenceBasisIndex + offset) % REFERENCE_BASES.length;
    const referenceBasis = REFERENCE_BASES[referenceBasisIndex];
    const fixture = state.fixturesByReferenceBasis.get(referenceBasis)?.shift();
    if (fixture === undefined) continue;

    state.nextReferenceBasisIndex = (referenceBasisIndex + 1) % REFERENCE_BASES.length;
    return fixture;
  }
  return undefined;
}

function nextUncoveredFixture(state: OperationSampleState): EvalFixture | undefined {
  while (state.nextUncoveredStratumIndex < state.strata.length) {
    const fixture = nextFixtureFromStratum(state.strata[state.nextUncoveredStratumIndex++]);
    if (fixture !== undefined) return fixture;
  }
  return undefined;
}

function nextFixture(state: OperationSampleState): EvalFixture | undefined {
  for (let offset = 0; offset < state.strata.length; ++offset) {
    const stratumIndex = (state.nextStratumIndex + offset) % state.strata.length;
    const fixture = nextFixtureFromStratum(state.strata[stratumIndex]);
    if (fixture === undefined) continue;

    state.nextStratumIndex = (stratumIndex + 1) % state.strata.length;
    return fixture;
  }
  return undefined;
}

/**
 * Deterministically selects a development sample balanced by operation and expected outcome.
 *
 * Prompt few-shots are excluded to avoid direct replay. This remains a development sample, not a
 * generalization estimate. Within each operation, round-robin selection covers null and non-null
 * decisions and rotates among reference bases instead of allowing either the most common outcome or
 * the highest-authority cohort to crowd out the rest of the development corpus.
 */
export function selectSampleCases(
  fixtures: readonly EvalFixture[],
  size: number,
  seed: string,
): EvalFixture[] {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError(
      `Sample size must be a positive integer; received ${size}`,
    );
  }
  const eligible = fixtures.filter((candidate) => !candidate.evaluation.promptOverlap);
  if (eligible.length < size) {
    throw new RangeError(
      `Sample size ${size} exceeds the ${eligible.length} prompt-overlap-free fixture(s) selected by the other filters`,
    );
  }
  const groupedFixtures = new Map<EvalOperation, Map<string, EvalFixture[]>>();
  for (const fixture of eligible) {
    const operationGroup = groupedFixtures.get(fixture.operation) ?? new Map();
    const stratum = sampleStratum(fixture);
    const stratumGroup = operationGroup.get(stratum) ?? [];
    stratumGroup.push(fixture);
    operationGroup.set(stratum, stratumGroup);
    groupedFixtures.set(fixture.operation, operationGroup);
  }

  const states = new Map<EvalOperation, OperationSampleState>();
  for (const [operation, operationGroup] of groupedFixtures) {
    const strata = [...operationGroup].sort(([left], [right]) => left.localeCompare(right)).map(
      ([, stratumFixtures]) => ({
        fixturesByReferenceBasis: Map.groupBy(
          stratumFixtures.sort((left, right) =>
            stableRank(seed, left) - stableRank(seed, right) || left.id.localeCompare(right.id)
          ),
          (fixture) => fixture.evaluation.referenceBasis,
        ),
        nextReferenceBasisIndex: 0,
      }),
    );
    states.set(operation, {
      nextUncoveredStratumIndex: 0,
      nextStratumIndex: 0,
      selectedCount: 0,
      strata,
    });
  }

  const operations = [...states.keys()].sort();
  const selected: EvalFixture[] = [];

  // Cover every outcome once before repeating any outcome, while interleaving operations so the
  // sample remains operation-balanced to within one case whenever the available corpus permits.
  while (selected.length < size) {
    let progressed = false;
    for (const operation of operations) {
      const state = states.get(operation)!;
      const next = nextUncoveredFixture(state);
      if (next === undefined) continue;
      selected.push(next);
      ++state.selectedCount;
      progressed = true;
      if (selected.length === size) break;
    }
    if (!progressed) break;
  }

  // Once outcome coverage is complete, fill from the least-represented operation and continue
  // round-robin within its outcome strata.
  while (selected.length < size) {
    const operation = operations.filter((candidate) =>
      states.get(candidate)!.strata.some((stratum) =>
        [...stratum.fixturesByReferenceBasis.values()].some((fixtures) =>
          fixtures.length > 0
        )
      )
    ).sort((left, right) =>
      states.get(left)!.selectedCount - states.get(right)!.selectedCount ||
      left.localeCompare(right)
    )[0];
    if (operation === undefined) break;

    const state = states.get(operation)!;
    const next = nextFixture(state);
    if (next === undefined) break;
    selected.push(next);
    ++state.selectedCount;
  }
  return selected;
}

/** Applies operation and case-ID filters before optional development sampling. */
export function selectFixtures(
  fixtures: readonly EvalFixture[],
  operations: readonly EvalOperation[],
  caseFilters: readonly string[],
  sampleSize: number | undefined,
  sampleSeed: string,
): EvalFixture[] {
  let selected = fixtures.filter((fixture) => operations.includes(fixture.operation));
  if (caseFilters.length > 0) {
    selected = selected.filter((fixture) =>
      caseFilters.some((filter) => fixture.id.includes(filter))
    );
  }
  if (sampleSize !== undefined) {
    selected = selectSampleCases(selected, sampleSize, sampleSeed);
  }
  return selected;
}
