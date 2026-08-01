import type { HintGenerationInput, SenseSelectionInput } from "card_field_generation";
import {
  assertContextMinimizationInput,
  assertHintGenerationInput,
  assertSenseSelectionInput,
  promptJMDictEntry,
  promptJMDictProjectionSignature,
} from "card_field_generation/eval-metadata";
import { type JMDictWord, preextractedJMDictEntry } from "data";
import type { EvalFixture, HintFixture, SenseSelectionFixture } from "./types.ts";

type JMDictEntryLoader = (id: string) => Promise<JMDictWord>;

/** Resolves the JMDict references in one tracked hint fixture exactly as the eval runner does. */
export async function hintGenerationInput(
  fixture: HintFixture,
): Promise<HintGenerationInput> {
  return {
    context: fixture.input.context,
    recognitionTarget: fixture.input.recognitionTarget,
    selectedUsage: {
      entry: await preextractedJMDictEntry(fixture.input.selectedUsage.jmdictId),
      senseNumbers: fixture.input.selectedUsage.senseNumbers,
    },
    contrastingUsages: await Promise.all(
      fixture.input.contrastingUsages.map(async (usage) => ({
        entry: await preextractedJMDictEntry(usage.jmdictId),
        senseNumbers: usage.senseNumbers,
      })),
    ),
  };
}

/** Resolves the JMDict reference in one tracked sense fixture exactly as the eval runner does. */
export async function senseSelectionInput(
  fixture: SenseSelectionFixture,
): Promise<SenseSelectionInput> {
  return {
    context: fixture.input.context,
    recognitionTarget: fixture.input.recognitionTarget,
    jmdictEntry: await preextractedJMDictEntry(fixture.input.jmdictId),
    compatibleSenseNumbers: fixture.input.compatibleSenseNumbers,
  };
}

/**
 * Builds the canonical audit identity for one tracked fixture.
 *
 * The JSON fixture stores compact JMDict IDs and sense numbers, while the model sees the selected
 * senses' glosses, expanded tags, and usage information. Including signatures of those exact
 * prompt projections makes a JMDict data refresh visibly change eval identities without coupling
 * them to spellings, readings, relation graphs, or other entry data that the prompt omits. This is
 * intentionally separate from the production generation cache key.
 */
export async function evalFixtureHashContent(
  fixture: EvalFixture,
  loadJMDictEntry: JMDictEntryLoader = preextractedJMDictEntry,
): Promise<unknown> {
  if (fixture.operation === "context-minimization") {
    return fixture;
  }

  if (fixture.operation === "sense-selection") {
    const entry = await loadJMDictEntry(fixture.input.jmdictId);
    return {
      fixture,
      promptJMDictProjectionSignatures: {
        compatible: promptJMDictProjectionSignature(
          await promptJMDictEntry(entry, fixture.input.compatibleSenseNumbers),
        ),
      },
    };
  }

  const selectedEntry = await loadJMDictEntry(fixture.input.selectedUsage.jmdictId);
  const contrastingEntries = await Promise.all(
    fixture.input.contrastingUsages.map((usage) => loadJMDictEntry(usage.jmdictId)),
  );
  return {
    fixture,
    promptJMDictProjectionSignatures: {
      selected: promptJMDictProjectionSignature(
        await promptJMDictEntry(selectedEntry, fixture.input.selectedUsage.senseNumbers),
      ),
      contrasts: await Promise.all(
        fixture.input.contrastingUsages.map(async (usage, index) =>
          promptJMDictProjectionSignature(
            await promptJMDictEntry(contrastingEntries[index], usage.senseNumbers),
          )
        ),
      ),
    },
  };
}

/** Builds ordered hash content for a selected fixture set using {@link evalFixtureHashContent}. */
export async function evalFixtureSetHashContent(
  fixtures: readonly EvalFixture[],
  loadJMDictEntry: JMDictEntryLoader = preextractedJMDictEntry,
): Promise<unknown[]> {
  return await Promise.all(
    fixtures.map((fixture) => evalFixtureHashContent(fixture, loadJMDictEntry)),
  );
}

/**
 * Checks every selected fixture through its production pre-provider validation path.
 *
 * This deliberately constructs the real JMDict-backed inputs. A dry run or CI check therefore
 * fails before spending when a tracked mark, spelling, sense number, or contrast no longer satisfies
 * the operation contract.
 */
export async function assertEvalFixtureGenerationInputs(
  fixtures: readonly EvalFixture[],
): Promise<void> {
  for (const fixture of fixtures) {
    try {
      if (fixture.operation === "context-minimization") {
        assertContextMinimizationInput(fixture.input);
      } else if (fixture.operation === "hint") {
        await assertHintGenerationInput(await hintGenerationInput(fixture));
      } else {
        await assertSenseSelectionInput(await senseSelectionInput(fixture));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${fixture.operation} eval fixture ${
          JSON.stringify(fixture.id)
        } has invalid generation input: ${message}`,
        { cause: error },
      );
    }
  }
}
