/**
 * Classifies each Miwake card against the latest JMDict rendering, deciding how much human
 * attention its update needs.
 */

import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { renderDictionaryField, splitDictionaryField } from "card_model/dictionary";
import { renderEntry } from "jmdict_to_html";
import type { MiwakeNoteSnapshot } from "./anki.ts";
import {
  alignSenses,
  canonicalEntryHTML,
  type DiffSegment,
  diffSegments,
  diffSenseSegments,
  type ParsedEntry,
  parseRenderedEntry,
  type SenseAlignment,
} from "./entry_text.ts";
import { formatKey, type Key, parseKey } from "card_model/keys";
import { validateCardReading } from "./reading_validation.ts";

/**
 * How much attention a card needs, from none to human-required:
 * - `unchanged`: stored HTML is byte-identical to the latest rendering.
 * - `normalize`: differs only in encoding/whitespace; updating changes nothing visible.
 * - `routine`: what the card tests is unaffected; the update is safe to skim.
 * - `retarget`: the targeted senses may have changed; AI + human review needed.
 * - `exception`: something is structurally wrong; a human must decide.
 */
export type Verdict = "unchanged" | "normalize" | "routine" | "retarget" | "exception";

export type ChangeChipKind =
  | "form-added"
  | "form-removed"
  | "entry-info"
  | "sense-edited"
  | "sense-moved"
  | "sense-added"
  | "sense-removed"
  | "reading"
  | "formatting";

export interface ChangeChip {
  kind: ChangeChipKind;
  /** Short prefix like `S3`, `S2→S4`, `+S5`, or a form. */
  label: string;
  /** Word-level diff of the affected text, when applicable. */
  segments?: DiffSegment[];
  /** Plain text for chips without a diff (added/removed senses and forms). */
  text?: string;
}

export interface SenseView {
  number: number;
  text: string;
  /** Diff against the aligned old sense, when it changed. */
  segments?: DiffSegment[];
  /** The old sense number this one continues, if any. */
  fromOldSense?: number;
  /** True when the card currently targets the aligned old sense. */
  wasTargeted: boolean;
  isNew: boolean;
}

export interface AnalyzedCard {
  note: MiwakeNoteSnapshot;
  parsedKey: Key | null;
  verdict: Verdict;
  /** Machine-readable subcase, for grouping. */
  reason: string;
  /** Human-readable explanation of the classification. */
  detail: string;
  /** The latest rendering of the entry, or `null` when the entry is gone. */
  latestEntryHTML: string | null;
  latestWord: JMdictWord | null;
  oldParsed: ParsedEntry | null;
  newParsed: ParsedEntry | null;
  alignment: SenseAlignment | null;
  /** 1-indexed senses the card targets today (resolved against the stored entry). */
  targetSenseNumbers: number[];
  /** Where those targets land in the new entry, via alignment. */
  mappedTargetSenses: number[];
  /** Key rewrite that preserves targeting (renumber case), or `null`. */
  proposedKey: string | null;
  /** Furigana-boundary rewrite that preserves the stored pronunciation, or `null`. */
  proposedReading: string | null;
  /** Sense list for the review UI (new senses annotated, removed ones appended). */
  senseViews: SenseView[];
  removedTargetedSenses: number[];
  changeChips: ChangeChip[];
  needsAI: boolean;
}

export async function analyzeCard(
  note: MiwakeNoteSnapshot,
  latestEntries: ReadonlyMap<string, JMdictWord>,
): Promise<AnalyzedCard> {
  const parsedKey = parseKey(note.fields.key);
  if (parsedKey === null) {
    return exceptional(note, null, {
      reason: "invalid-key",
      detail: "The Key field does not match the Miwake Card key format.",
    });
  }

  const anchorUsage = parsedKey.usages[0];

  const latestWord = latestEntries.get(anchorUsage.jmdictId);
  if (latestWord === undefined) {
    return exceptional(note, parsedKey, {
      reason: "entry-deleted",
      detail: `JMDict no longer contains anchor entry ${anchorUsage.jmdictId}.`,
    });
  }

  for (const usage of parsedKey.usages.slice(1)) {
    if (!latestEntries.has(usage.jmdictId)) {
      return exceptional(note, parsedKey, {
        reason: "entry-deleted",
        detail: `JMDict no longer contains supplemental entry ${usage.jmdictId}.`,
        latestWord,
      });
    }
  }
  const latestEntryHTML = renderDictionaryField(
    parsedKey.usages.map(({ jmdictId }) => latestEntries.get(jmdictId)!),
  );
  const storedEntryHTML = note.fields.dictionary.trim();

  if (storedEntryHTML === "") {
    return exceptional(note, parsedKey, {
      reason: "stored-entry-missing",
      detail: "The card has no stored Dictionary value to compare against.",
      latestWord,
      latestEntryHTML,
    });
  }

  const storedEntryParts = splitDictionaryField(storedEntryHTML, parsedKey);
  if (storedEntryParts === null) {
    return exceptional(note, parsedKey, {
      reason: "stored-entry-unparseable",
      detail: parsedKey.usages.length === 1
        ? "The stored Dictionary value does not contain one rendered JMDict entry."
        : "The stored Dictionary value does not contain one rendered entry for every Key usage.",
      latestWord,
      latestEntryHTML,
    });
  }
  const storedAnchorEntryHTML = storedEntryParts.get(anchorUsage.jmdictId)!;
  const latestAnchorEntryHTML = renderEntry(latestWord);
  const oldParsed = parseRenderedEntry(storedAnchorEntryHTML);
  const newParsed = parseRenderedEntry(latestAnchorEntryHTML);

  if (oldParsed.senses.length === 0) {
    return exceptional(note, parsedKey, {
      reason: "stored-entry-unparseable",
      detail:
        "The stored Dictionary value does not look like JMDict HTML rendered by Miwake Cards.",
      latestWord,
      latestEntryHTML,
    });
  }

  const targetSenseNumbers = anchorUsage.senseNumbers ??
    oldParsed.senses.map((sense) => sense.number);
  if (targetSenseNumbers.some((senseNumber) => senseNumber > oldParsed.senses.length)) {
    return exceptional(note, parsedKey, {
      reason: "target-out-of-range",
      detail: "The key targets a sense number the stored entry does not have.",
      latestWord,
      latestEntryHTML,
    });
  }

  const spellingInLatest = latestWord.kanji.some((form) => form.text === parsedKey.spelling) ||
    latestWord.kana.some((form) => form.text === parsedKey.spelling);
  if (!spellingInLatest) {
    return exceptional(note, parsedKey, {
      reason: "spelling-removed",
      detail: `The spelling "${parsedKey.spelling}" is no longer a form of this entry.`,
      latestWord,
      latestEntryHTML,
    });
  }

  const alignment = alignSenses(oldParsed.senses, newParsed.senses);
  const mappedTargetSenses = mappedTargets(alignment, targetSenseNumbers);
  const supplementalAnalysis = analyzeSupplementalEntries(
    parsedKey,
    storedEntryParts,
    latestEntries,
  );
  if (supplementalAnalysis.error !== null) {
    return exceptional(note, parsedKey, {
      reason: supplementalAnalysis.reason,
      detail: supplementalAnalysis.error,
      latestWord,
      latestEntryHTML,
    });
  }
  const readingSenseOverrides = new Map(supplementalAnalysis.senseOverrides);
  readingSenseOverrides.set(
    anchorUsage.jmdictId,
    mappedTargetSenses.length === targetSenseNumbers.length ? mappedTargetSenses : [],
  );
  const readingAnalysis = await validateCardReading({
    key: parsedKey,
    recognitionTarget: note.fields.recognitionTarget,
    reading: note.fields.reading,
    entries: latestEntries,
    senseOverrides: readingSenseOverrides,
  });
  if (readingAnalysis.error !== null) {
    return exceptional(note, parsedKey, {
      reason: "invalid-reading",
      detail: readingAnalysis.error,
      latestWord,
      latestEntryHTML,
    });
  }
  const proposedReading = readingAnalysis.proposedReading;
  const changeChips = buildChangeChips(oldParsed, newParsed, alignment);
  if (supplementalAnalysis.changed) {
    changeChips.push({
      kind: "entry-info",
      label: "equivalent",
      text: "an equivalent JMDict entry changed",
    });
  }
  if (changeChips.length === 0 && storedEntryHTML !== latestEntryHTML.trim()) {
    changeChips.push({ kind: "formatting", label: "", text: "formatting-only difference" });
  }
  if (proposedReading !== null) {
    changeChips.push({ kind: "reading", label: "reading", text: proposedReading });
  }
  const supplementalProposedKey = formatKeyWithSenseOverrides(
    parsedKey,
    supplementalAnalysis.senseOverrides,
    latestEntries,
  );
  const base = {
    note,
    parsedKey,
    latestEntryHTML,
    latestWord,
    oldParsed,
    newParsed,
    alignment,
    targetSenseNumbers,
    mappedTargetSenses,
    proposedKey: supplementalProposedKey === note.fields.key ? null : supplementalProposedKey,
    proposedReading,
    senseViews: buildSenseViews(alignment, newParsed, targetSenseNumbers),
    removedTargetedSenses: alignment.removedSenses
      .filter((sense) => targetSenseNumbers.includes(sense.number))
      .map((sense) => sense.number),
    changeChips,
    needsAI: false,
  };

  if (storedEntryHTML === latestEntryHTML.trim()) {
    if (proposedReading !== null) {
      return {
        ...base,
        verdict: "routine",
        reason: "furigana-placement",
        detail: "The pronunciation is unchanged; only its furigana boundaries were updated.",
      };
    }
    if (base.proposedKey !== null) {
      return {
        ...base,
        verdict: "normalize",
        reason: "key-format",
        detail: "The Key's sense selection now has a more compact canonical representation.",
      };
    }
    return {
      ...base,
      verdict: "unchanged",
      reason: "unchanged",
      detail: "The stored dictionary HTML already matches the latest rendering.",
    };
  }

  if (canonicalEntryHTML(storedEntryHTML) === canonicalEntryHTML(latestEntryHTML)) {
    if (proposedReading !== null) {
      return {
        ...base,
        verdict: "routine",
        reason: "furigana-placement",
        detail:
          "The pronunciation is unchanged; furigana boundaries moved and the dictionary HTML needs only normalization.",
      };
    }
    return {
      ...base,
      verdict: "normalize",
      reason: "encoding-only",
      detail: "Only entity encoding or whitespace differs; nothing visible changes.",
    };
  }

  if (
    canonicalEntryHTML(storedAnchorEntryHTML) === canonicalEntryHTML(latestAnchorEntryHTML) &&
    supplementalAnalysis.changed
  ) {
    return {
      ...base,
      verdict: "routine",
      reason: supplementalAnalysis.senseOverrides.size === 0
        ? "supplemental-entry"
        : "supplemental-targets-renumbered",
      detail: supplementalAnalysis.senseOverrides.size === 0
        ? "An equivalent entry changed without altering its targeted senses."
        : "Targeted senses in an equivalent entry kept their text but moved to new numbers.",
    };
  }

  const multiEntry = parsedKey.usages.length > 1;
  if (multiEntry && oldParsed.sharedText !== newParsed.sharedText) {
    return {
      ...base,
      verdict: "exception",
      reason: "equivalent-target-changed",
      detail:
        "Shared metadata for the anchor entry changed, so this card's cross-entry equivalence needs renewed review.",
    };
  }

  if (!multiEntry && oldParsed.senses.length === 1 && newParsed.senses.length === 1) {
    return {
      ...base,
      verdict: "routine",
      reason: "single-sense",
      detail: "One sense before and after — the card cannot be pointing at the wrong sense.",
    };
  }

  // An all-senses key implicitly targets any newly added sense too, so "the targeted senses
  // are intact" can only hold for it when the sense count is unchanged.
  const allSensesKeyGrewOrShrank = anchorUsage.senseNumbers === null &&
    oldParsed.senses.length !== newParsed.senses.length;

  const targetsIntactInPlace = !allSensesKeyGrewOrShrank &&
    targetSenseNumbers.every((senseNumber) => {
      const oldSense = oldParsed.senses[senseNumber - 1];
      const newSense = newParsed.senses[senseNumber - 1];
      return newSense !== undefined && oldSense.text === newSense.text;
    });
  if (targetsIntactInPlace) {
    return {
      ...base,
      verdict: "routine",
      reason: "targets-intact",
      detail: "The targeted senses are unchanged at the same numbers.",
    };
  }

  // Every targeted sense still exists verbatim, just at different numbers.
  const renumberedTargets = targetSenseNumbers.map((senseNumber) =>
    alignment.pairs.find((pair) => pair.old.number === senseNumber && !pair.changed)
  );
  if (
    anchorUsage.senseNumbers !== null &&
    renumberedTargets.every((pair) => pair !== undefined)
  ) {
    const senseOverrides = new Map(supplementalAnalysis.senseOverrides);
    senseOverrides.set(
      anchorUsage.jmdictId,
      renumberedTargets.map((pair) => pair!.new.number),
    );
    const proposedKey = formatKeyWithSenseOverrides(parsedKey, senseOverrides, latestEntries);
    return {
      ...base,
      verdict: "routine",
      reason: "targets-renumbered",
      detail: "The targeted sense text is unchanged but moved to a different number.",
      proposedKey: proposedKey === note.fields.key ? null : proposedKey,
    };
  }

  if (multiEntry) {
    return {
      ...base,
      verdict: "exception",
      reason: "equivalent-target-changed",
      detail:
        "A selected sense in the anchor entry changed, so this card's cross-entry equivalence needs renewed review.",
    };
  }

  const targetGlossesIntactInPlace = !allSensesKeyGrewOrShrank &&
    targetSenseNumbers.every((senseNumber) => {
      const oldSense = oldParsed.senses[senseNumber - 1];
      const newSense = newParsed.senses[senseNumber - 1];
      return newSense !== undefined &&
        oldSense.glosses.length > 0 &&
        oldSense.glosses.join("\n") === newSense.glosses.join("\n");
    });
  if (targetGlossesIntactInPlace) {
    return {
      ...base,
      verdict: "routine",
      reason: "target-metadata",
      detail: "The targeted glosses are unchanged; only tags or notes around them changed.",
    };
  }

  if (base.removedTargetedSenses.length > 0) {
    return {
      ...base,
      verdict: "retarget",
      reason: "target-gone",
      detail: "A targeted sense no longer exists in the entry.",
      needsAI: true,
    };
  }

  return {
    ...base,
    verdict: "retarget",
    reason: anchorUsage.senseNumbers === null ? "all-senses-reshaped" : "target-changed",
    detail: anchorUsage.senseNumbers === null
      ? "The card targeted all senses and the sense list changed shape."
      : "The text of a targeted sense changed.",
    needsAI: true,
  };
}

function exceptional(
  note: MiwakeNoteSnapshot,
  parsedKey: Key | null,
  options: {
    reason: string;
    detail: string;
    latestWord?: JMdictWord;
    latestEntryHTML?: string;
  },
): AnalyzedCard {
  return {
    note,
    parsedKey,
    verdict: "exception",
    reason: options.reason,
    detail: options.detail,
    latestEntryHTML: options.latestEntryHTML ?? null,
    latestWord: options.latestWord ?? null,
    oldParsed: null,
    newParsed: null,
    alignment: null,
    targetSenseNumbers: [],
    mappedTargetSenses: [],
    proposedKey: null,
    proposedReading: null,
    senseViews: [],
    removedTargetedSenses: [],
    changeChips: [],
    needsAI: false,
  };
}

interface SupplementalEntryAnalysis {
  changed: boolean;
  senseOverrides: Map<string, readonly number[]>;
  reason: string;
  error: string | null;
}

function analyzeSupplementalEntries(
  parsedKey: Key,
  storedEntryParts: ReadonlyMap<string, string>,
  latestEntries: ReadonlyMap<string, JMdictWord>,
): SupplementalEntryAnalysis {
  let changed = false;
  const senseOverrides = new Map<string, readonly number[]>();

  for (const usage of parsedKey.usages.slice(1)) {
    const storedHTML = storedEntryParts.get(usage.jmdictId)!;
    const latestEntry = latestEntries.get(usage.jmdictId)!;
    const latestHTML = renderEntry(latestEntry);
    if (storedHTML !== latestHTML.trim()) changed = true;

    const oldParsed = parseRenderedEntry(storedHTML);
    const newParsed = parseRenderedEntry(latestHTML);
    if (oldParsed.senses.length === 0) {
      return {
        changed,
        senseOverrides,
        reason: "stored-entry-unparseable",
        error: `The stored block for supplemental JMDict entry ${usage.jmdictId} is unparseable.`,
      };
    }
    const targetSenseNumbers = usage.senseNumbers ??
      oldParsed.senses.map((sense) => sense.number);
    if (targetSenseNumbers.some((senseNumber) => senseNumber > oldParsed.senses.length)) {
      return {
        changed,
        senseOverrides,
        reason: "target-out-of-range",
        error:
          `The Key targets a sense the stored block for supplemental JMDict entry ${usage.jmdictId} does not have.`,
      };
    }
    if (canonicalEntryHTML(storedHTML) === canonicalEntryHTML(latestHTML)) continue;
    if (oldParsed.sharedText !== newParsed.sharedText) {
      return {
        changed,
        senseOverrides,
        reason: "supplemental-target-changed",
        error:
          `Shared metadata changed in supplemental JMDict entry ${usage.jmdictId}; its equivalence with the anchor entry needs renewed review.`,
      };
    }

    const alignment = alignSenses(oldParsed.senses, newParsed.senses);
    if (usage.senseNumbers === null && oldParsed.senses.length !== newParsed.senses.length) {
      return {
        changed,
        senseOverrides,
        reason: "supplemental-target-changed",
        error:
          `All senses were selected in supplemental JMDict entry ${usage.jmdictId}, but its sense list changed shape.`,
      };
    }

    const targetsIntactInPlace = targetSenseNumbers.every((senseNumber) => {
      const oldSense = oldParsed.senses[senseNumber - 1];
      const newSense = newParsed.senses[senseNumber - 1];
      return newSense !== undefined && oldSense.text === newSense.text;
    });
    if (targetsIntactInPlace) continue;

    const renumberedTargets = targetSenseNumbers.map((senseNumber) =>
      alignment.pairs.find((pair) => pair.old.number === senseNumber && !pair.changed)
    );
    if (usage.senseNumbers !== null && renumberedTargets.every((pair) => pair !== undefined)) {
      senseOverrides.set(
        usage.jmdictId,
        renumberedTargets.map((pair) => pair!.new.number),
      );
      continue;
    }

    return {
      changed,
      senseOverrides,
      reason: "supplemental-target-changed",
      error:
        `A targeted sense changed or disappeared in supplemental JMDict entry ${usage.jmdictId}; the anchor-entry retargeting flow cannot safely decide it.`,
    };
  }

  return { changed, senseOverrides, reason: "", error: null };
}

function formatKeyWithSenseOverrides(
  parsedKey: Key,
  senseOverrides: ReadonlyMap<string, readonly number[]>,
  latestEntries: ReadonlyMap<string, JMdictWord>,
): string {
  return formatKey(
    parsedKey.spelling,
    parsedKey.usages.map((usage) => {
      const entry = latestEntries.get(usage.jmdictId)!;
      return {
        jmdictId: usage.jmdictId,
        senseNumbers: senseOverrides.get(usage.jmdictId) ?? usage.senseNumbers ?? [],
        totalSenses: entry.sense.length,
      };
    }),
  );
}

function mappedTargets(alignment: SenseAlignment, targetSenseNumbers: number[]): number[] {
  const mapped: number[] = [];
  for (const pair of alignment.pairs) {
    if (targetSenseNumbers.includes(pair.old.number)) {
      mapped.push(pair.new.number);
    }
  }
  return mapped.sort((a, b) => a - b);
}

function buildSenseViews(
  alignment: SenseAlignment,
  newParsed: ParsedEntry,
  targetSenseNumbers: number[],
): SenseView[] {
  return newParsed.senses.map((sense) => {
    const pair = alignment.pairs.find((candidate) => candidate.new.number === sense.number);
    return {
      number: sense.number,
      text: sense.text,
      segments: pair?.changed ? diffSenseSegments(pair.old, pair.new) : undefined,
      fromOldSense: pair !== undefined && pair.old.number !== sense.number
        ? pair.old.number
        : undefined,
      wasTargeted: pair !== undefined && targetSenseNumbers.includes(pair.old.number),
      isNew: pair === undefined,
    };
  });
}

function buildChangeChips(
  oldParsed: ParsedEntry,
  newParsed: ParsedEntry,
  alignment: SenseAlignment,
): ChangeChip[] {
  const chips: ChangeChip[] = [];
  const oldForms = [...oldParsed.kanjiForms, ...oldParsed.kanaForms];
  const newForms = [...newParsed.kanjiForms, ...newParsed.kanaForms];

  for (const form of newForms) {
    if (!oldForms.includes(form)) {
      chips.push({ kind: "form-added", label: "+", text: form });
    }
  }
  for (const form of oldForms) {
    if (!newForms.includes(form)) {
      chips.push({ kind: "form-removed", label: "−", text: form });
    }
  }

  if (oldParsed.sharedText !== newParsed.sharedText) {
    chips.push({
      kind: "entry-info",
      label: "entry",
      segments: diffSegments(oldParsed.sharedText, newParsed.sharedText),
    });
  }

  for (const pair of alignment.pairs) {
    const moved = pair.old.number !== pair.new.number;
    if (pair.changed) {
      chips.push({
        kind: "sense-edited",
        label: moved ? `S${pair.old.number}→S${pair.new.number}` : `S${pair.new.number}`,
        segments: diffSenseSegments(pair.old, pair.new),
      });
    } else if (moved) {
      chips.push({
        kind: "sense-moved",
        label: `S${pair.old.number}→S${pair.new.number}`,
        text: pair.new.glosses[0] ?? pair.new.text,
      });
    }
  }

  for (const sense of alignment.addedSenses) {
    chips.push({
      kind: "sense-added",
      label: `+S${sense.number}`,
      text: sense.glosses[0] ?? sense.text,
    });
  }
  for (const sense of alignment.removedSenses) {
    chips.push({
      kind: "sense-removed",
      label: `−S${sense.number}`,
      text: sense.glosses[0] ?? sense.text,
    });
  }

  return chips;
}
