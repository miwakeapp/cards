import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { jmdictAlternativesForCardFront, jmdictUsagesForSpelling } from "card_creator/jmdict";
import {
  generateSourceGroundedHint,
  type GenerationOptions,
  selectSensesForCard,
} from "card_field_generation";
import { markResolvedContextTargetWithinAnchor } from "../shared/anchored_context.ts";
import { kanaScriptsMatch } from "./html.ts";
import type { AdditionalAcceptedReadingResolution, ConversionCandidate } from "./types.ts";

export interface UnresolvedJMDictEntry {
  /** Plain-text source evidence used to distinguish the competing entries. */
  context: string;
  /** Accepted Full context used to anchor the intended occurrence within wider evidence. */
  fullContext: string;
  /** Exact undecorated JMDict spelling used by every candidate entry. */
  recognitionTarget: string;
  /** Best reading evidence recoverable from the Animecard. */
  kanaReading: string;
  /** Whether the reading is explicit publisher ruby or weaker Animecard metadata. */
  kanaReadingEvidence: "source-ruby" | "animecard";
  /** Same-spelling entries whose senses must be contrasted. */
  candidateEntries: JMdictWord[];
  /** Candidate IDs represented by the Animecard glossary, and therefore selectable. */
  allowedJMDictIds: string[];
}

export interface JMDictEntrySelectionOverride {
  jmdictId: string;
  recognitionTarget: string;
  applicableSenseNumbers: number[];
  /** The selected-entry hint, or `null` when final `～` notation makes it redundant. */
  hint: string | null;
  model: string;
  generatedAt: string;
  candidateJMDictIds: string[];
  allowedJMDictIds: string[];
  /** Reviewed alternative pronunciations, including their equivalent-entry provenance. */
  additionalAcceptedReadings?: AdditionalAcceptedReadingResolution[];
}

/** Reconstructs the complete entry-selection decision for deterministic pipeline replay. */
export function entrySelectionOverride(
  candidate: ConversionCandidate,
): JMDictEntrySelectionOverride | undefined {
  const resolution = candidate.jmdictEntryResolution;
  if (resolution === undefined) return undefined;
  return {
    jmdictId: candidate.jmdictId,
    recognitionTarget: candidate.keyRecognitionTarget,
    applicableSenseNumbers: resolution.applicableSenseNumbers,
    hint: resolution.hint,
    model: resolution.model,
    generatedAt: resolution.generatedAt,
    candidateJMDictIds: resolution.candidateJMDictIds,
    allowedJMDictIds: resolution.allowedJMDictIds,
    ...(candidate.additionalAcceptedReadings === undefined ? {} : {
      additionalAcceptedReadings: candidate.additionalAcceptedReadings,
    }),
  };
}

export type JMDictEntrySelection =
  | ({ status: "selected" } & JMDictEntrySelectionOverride)
  | { status: "no-match" }
  | { status: "no-reading-match" }
  | { status: "ambiguous"; possibleJMDictIds: string[] }
  | {
    status: "sense-ambiguous";
    possibleJMDictId: string;
    possibleSenseNumbers: number[];
  }
  | { status: "disallowed"; selectedJMDictId: string }
  | {
    status: "reading-conflict";
    selectedJMDictId: string;
    compatibleReadings: string[];
  };

/** Entry-selection disposition plus the exact focused-generation configurations it used. */
export type GeneratedJMDictEntrySelection = JMDictEntrySelection & {
  modelConfigurationIds: string[];
};

interface CombinedSense {
  jmdictId: string;
  senseNumber: number;
}

function allows(values: readonly string[], value: string): boolean {
  return values.includes("*") || values.includes(value);
}

/**
 * Returns the original sense numbers structurally available for one entry and target spelling.
 *
 * The broad Animecard pass intentionally considers every reading that the entry allows for the
 * spelling: its reading evidence is weak, and a semantically correct entry may expose that the
 * Animecard reading is wrong. A trusted or explicitly rechecked reading narrows this set. For a
 * kana spelling, JMDict sense restrictions can still refer indirectly to the kanji spellings
 * allowed by that kana form, matching Card Creator's usage-resolution rules.
 */
function structurallyApplicableSenseNumbers(
  entry: JMdictWord,
  recognitionTarget: string,
  kanaReading: string | undefined,
): number[] {
  const kanjiForm = entry.kanji.find(({ text }) => text === recognitionTarget);
  const kanaForm = entry.kana.find(({ text }) => text === recognitionTarget);
  const applicableKanaForms = kanaForm === undefined
    ? entry.kana.filter(({ text, appliesToKanji }) =>
      allows(appliesToKanji, recognitionTarget) &&
      (kanaReading === undefined || kanaScriptsMatch(text, kanaReading))
    )
    : kanaReading === undefined || kanaScriptsMatch(kanaForm.text, kanaReading)
    ? [kanaForm]
    : [];

  if (kanjiForm === undefined && kanaForm === undefined) return [];

  return entry.sense.flatMap((sense, index) => {
    const applies = applicableKanaForms.some((applicableKanaForm) => {
      if (!allows(sense.appliesToKana, applicableKanaForm.text)) return false;
      if (kanjiForm !== undefined) {
        return allows(sense.appliesToKanji, recognitionTarget);
      }

      const compatibleKanjiSpellings = applicableKanaForm.appliesToKanji.includes("*")
        ? new Set(entry.kanji.map(({ text }) => text))
        : new Set(applicableKanaForm.appliesToKanji);
      return sense.appliesToKanji.includes("*") ||
        sense.appliesToKanji.some((spelling) => compatibleKanjiSpellings.has(spelling));
    });
    return applies ? [index + 1] : [];
  });
}

function uniqueForms<T>(forms: T[]): T[] {
  return [...new Map(forms.map((form) => [JSON.stringify(form), form])).values()];
}

function acceptedReadingsForUsage(
  entry: JMdictWord,
  recognitionTarget: string,
  applicableSenseNumbers: readonly number[],
): AdditionalAcceptedReadingResolution[] {
  if (!entry.kanji.some(({ text }) => text === recognitionTarget)) return [];

  const forms = entry.kana.filter(({ text, appliesToKanji }) =>
    (appliesToKanji.includes("*") || appliesToKanji.includes(recognitionTarget)) &&
    applicableSenseNumbers.every((senseNumber) =>
      structurallyApplicableSenseNumbers(entry, recognitionTarget, text).includes(senseNumber)
    )
  );
  const canonicalForms = forms.filter((form) =>
    !form.tags.includes("sk") ||
    !forms.some((candidate) =>
      !candidate.tags.includes("sk") && kanaScriptsMatch(candidate.text, form.text)
    )
  );
  return canonicalForms.map(({ text }) => ({
    jmdictId: entry.id,
    kanaReading: text,
    applicableSenseNumbers: [...applicableSenseNumbers],
  }));
}

export interface EntrySelectionDependencies {
  selectSenses?: typeof selectSensesForCard;
  generateHint?: typeof generateSourceGroundedHint;
}

type EntrySelectionGenerationOptions = GenerationOptions;

async function markedSelectionContext(request: UnresolvedJMDictEntry): Promise<string> {
  const partOfSpeech = request.candidateEntries.flatMap((entry) =>
    entry.sense.flatMap((sense) => sense.partOfSpeech)
  );
  return await markResolvedContextTargetWithinAnchor(
    request.context,
    request.fullContext,
    request.recognitionTarget,
    partOfSpeech,
  );
}

/** Revalidates cached selections against reading evidence that is not entrusted to the model. */
export function readingConflictForJMDictEntrySelection(
  request: UnresolvedJMDictEntry,
  selectedJMDictId: string,
): Extract<JMDictEntrySelection, { status: "reading-conflict" }> | null {
  const selectedEntry = request.candidateEntries.find(({ id }) => id === selectedJMDictId);
  if (selectedEntry === undefined) {
    throw new Error(`Selected JMDict entry ${selectedJMDictId} is absent from the candidates.`);
  }
  const compatibleReadings =
    selectedEntry.kanji.some(({ text }) => text === request.recognitionTarget)
      ? selectedEntry.kana
        .filter(({ appliesToKanji }) =>
          appliesToKanji.includes("*") || appliesToKanji.includes(request.recognitionTarget)
        )
        .map(({ text }) => text)
      : selectedEntry.kana
        .filter(({ text }) => text === request.recognitionTarget)
        .map(({ text }) => text);
  return compatibleReadings.some((reading) => kanaScriptsMatch(reading, request.kanaReading))
    ? null
    : {
      status: "reading-conflict",
      selectedJMDictId,
      compatibleReadings,
    };
}

function combinedEntry(
  request: UnresolvedJMDictEntry,
  candidateEntries: readonly JMdictWord[],
  kanaReading: string | undefined,
): {
  entry: JMdictWord;
  senses: CombinedSense[];
} {
  const candidates = candidateEntries.toSorted((left, right) => left.id.localeCompare(right.id));
  if (candidates.length === 0) {
    throw new Error("JMDict entry selection requires at least one candidate entry.");
  }
  const exactKanjiForms = candidates.flatMap((entry) =>
    entry.kanji.filter(({ text }) => text === request.recognitionTarget)
  );
  const exactKanaForms = candidates.flatMap((entry) =>
    entry.kana.filter(({ text }) => text === request.recognitionTarget)
  );
  if (exactKanjiForms.length === 0 && exactKanaForms.length === 0) {
    throw new Error(
      `No candidate entry contains recognitionTarget ${
        JSON.stringify(request.recognitionTarget)
      } as an exact spelling.`,
    );
  }

  const senses = candidates.flatMap((entry) =>
    structurallyApplicableSenseNumbers(entry, request.recognitionTarget, kanaReading).map(
      (senseNumber) => ({
        jmdictId: entry.id,
        senseNumber,
      }),
    )
  );

  return {
    entry: {
      id: `entry-selection:${candidates.map(({ id }) => id).join(",")}`,
      // Keep other forms and restrictions because they often clarify why JMDict split the entries.
      // The exact-target check above prevents this temporary combined view from admitting a novel
      // recognition-target spelling.
      kanji: uniqueForms(candidates.flatMap(({ kanji }) => kanji)),
      kana: uniqueForms(candidates.flatMap(({ kana }) => kana)),
      // The combined sense number is the stable bridge back to its original entry and sense.
      sense: senses.map(({ jmdictId, senseNumber }) => {
        const sourceEntry = candidates.find(({ id }) => id === jmdictId)!;
        return structuredClone(sourceEntry.sense[senseNumber - 1]);
      }),
    },
    senses,
  };
}

/**
 * Selects one of several same-spelling entries by presenting their senses as one numbered list.
 *
 * The intended surface is marked deterministically before the focused sense-selection and
 * source-grounded-hint operations run. The temporary combined entry gives those operations one
 * stable sense-number namespace that can be mapped back to the original entries.
 */
export async function selectJMDictEntry(
  request: UnresolvedJMDictEntry,
  options: EntrySelectionGenerationOptions,
  {
    selectSenses = selectSensesForCard,
    generateHint = generateSourceGroundedHint,
  }: EntrySelectionDependencies = {},
): Promise<GeneratedJMDictEntrySelection> {
  const context = await markedSelectionContext(request);
  const readingCompatibleEntries = request.candidateEntries.filter((entry) =>
    readingConflictForJMDictEntrySelection(request, entry.id) === null
  );
  const initialEntries = request.kanaReadingEvidence === "source-ruby"
    ? readingCompatibleEntries
    : request.candidateEntries;
  if (initialEntries.length === 0) {
    return { status: "no-reading-match", modelConfigurationIds: [] };
  }

  async function evaluate(
    candidateEntries: readonly JMdictWord[],
    narrowToRequestReading: boolean,
  ): Promise<GeneratedJMDictEntrySelection> {
    const { entry, senses } = combinedEntry(
      request,
      candidateEntries,
      narrowToRequestReading ? request.kanaReading : undefined,
    );
    if (senses.length === 0) {
      return { status: "no-match", modelConfigurationIds: [] };
    }
    const generated = await selectSenses({
      context,
      recognitionTarget: request.recognitionTarget,
      jmdictEntry: entry,
      compatibleSenseNumbers: senses.map((_, index) => index + 1),
    }, options);
    const modelConfigurationIds = [generated.metadata.modelConfigurationId];
    if (generated.value.outcome === "no-match") {
      return { status: "no-match", modelConfigurationIds };
    }

    if (generated.value.outcome === "ambiguous") {
      const possibleSenses = generated.value.possibleSenseNumbers.map((number) =>
        senses[number - 1]
      );
      const possibleJMDictIds = [...new Set(possibleSenses.map(({ jmdictId }) => jmdictId))]
        .toSorted();
      if (possibleJMDictIds.length === 1) {
        return {
          status: "sense-ambiguous",
          possibleJMDictId: possibleJMDictIds[0],
          possibleSenseNumbers: possibleSenses.map(({ senseNumber }) => senseNumber),
          modelConfigurationIds,
        };
      }
      return { status: "ambiguous", possibleJMDictIds, modelConfigurationIds };
    }

    const selectedSenses = generated.value.senseNumbers.map((number) => senses[number - 1]);
    const selectedUsages = [
      ...Map.groupBy(selectedSenses, ({ jmdictId }) => jmdictId),
    ].map(([jmdictId, senses]) => ({
      entry: candidateEntries.find(({ id }) => id === jmdictId)!,
      senseNumbers: senses.map(({ senseNumber }) => senseNumber),
    })).toSorted((left, right) => left.entry.id.localeCompare(right.entry.id));
    const selectedJMDictIds = selectedUsages.map(({ entry }) => entry.id);
    if (selectedUsages.length === 1) {
      const selectedJMDictId = selectedUsages[0].entry.id;
      if (!request.allowedJMDictIds.includes(selectedJMDictId)) {
        return { status: "disallowed", selectedJMDictId, modelConfigurationIds };
      }
      const readingConflict = readingConflictForJMDictEntrySelection(
        request,
        selectedJMDictId,
      );
      if (readingConflict !== null) return { ...readingConflict, modelConfigurationIds };
    }

    const leadCandidates = selectedUsages.filter(({ entry }) =>
      request.allowedJMDictIds.includes(entry.id) &&
      readingConflictForJMDictEntrySelection(request, entry.id) === null
    );
    if (leadCandidates.length !== 1) {
      return {
        status: "ambiguous",
        possibleJMDictIds: selectedJMDictIds,
        modelConfigurationIds,
      };
    }
    const leadUsage = leadCandidates[0];
    const jmdictId = leadUsage.entry.id;
    const applicableSenseNumbers = leadUsage.senseNumbers;
    const selectedEntry = leadUsage.entry;
    const additionalAcceptedReadings = selectedUsages.flatMap(({ entry, senseNumbers }) =>
      acceptedReadingsForUsage(entry, request.recognitionTarget, senseNumbers)
    ).filter(({ jmdictId, kanaReading }) =>
      jmdictId !== leadUsage.entry.id || !kanaScriptsMatch(kanaReading, request.kanaReading)
    );
    const distinctAdditionalAcceptedReadings = [
      ...new Map(
        additionalAcceptedReadings.map((reading) => [
          JSON.stringify([
            reading.jmdictId,
            reading.kanaReading,
            reading.applicableSenseNumbers,
          ]),
          reading,
        ]),
      ).values(),
    ];
    // Reading is shown only on the back, so every sense reachable through the exact front-side
    // spelling remains a contrast even when it uses another reading. The same rule applies across
    // entries. Automatic `～` notation also removes only competitors with a different affix
    // boundary, while same-boundary affix usages still require a hint.
    const frontSideUsages = jmdictUsagesForSpelling(
      [
        selectedEntry,
        ...request.candidateEntries
          .filter(({ id }) => id !== jmdictId)
          .toSorted((left, right) => left.id.localeCompare(right.id)),
      ],
      request.recognitionTarget,
    );
    const selectedSenseNumbersByEntry = new Map(
      selectedUsages.map(({ entry, senseNumbers }) => [entry.id, new Set(senseNumbers)]),
    );
    const contrastingUsages = jmdictAlternativesForCardFront(
      { entry: selectedEntry, senseNumbers: applicableSenseNumbers },
      frontSideUsages,
    ).flatMap((usage) => {
      const equivalentSenseNumbers = selectedSenseNumbersByEntry.get(usage.entry.id);
      const senseNumbers = equivalentSenseNumbers === undefined
        ? usage.senseNumbers
        : usage.senseNumbers.filter((senseNumber) => !equivalentSenseNumbers.has(senseNumber));
      return senseNumbers.length === 0 ? [] : [{ entry: usage.entry, senseNumbers }];
    });
    let hint: string | null = null;
    if (contrastingUsages.length > 0) {
      const hintResult = await generateHint({
        context,
        recognitionTarget: request.recognitionTarget,
        selectedUsage: {
          entry: selectedEntry,
          senseNumbers: applicableSenseNumbers,
        },
        contrastingUsages,
      }, options);
      modelConfigurationIds.push(hintResult.metadata.modelConfigurationId);
      if (hintResult.value.outcome === "generated") hint = hintResult.value.hint;
    }
    const distinctModelConfigurationIds = [...new Set(modelConfigurationIds)];
    return {
      status: "selected",
      jmdictId,
      recognitionTarget: request.recognitionTarget,
      applicableSenseNumbers,
      hint,
      model: distinctModelConfigurationIds.join(", "),
      generatedAt: new Date().toISOString(),
      candidateJMDictIds: request.candidateEntries.map(({ id }) => id).toSorted(),
      allowedJMDictIds: [...request.allowedJMDictIds].toSorted(),
      ...(distinctAdditionalAcceptedReadings.length === 0 ? {} : {
        additionalAcceptedReadings: distinctAdditionalAcceptedReadings,
      }),
      modelConfigurationIds: distinctModelConfigurationIds,
    };
  }

  const initial = await evaluate(
    initialEntries,
    request.kanaReadingEvidence === "source-ruby",
  );
  if (request.kanaReadingEvidence === "source-ruby") return initial;

  const eligibleAllowedEntries = readingCompatibleEntries.filter(({ id }) =>
    request.allowedJMDictIds.includes(id)
  );
  if (eligibleAllowedEntries.length !== 1) return initial;
  const selectedIds = initial.status === "disallowed"
    ? [initial.selectedJMDictId]
    : initial.status === "reading-conflict"
    ? [initial.selectedJMDictId]
    : initial.status === "ambiguous"
    ? initial.possibleJMDictIds
    : initial.status === "sense-ambiguous"
    ? [initial.possibleJMDictId]
    : [];
  if (
    selectedIds.length === 0 ||
    selectedIds.some((id) =>
      id !== eligibleAllowedEntries[0].id &&
      readingCompatibleEntries.some((entry) => entry.id === id)
    )
  ) {
    return initial;
  }

  // The broad comparison preferred an entry that contradicts the Animecard reading. Recheck the
  // one linked, reading-compatible entry on its own: it is accepted only if its own senses fit the
  // context and either yield the required contrastive hint or become unambiguous through affix
  // notation.
  return await evaluate(eligibleAllowedEntries, true);
}
