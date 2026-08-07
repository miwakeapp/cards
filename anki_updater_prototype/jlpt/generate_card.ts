import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { createCard } from "card_creator";
import { compatibleSenseNumbersForJMDictUsage, jmdictUsagesForSpelling } from "card_creator/jmdict";
import type { CardFields } from "card_model";
import { readingAppliesToKanji } from "data";
import { markedContextHasRuby } from "card_resolution";
import {
  generateSourceGroundedHint,
  type GenerationOptions,
  minimizeContext,
  selectSensesForCard,
} from "card_field_generation";
import { inferLegacySourceLanguage } from "../animecards/source.ts";
import {
  selectSensesAndMaybeGenerateHint,
  type SenseAndHintDependencies,
} from "../shared/focused_card_generation.ts";
import { needsAIMinimizedContext } from "../shared/context_minimization_policy.ts";
import { markResolvedContextTarget } from "../shared/mark_resolved_context.ts";

export interface JLPTCardGenerationInput {
  sentence: string;
  source: string;
  recognitionTarget: string;
  entry: JMdictWord;

  /** Every JMDict entry containing the exact recognition-target spelling. */
  sameSpellingEntries: readonly JMdictWord[];
}

export interface JLPTCardGenerationDependencies extends SenseAndHintDependencies {
  minimize?: typeof minimizeContext;
}

function applicableReadings(entry: JMdictWord, recognitionTarget: string): string[] {
  return [
    ...new Set(
      entry.kana
        .filter((reading) => readingAppliesToKanji(reading, recognitionTarget))
        .map(({ text }) => text),
    ),
  ];
}

function isSearchOnlyReading(entry: JMdictWord, reading: string): boolean {
  return entry.kana.find(({ text }) => text === reading)?.tags.includes("sk") === true;
}

function uniquelyPreferredReading(entry: JMdictWord, readings: readonly string[]): string | null {
  const common = readings.filter((reading) =>
    entry.kana.find(({ text }) => text === reading)?.common === true &&
    !isSearchOnlyReading(entry, reading)
  );
  if (common.length === 1) return common[0];
  const canonical = readings.filter((reading) => !isSearchOnlyReading(entry, reading));
  return canonical.length === 1 ? canonical[0] : null;
}

async function selectKanaReading(
  entry: JMdictWord,
  recognitionTarget: string,
  markedContext: string,
): Promise<string | undefined> {
  if (!entry.kanji.some(({ text }) => text === recognitionTarget)) return undefined;

  const readings = applicableReadings(entry, recognitionTarget);
  if (readings.length === 0) {
    throw new Error(
      `No jmdictEntry.kana reading applies to recognitionTarget ${
        JSON.stringify(recognitionTarget)
      } in jmdictEntry with id ${JSON.stringify(entry.id)}`,
    );
  }
  if (readings.length === 1) return readings[0];

  if (markedContextHasRuby(markedContext)) {
    const attempts = await Promise.all(readings.map(async (reading) => {
      try {
        await createCard({
          jmdictUsages: [{ entry }],
          kanaReadings: [reading],
          recognitionTarget,
          fullContext: markedContext,
        });
        return { reading, compatible: true };
      } catch (error) {
        // Missing placement data does not invalidate source ruby as pronunciation evidence. The
        // final rendering will still fail clearly if that data really is unavailable.
        return {
          reading,
          compatible: error instanceof Error &&
            error.message.startsWith("No furigana placement data exists"),
        };
      }
    }));
    const compatible = attempts.filter(({ compatible }) => compatible).map(({ reading }) =>
      reading
    );
    if (compatible.length === 1) return compatible[0];
    const preferred = uniquelyPreferredReading(entry, compatible);
    if (preferred !== null) return preferred;
    throw new Error(
      `Source ruby does not uniquely select kanaReading for recognitionTarget ${
        JSON.stringify(recognitionTarget)
      } in jmdictEntry with id ${JSON.stringify(entry.id)}; compatible readings: ${
        JSON.stringify(compatible)
      }`,
    );
  }

  throw new Error(
    `The supplied sentence does not uniquely determine kanaReading for recognitionTarget ${
      JSON.stringify(recognitionTarget)
    } in jmdictEntry with id ${JSON.stringify(entry.id)}; applicable readings: ${
      JSON.stringify(readings)
    }`,
  );
}

async function markedContext(
  sentence: string,
  recognitionTarget: string,
  entry: JMdictWord,
): Promise<string> {
  return await markResolvedContextTarget(
    sentence,
    recognitionTarget,
    entry.sense.flatMap((sense) => sense.partOfSpeech),
  );
}

/** Resolves one CSV row into a card without delegating target location or reading choice to AI. */
export async function generateJLPTCard(
  input: JLPTCardGenerationInput,
  options: GenerationOptions,
  {
    selectSenses = selectSensesForCard,
    generateHint = generateSourceGroundedHint,
    minimize = minimizeContext,
  }: JLPTCardGenerationDependencies = {},
): Promise<CardFields> {
  const fullContext = await markedContext(
    input.sentence,
    input.recognitionTarget,
    input.entry,
  );
  const kanaReading = await selectKanaReading(input.entry, input.recognitionTarget, fullContext);
  const compatibleSenseNumbers = compatibleSenseNumbersForJMDictUsage(
    input.entry,
    input.recognitionTarget,
    kanaReading,
  );
  const resolution = await selectSensesAndMaybeGenerateHint(
    {
      senseSelection: {
        context: fullContext,
        recognitionTarget: input.recognitionTarget,
        jmdictEntry: input.entry,
        compatibleSenseNumbers,
      },
      frontSideUsages: jmdictUsagesForSpelling(
        input.sameSpellingEntries,
        input.recognitionTarget,
      ),
    },
    options,
    { selectSenses, generateHint },
  );
  if (resolution.senseSelection.outcome === "no-match") {
    throw new Error(
      `No sense in jmdictEntry with id ${JSON.stringify(input.entry.id)} applies to ` +
        `recognitionTarget ${JSON.stringify(input.recognitionTarget)} in the supplied sentence`,
    );
  }
  if (resolution.senseSelection.outcome === "ambiguous") {
    throw new Error(
      `The supplied sentence does not distinguish possible senses ${
        JSON.stringify(resolution.senseSelection.possibleSenseNumbers)
      } for recognitionTarget ${JSON.stringify(input.recognitionTarget)} in jmdictEntry with id ${
        JSON.stringify(input.entry.id)
      }`,
    );
  }

  let hint: string | undefined;
  if (resolution.hintOutcome?.outcome === "generated") {
    hint = resolution.hintOutcome.hint;
  }

  const minimizedContext = needsAIMinimizedContext(fullContext)
    ? (await minimize({ fullContext }, options)).value ?? undefined
    : undefined;
  const applicableSenseNumbers =
    resolution.senseSelection.senseNumbers.length === compatibleSenseNumbers.length
      ? undefined
      : resolution.senseSelection.senseNumbers;
  return await createCard({
    jmdictUsages: [{
      entry: input.entry,
      ...(applicableSenseNumbers === undefined ? {} : { applicableSenseNumbers }),
    }],
    ...(kanaReading === undefined ? {} : { kanaReadings: [kanaReading] as const }),
    recognitionTarget: input.recognitionTarget,
    ...(hint === undefined ? {} : { hint }),
    fullContext,
    ...(minimizedContext === undefined ? {} : { minimizedContext }),
    ...(input.source === "" ? {} : {
      source: {
        text: input.source,
        lang: inferLegacySourceLanguage(input.source),
      },
    }),
  });
}
