/**
 * Classifies each Miwake card against the latest JMDict rendering, deciding how much human
 * attention its update needs.
 */

import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
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
// Deliberately `card_creator/keys`, not the package root: the analysis engine must not pull in
// the AI SDK (which reads env at import time).
import { formatMiwakeKey, type MiwakeKey, parseMiwakeKey } from "card_creator/keys";

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
  parsedKey: MiwakeKey | null;
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
  /** Sense list for the review UI (new senses annotated, removed ones appended). */
  senseViews: SenseView[];
  removedTargetedSenses: number[];
  changeChips: ChangeChip[];
  needsAI: boolean;
}

export function analyzeCard(
  note: MiwakeNoteSnapshot,
  latestWord: JMdictWord | undefined,
): AnalyzedCard {
  const parsedKey = parseMiwakeKey(note.fields.key);
  if (parsedKey === null) {
    return exceptional(note, null, {
      reason: "invalid-key",
      detail: "The Key field does not match the Miwake key format.",
    });
  }

  if (latestWord === undefined) {
    return exceptional(note, parsedKey, {
      reason: "entry-deleted",
      detail: `JMDict no longer contains entry ${parsedKey.jmdictId}.`,
    });
  }

  const latestEntryHTML = renderEntry(latestWord);
  const storedEntryHTML = note.fields.dictionaryEntry.trim();

  if (storedEntryHTML === "") {
    return exceptional(note, parsedKey, {
      reason: "stored-entry-missing",
      detail: "The card has no stored Dictionary entry to compare against.",
      latestWord,
      latestEntryHTML,
    });
  }

  const oldParsed = parseRenderedEntry(storedEntryHTML);
  const newParsed = parseRenderedEntry(latestEntryHTML);

  if (oldParsed.senses.length === 0) {
    return exceptional(note, parsedKey, {
      reason: "stored-entry-unparseable",
      detail: "The stored Dictionary entry does not look like Miwake-rendered JMDict HTML.",
      latestWord,
      latestEntryHTML,
    });
  }

  const targetSenseNumbers = parsedKey.senseNumbers ??
    oldParsed.senses.map((sense) => sense.number);
  if (targetSenseNumbers.some((senseNumber) => senseNumber > oldParsed.senses.length)) {
    return exceptional(note, parsedKey, {
      reason: "target-out-of-range",
      detail: "The key targets a sense number the stored entry does not have.",
      latestWord,
      latestEntryHTML,
    });
  }

  const spellingInLatest =
    latestWord.kanji.some((form) => form.text === parsedKey.recognitionTarget) ||
    latestWord.kana.some((form) => form.text === parsedKey.recognitionTarget);

  const alignment = alignSenses(oldParsed.senses, newParsed.senses);
  const base = {
    note,
    parsedKey,
    latestEntryHTML,
    latestWord,
    oldParsed,
    newParsed,
    alignment,
    targetSenseNumbers,
    mappedTargetSenses: mappedTargets(alignment, targetSenseNumbers),
    proposedKey: null as string | null,
    senseViews: buildSenseViews(alignment, newParsed, targetSenseNumbers),
    removedTargetedSenses: alignment.removedSenses
      .filter((sense) => targetSenseNumbers.includes(sense.number))
      .map((sense) => sense.number),
    changeChips: buildChangeChips(oldParsed, newParsed, alignment),
    needsAI: false,
  };

  if (storedEntryHTML === latestEntryHTML.trim()) {
    return {
      ...base,
      verdict: "unchanged",
      reason: "unchanged",
      detail: "The stored dictionary HTML already matches the latest rendering.",
    };
  }

  if (canonicalEntryHTML(storedEntryHTML) === canonicalEntryHTML(latestEntryHTML)) {
    return {
      ...base,
      verdict: "normalize",
      reason: "encoding-only",
      detail: "Only entity encoding or whitespace differs; nothing visible changes.",
    };
  }

  if (!spellingInLatest) {
    return {
      ...base,
      verdict: "exception",
      reason: "spelling-removed",
      detail: `The spelling "${parsedKey.recognitionTarget}" is no longer a form of this entry.`,
    };
  }

  if (oldParsed.senses.length === 1 && newParsed.senses.length === 1) {
    return {
      ...base,
      verdict: "routine",
      reason: "single-sense",
      detail: "One sense before and after — the card cannot be pointing at the wrong sense.",
    };
  }

  // An all-senses key implicitly targets any newly added sense too, so "the targeted senses
  // are intact" can only hold for it when the sense count is unchanged.
  const allSensesKeyGrewOrShrank = parsedKey.senseNumbers === null &&
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
    parsedKey.senseNumbers !== null &&
    renumberedTargets.every((pair) => pair !== undefined)
  ) {
    const proposedKey = formatMiwakeKey(
      parsedKey.recognitionTarget,
      parsedKey.jmdictId,
      renumberedTargets.map((pair) => pair!.new.number),
      newParsed.senses.length,
    );
    return {
      ...base,
      verdict: "routine",
      reason: "targets-renumbered",
      detail: "The targeted sense text is unchanged but moved to a different number.",
      proposedKey: proposedKey === note.fields.key ? null : proposedKey,
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
    reason: parsedKey.senseNumbers === null ? "all-senses-reshaped" : "target-changed",
    detail: parsedKey.senseNumbers === null
      ? "The card targeted all senses and the sense list changed shape."
      : "The text of a targeted sense changed.",
    needsAI: true,
  };
}

function exceptional(
  note: MiwakeNoteSnapshot,
  parsedKey: MiwakeKey | null,
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
    senseViews: [],
    removedTargetedSenses: [],
    changeChips: [],
    needsAI: false,
  };
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

  if (chips.length === 0) {
    chips.push({ kind: "formatting", label: "", text: "formatting-only difference" });
  }

  return chips;
}
