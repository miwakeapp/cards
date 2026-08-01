import { type JMDictTags, jmdictTags, type JMDictWord } from "data";

/** The semantic JMDict data that models need after deterministic form restrictions are applied. */
export interface PromptJMDictEntry {
  /** Stable JMDict sequence identifier. */
  id: string;
  /** Selected senses, retaining their original 1-indexed numbers. */
  senses: PromptJMDictSense[];
}

/** A numbered JMDict sense projected into concise model evidence. */
export interface PromptJMDictSense {
  /** Original 1-indexed position in the JMDict entry. */
  number: number;
  /** English glosses retained for semantic resolution. */
  glosses: string[];
  /** Expanded part-of-speech tags, when present. */
  partOfSpeech?: string[];
  /** Expanded domain or subject-field tags, when present. */
  field?: string[];
  /** Expanded dialect tags, when present. */
  dialect?: string[];
  /** Expanded miscellaneous usage tags, when present. */
  misc?: string[];
  /** Free-form sense information, when present. */
  info?: string[];
}

function nonempty(values: readonly string[]): string[] | undefined {
  return values.length === 0 ? undefined : [...values];
}

/** Rejects a spelling/entry mismatch before semantic generation can conceal it. */
export function assertJMDictEntryContainsSpelling(
  entry: JMDictWord,
  spelling: string,
  spellingFieldName: string,
  entryFieldName: string,
): void {
  if (
    !entry.kanji.some(({ text }) => text === spelling) &&
    !entry.kana.some(({ text }) => text === spelling)
  ) {
    throw new Error(
      `${spellingFieldName} ${
        JSON.stringify(spelling)
      } is not one of the exact spellings in ${entryFieldName} with id ${JSON.stringify(entry.id)}`,
    );
  }
}

/** Validates and canonicalizes a caller-supplied nonempty set of 1-indexed senses. */
export function validatedJMDictSenseNumbers(
  entry: JMDictWord,
  senseNumbers: readonly number[],
  senseNumbersFieldName: string,
  entryFieldName: string,
): number[] {
  const values = [...senseNumbers];
  if (
    values.length === 0 ||
    values.some((value) =>
      !Number.isSafeInteger(value) || value < 1 || value > entry.sense.length
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new RangeError(
      `${senseNumbersFieldName} must contain one or more unique integers between 1 and ${entry.sense.length}, inclusive, for ${entryFieldName} with id ${
        JSON.stringify(entry.id)
      }; received ${JSON.stringify(values)}`,
    );
  }
  return values.sort((left, right) => left - right);
}

function describeTags(
  tagDescriptions: JMDictTags,
  entryId: string,
  senseNumber: number,
  property: "partOfSpeech" | "field" | "dialect" | "misc",
  tags: readonly string[],
): string[] | undefined {
  if (tags.length === 0) {
    return undefined;
  }

  return tags.map((tag) => {
    const description = tagDescriptions[tag];
    if (description === undefined) {
      throw new Error(
        `jmdictEntry with id ${JSON.stringify(entryId)} has unknown ${property} tag ` +
          `${JSON.stringify(tag)} in sense ${senseNumber}`,
      );
    }
    return description;
  });
}

/**
 * Projects selected senses without sending irrelevant spellings, readings, or relation graphs.
 *
 * Callers resolve spelling and reading restrictions before generation. Keeping only the resulting
 * senses makes the model's task explicit and materially reduces prompt and cache-write costs.
 * Opaque JMDict tag abbreviations are replaced with their checked-in English descriptions. An
 * unknown tag is rejected instead of silently sending ambiguous evidence to the model.
 */
export async function promptJMDictEntry(
  entry: JMDictWord,
  senseNumbers: readonly number[],
): Promise<PromptJMDictEntry> {
  const validatedSenseNumbers = validatedJMDictSenseNumbers(
    entry,
    senseNumbers,
    "senseNumbers",
    "jmdictEntry",
  );
  const tagDescriptions = await jmdictTags();
  return {
    id: entry.id,
    senses: validatedSenseNumbers.map((number) => {
      const sense = entry.sense[number - 1];
      return {
        number,
        glosses: sense.gloss.map(({ text }) => text),
        partOfSpeech: describeTags(
          tagDescriptions,
          entry.id,
          number,
          "partOfSpeech",
          sense.partOfSpeech,
        ),
        field: describeTags(tagDescriptions, entry.id, number, "field", sense.field),
        dialect: describeTags(tagDescriptions, entry.id, number, "dialect", sense.dialect),
        misc: describeTags(tagDescriptions, entry.id, number, "misc", sense.misc),
        info: nonempty(sense.info),
      };
    }),
  };
}
