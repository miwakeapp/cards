import type { JMDictWord } from "data";
import { describeNumbers } from "./describe_input.ts";

const PREFIX_PARTS_OF_SPEECH = new Set(["pref", "n-pref"]);
const SUFFIX_PARTS_OF_SPEECH = new Set(["suf", "n-suf", "ctr"]);
const NOTATION_MARKER = "～";

/** A JMDict spelling, reading, and sense selection resolved into card-facing notation. */
export interface ResolvedJMDictUsage {
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

/** Every sense an exact JMDict spelling can represent within one entry. */
export interface JMDictSpellingUsage {
  /** The JMDict entry containing the spelling and senses. */
  readonly entry: JMDictWord;

  /** Nonempty 1-indexed senses available for the spelling across its applicable readings. */
  readonly senseNumbers: readonly number[];
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

function senseNumbersForForm(
  entry: JMDictWord,
  recognitionTarget: string,
  usesKanjiForm: boolean,
  kanaForm: JMDictWord["kana"][number],
): number[] {
  const compatibleKanji = compatibleKanjiSpellings(entry, kanaForm.appliesToKanji);
  return entry.sense.flatMap((sense, index) => {
    if (!allows(sense.appliesToKana, kanaForm.text)) return [];

    const appliesToSelectedSpelling = usesKanjiForm
      ? allows(sense.appliesToKanji, recognitionTarget)
      : sense.appliesToKanji.includes("*") ||
        sense.appliesToKanji.some((spelling) => compatibleKanji.has(spelling));
    return appliesToSelectedSpelling ? [index + 1] : [];
  });
}

function validateSenseNumbers(
  values: readonly number[],
  entry: JMDictWord,
  fieldName: string,
): number[] {
  if (
    values.length === 0 ||
    values.some((value) =>
      !Number.isSafeInteger(value) || value < 1 || value > entry.sense.length
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(
      `${fieldName} ${describeNumbers(values)} must contain one or more unique integers ` +
        `between 1 and ${entry.sense.length}, inclusive, for jmdictEntry with id ` +
        `${JSON.stringify(entry.id)}`,
    );
  }
  return [...values].sort((left, right) => left - right);
}

function validateRequestedSenseNumbers(
  values: readonly number[],
  entry: JMDictWord,
): number[] {
  return validateSenseNumbers(values, entry, "applicableSenseNumbers");
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

type AffixBoundary = "leading" | "trailing";

function affixBoundaryForSense(
  entry: JMDictWord,
  senseNumber: number,
): AffixBoundary | undefined {
  if (sensesUseOnly(entry, [senseNumber], SUFFIX_PARTS_OF_SPEECH)) return "leading";
  if (sensesUseOnly(entry, [senseNumber], PREFIX_PARTS_OF_SPEECH)) return "trailing";
  return undefined;
}

function uniformAffixBoundary(
  entry: JMDictWord,
  senseNumbers: readonly number[],
): AffixBoundary | undefined {
  const first = affixBoundaryForSense(entry, senseNumbers[0]);
  if (first === undefined) return undefined;
  return senseNumbers.every((senseNumber) => affixBoundaryForSense(entry, senseNumber) === first)
    ? first
    : undefined;
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

  const structurallyCompatibleSenseNumbers = senseNumbersForForm(
    entry,
    recognitionTarget,
    kanjiForm !== undefined,
    selectedKanaForm,
  );

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

/**
 * Returns every 1-indexed sense available for an exact spelling in one JMDict entry.
 *
 * Unlike `compatibleSenseNumbersForJMDictUsage()`, this does not select a single reading. For a
 * kanji spelling it unions the senses available through every applicable kana reading. For a kana
 * spelling it applies that form's kanji and sense restrictions. If the same text appears in both
 * JMDict form categories, both categories contribute. An absent or unusable spelling returns an
 * empty array.
 */
function senseNumbersForJMDictSpelling(
  entry: JMDictWord,
  spelling: string,
): number[] {
  const senseNumbers = new Set<number>();

  if (entry.kanji.some(({ text }) => text === spelling)) {
    for (const kanaForm of entry.kana) {
      if (!allows(kanaForm.appliesToKanji, spelling)) continue;
      for (const senseNumber of senseNumbersForForm(entry, spelling, true, kanaForm)) {
        senseNumbers.add(senseNumber);
      }
    }
  }

  for (const kanaForm of entry.kana) {
    if (kanaForm.text !== spelling) continue;
    for (const senseNumber of senseNumbersForForm(entry, spelling, false, kanaForm)) {
      senseNumbers.add(senseNumber);
    }
  }

  return [...senseNumbers].toSorted((left, right) => left - right);
}

/**
 * Describes every usable same-spelling entry from an exhaustive entry iterable.
 *
 * Entries which do not contain the exact spelling, or for which restrictions make no sense
 * available through that spelling, are omitted. The result is directly compatible with focused
 * hint generation's selected/contrasting usage shape.
 */
export function jmdictUsagesForSpelling(
  entries: Iterable<JMDictWord>,
  spelling: string,
): JMDictSpellingUsage[] {
  const usages: JMDictSpellingUsage[] = [];
  for (const entry of entries) {
    const senseNumbers = senseNumbersForJMDictSpelling(entry, spelling);
    if (senseNumbers.length > 0) usages.push({ entry, senseNumbers });
  }
  return usages;
}

/**
 * Returns unselected same-spelling usages not already distinguished by the rendered card front.
 *
 * `frontSideUsages` must contain exactly one usage per entry for the same exact undecorated
 * spelling, normally the exhaustive result of `jmdictUsagesForSpelling()`. The selected usage's
 * senses must be a subset of its entry's front-side senses.
 *
 * Selected senses are removed from their entry. When all selected senses are suffixes or all are
 * prefixes, `createCard()` adds a leading or trailing `～`; senses with a different affix boundary
 * are therefore already distinguished by the front and are omitted. Another sense or entry with
 * the same boundary remains a possible alternative. Without a uniform selected affix boundary,
 * or when `options` says the actual front lacks that boundary, no alternative is removed on the
 * strength of notation.
 *
 * A nonempty result does not by itself mean that a hint is required. It is the candidate input for
 * a semantic hint decision, which may determine that the surviving lexicographic alternatives are
 * indistinguishable for recognition.
 */
export function jmdictAlternativesForCardFront(
  selectedUsage: JMDictSpellingUsage,
  frontSideUsages: readonly JMDictSpellingUsage[],
  options: {
    /**
     * The notation on an already-rendered, possibly user-edited front. When omitted, notation is
     * derived from the selected senses exactly as `createCard()` would derive it.
     */
    readonly displayedAffixNotation?: "leading" | "none" | "trailing";
  } = {},
): JMDictSpellingUsage[] {
  const selectedSenseNumbers = validateSenseNumbers(
    selectedUsage.senseNumbers,
    selectedUsage.entry,
    "selectedUsage.senseNumbers",
  );
  const usageByEntryId = new Map<string, JMDictSpellingUsage>();
  for (const [index, usage] of frontSideUsages.entries()) {
    if (usageByEntryId.has(usage.entry.id)) {
      throw new Error(
        `frontSideUsages contains more than one usage for jmdictEntry with id ${
          JSON.stringify(usage.entry.id)
        }`,
      );
    }
    usageByEntryId.set(usage.entry.id, {
      entry: usage.entry,
      senseNumbers: validateSenseNumbers(
        usage.senseNumbers,
        usage.entry,
        `frontSideUsages[${index}].senseNumbers`,
      ),
    });
  }

  const selectedFrontUsage = usageByEntryId.get(selectedUsage.entry.id);
  if (selectedFrontUsage === undefined) {
    throw new Error(
      `frontSideUsages does not contain selectedUsage.entry with id ${
        JSON.stringify(selectedUsage.entry.id)
      }`,
    );
  }
  const selectedFrontSenseNumbers = new Set(selectedFrontUsage.senseNumbers);
  const unavailableSelectedSenseNumbers = selectedSenseNumbers.filter((senseNumber) =>
    !selectedFrontSenseNumbers.has(senseNumber)
  );
  if (unavailableSelectedSenseNumbers.length > 0) {
    throw new Error(
      `selectedUsage.senseNumbers ${describeNumbers(selectedSenseNumbers)} includes sense(s) ${
        unavailableSelectedSenseNumbers.join(", ")
      } not present in the ` +
        `frontSideUsages usage for jmdictEntry with id ${JSON.stringify(selectedUsage.entry.id)}`,
    );
  }

  const selectedSenseNumberSet = new Set(selectedSenseNumbers);
  const automaticBoundary = uniformAffixBoundary(selectedUsage.entry, selectedSenseNumbers);
  const displayedNotation = options.displayedAffixNotation;
  const selectedBoundary = displayedNotation === undefined
    ? automaticBoundary
    : displayedNotation === automaticBoundary
    ? automaticBoundary
    : undefined;
  return [...usageByEntryId.values()].flatMap((usage) => {
    const senseNumbers = usage.senseNumbers.filter((senseNumber) =>
      (usage.entry.id !== selectedUsage.entry.id || !selectedSenseNumberSet.has(senseNumber)) &&
      (selectedBoundary === undefined ||
        affixBoundaryForSense(usage.entry, senseNumber) === selectedBoundary)
    );
    return senseNumbers.length === 0 ? [] : [{ entry: usage.entry, senseNumbers }];
  });
}
