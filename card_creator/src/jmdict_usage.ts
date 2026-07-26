import type { JMDictWord } from "data";
import { describeNumbers } from "./describe_input.ts";

const PREFIX_PARTS_OF_SPEECH = new Set(["pref", "n-pref"]);
const SUFFIX_PARTS_OF_SPEECH = new Set(["suf", "n-suf", "ctr"]);
const NOTATION_MARKER = "～";

/** A JMDict spelling, reading, and sense selection resolved into card-facing notation. */
interface ResolvedJMDictUsage {
  /** The exact spelling from the JMDict entry, without affix notation. */
  spelling: string;

  /** The exact kana form from the JMDict entry which supplies this usage's pronunciation. */
  kanaReading: string;

  /** Whether the selected spelling came from JMDict's non-kana (`kanji`) forms. */
  usesReadingField: boolean;

  /** The selected 1-indexed senses, sorted in ascending order. */
  senseNumbers: number[];

  /** The recognition target after adding any unambiguous affix notation. */
  recognitionTarget: string;

  /** Text to prepend to the precisely formatted Reading field. */
  readingPrefix: string;

  /** Text to append to the precisely formatted Reading field. */
  readingSuffix: string;
}

function allows(values: readonly string[], value: string): boolean {
  return values.includes("*") || values.includes(value);
}

function compatibleKanjiSpellings(
  entry: JMDictWord,
  appliesToKanji: readonly string[],
): Set<string> {
  if (appliesToKanji.includes("*")) {
    return new Set(entry.kanji.map(({ text }) => text));
  }
  return new Set(appliesToKanji);
}

function validateRequestedSenseNumbers(
  values: readonly number[],
  entry: JMDictWord,
): number[] {
  if (
    values.length === 0 ||
    values.some((value) =>
      !Number.isSafeInteger(value) || value < 1 || value > entry.sense.length
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      `applicableSenseNumbers ${
        describeNumbers(values)
      } must contain one or more unique integers ` +
        `between 1 and ${entry.sense.length}, inclusive, for jmdictEntry with id ` +
        `${JSON.stringify(entry.id)}`,
    );
  }
  return [...values].sort((left, right) => left - right);
}

function sensesUseOnly(
  entry: JMDictWord,
  senseNumbers: readonly number[],
  allowedPartsOfSpeech: ReadonlySet<string>,
): boolean {
  return senseNumbers.every((senseNumber) => {
    const partsOfSpeech = entry.sense[senseNumber - 1].partOfSpeech;
    return partsOfSpeech.length > 0 &&
      partsOfSpeech.every((partOfSpeech) => allowedPartsOfSpeech.has(partOfSpeech));
  });
}

/**
 * Resolves an exact JMDict spelling, its canonical reading, and the senses valid for that pair.
 *
 * Kana-to-kanji restrictions first establish the possible spelling/reading pairs. Sense
 * restrictions are then applied to that pair, or—when the recognition target itself is kana—to
 * every kanji spelling compatible with the selected kana form. Affix notation is added only when
 * every part-of-speech tag on every selected sense identifies the same affix direction.
 */
export function resolveJMDictUsage(
  entry: JMDictWord,
  recognitionTarget: string,
  kanaReading: string | undefined,
  applicableSenseNumbers: readonly number[] | undefined,
): ResolvedJMDictUsage {
  const kanjiForm = entry.kanji.find(({ text }) => text === recognitionTarget);
  const kanaForm = entry.kana.find(({ text }) => text === recognitionTarget);

  let selectedKanaForm: JMDictWord["kana"][number];
  if (kanaForm !== undefined) {
    if (kanjiForm !== undefined) {
      throw new Error(
        `recognitionTarget ${JSON.stringify(recognitionTarget)} matches both a ` +
          `jmdictEntry.kanji spelling and a jmdictEntry.kana reading in jmdictEntry with id ` +
          `${JSON.stringify(entry.id)}`,
      );
    }
    if (kanaReading !== undefined) {
      throw new Error(
        `kanaReading ${JSON.stringify(kanaReading)} must be omitted because recognitionTarget ` +
          `${
            JSON.stringify(recognitionTarget)
          } is a jmdictEntry.kana reading in jmdictEntry with ` +
          `id ${
            JSON.stringify(entry.id)
          }; kana recognition targets do not use the card's Reading ` +
          `field`,
      );
    }
    selectedKanaForm = kanaForm;
  } else {
    if (kanjiForm === undefined) {
      throw new Error(
        `recognitionTarget ${JSON.stringify(recognitionTarget)} is not among the ` +
          `jmdictEntry.kanji spellings or jmdictEntry.kana readings in jmdictEntry with id ` +
          `${JSON.stringify(entry.id)}`,
      );
    }
    if (kanaReading === undefined) {
      throw new Error(
        `kanaReading is required because recognitionTarget ${JSON.stringify(recognitionTarget)} ` +
          `is a jmdictEntry.kanji spelling in jmdictEntry with id ${JSON.stringify(entry.id)}`,
      );
    }
    const applicableKanaForm = entry.kana.find(({ text, appliesToKanji }) =>
      text === kanaReading && allows(appliesToKanji, recognitionTarget)
    );
    if (applicableKanaForm === undefined) {
      throw new Error(
        `kanaReading ${JSON.stringify(kanaReading)} is not among the jmdictEntry.kana readings ` +
          `applicable to recognitionTarget ${JSON.stringify(recognitionTarget)} in jmdictEntry ` +
          `with id ${JSON.stringify(entry.id)}`,
      );
    }
    selectedKanaForm = applicableKanaForm;
  }

  const compatibleKanji = compatibleKanjiSpellings(
    entry,
    selectedKanaForm.appliesToKanji,
  );
  const structurallyCompatibleSenseNumbers = entry.sense.flatMap((sense, index) => {
    if (!allows(sense.appliesToKana, selectedKanaForm.text)) return [];

    const appliesToSelectedSpelling = kanjiForm === undefined
      ? sense.appliesToKanji.includes("*") ||
        sense.appliesToKanji.some((spelling) => compatibleKanji.has(spelling))
      : allows(sense.appliesToKanji, recognitionTarget);
    return appliesToSelectedSpelling ? [index + 1] : [];
  });

  if (structurallyCompatibleSenseNumbers.length === 0) {
    throw new Error(
      `No jmdictEntry.sense in jmdictEntry with id ${JSON.stringify(entry.id)} applies to ` +
        `recognitionTarget ${JSON.stringify(recognitionTarget)} with kanaReading ` +
        `${JSON.stringify(selectedKanaForm.text)}`,
    );
  }

  const senseNumbers = applicableSenseNumbers === undefined
    ? structurallyCompatibleSenseNumbers
    : validateRequestedSenseNumbers(applicableSenseNumbers, entry);
  const compatibleSenseNumberSet = new Set(structurallyCompatibleSenseNumbers);
  const unavailableSenseNumbers = senseNumbers.filter((value) =>
    !compatibleSenseNumberSet.has(value)
  );
  if (unavailableSenseNumbers.length > 0) {
    const unavailableDescription = unavailableSenseNumbers.length === 1
      ? `sense ${unavailableSenseNumbers[0]}`
      : `senses ${unavailableSenseNumbers.join(", ")}`;
    throw new Error(
      `applicableSenseNumbers ${
        describeNumbers(senseNumbers)
      } includes ${unavailableDescription}, ` +
        `which does not apply to recognitionTarget ${JSON.stringify(recognitionTarget)} with ` +
        `kanaReading ${JSON.stringify(selectedKanaForm.text)} in jmdictEntry with id ` +
        `${JSON.stringify(entry.id)}; ` +
        `applicableSenseNumbers may select only ${
          describeNumbers(structurallyCompatibleSenseNumbers)
        }`,
    );
  }

  const isPrefix = sensesUseOnly(
    entry,
    senseNumbers,
    PREFIX_PARTS_OF_SPEECH,
  );
  const isSuffix = sensesUseOnly(
    entry,
    senseNumbers,
    SUFFIX_PARTS_OF_SPEECH,
  );
  const recognitionTargetPrefix = isSuffix ? NOTATION_MARKER : "";
  // Anki uses spaces to separate adjacent furigana chunks. Without one here, the notation marker
  // becomes part of the first annotated kanji's ruby base.
  const readingPrefix = isSuffix ? `${NOTATION_MARKER} ` : "";
  const readingSuffix = isPrefix ? NOTATION_MARKER : "";

  return {
    spelling: recognitionTarget,
    kanaReading: selectedKanaForm.text,
    usesReadingField: kanjiForm !== undefined,
    senseNumbers,
    recognitionTarget: `${recognitionTargetPrefix}${recognitionTarget}${readingSuffix}`,
    readingPrefix,
    readingSuffix,
  };
}

/**
 * Returns the 1-indexed senses permitted by JMDict for a selected spelling and reading.
 *
 * This applies the entry's reading-to-spelling restrictions followed by each sense's spelling and
 * reading restrictions. It makes no contextual or pedagogical choice among the returned senses.
 * The same form validation and compatibility rules are used by `createCard()`.
 */
export function compatibleSenseNumbersForJMDictUsage(
  entry: JMDictWord,
  recognitionTarget: string,
  kanaReading: string | undefined,
): number[] {
  return resolveJMDictUsage(entry, recognitionTarget, kanaReading, undefined).senseNumbers;
}
