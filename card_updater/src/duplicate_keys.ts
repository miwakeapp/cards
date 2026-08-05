import { parseKey } from "card_model/keys";
import type { AnalyzedCard } from "./analyze.ts";

function usageIdentityKeys(
  key: string,
  entries: ReadonlyMap<string, { sense: readonly unknown[] }>,
): string[] {
  const parsedKey = parseKey(key);
  if (parsedKey === null) return [];

  return parsedKey.usages.flatMap((usage) => {
    const entry = entries.get(usage.jmdictId);
    if (entry === undefined) return [];
    const senseNumbers = usage.senseNumbers ?? entry.sense.map((_, index) => index + 1);
    return senseNumbers.filter((senseNumber) => senseNumber <= entry.sense.length).map(
      (senseNumber) => JSON.stringify([parsedKey.spelling, usage.jmdictId, senseNumber]),
    );
  }).toSorted();
}

/** Mutable semantic-usage index for collection-wide duplicate checks. */
export class RecognitionUnitIndex {
  readonly #entries: ReadonlyMap<string, { sense: readonly unknown[] }>;
  readonly #keysByNoteId = new Map<number, string>();
  readonly #ownersByUsage = new Map<string, Set<number>>();

  constructor(
    owners: readonly { noteId: number; key: string }[],
    entries: ReadonlyMap<string, { sense: readonly unknown[] }>,
  ) {
    this.#entries = entries;
    for (const owner of owners) this.update(owner.noteId, owner.key);
  }

  conflicts(noteId: number, key: string): number[] {
    const conflictingIds = new Set<number>();
    for (const usage of usageIdentityKeys(key, this.#entries)) {
      for (const ownerId of this.#ownersByUsage.get(usage) ?? []) {
        if (ownerId !== noteId) conflictingIds.add(ownerId);
      }
    }
    return [...conflictingIds].toSorted((a, b) => a - b);
  }

  update(noteId: number, key: string): void {
    const previousKey = this.#keysByNoteId.get(noteId);
    if (previousKey !== undefined) {
      for (const usage of usageIdentityKeys(previousKey, this.#entries)) {
        const owners = this.#ownersByUsage.get(usage)!;
        owners.delete(noteId);
        if (owners.size === 0) this.#ownersByUsage.delete(usage);
      }
    }

    this.#keysByNoteId.set(noteId, key);
    for (const usage of usageIdentityKeys(key, this.#entries)) {
      const owners = this.#ownersByUsage.get(usage) ?? new Set<number>();
      owners.add(noteId);
      this.#ownersByUsage.set(usage, owners);
    }
  }
}

/** Marks every card which overlaps another scanned recognition unit as an exception. */
export function flagDuplicateRecognitionUnits(
  cards: readonly AnalyzedCard[],
  entries: ReadonlyMap<string, { sense: readonly unknown[] }>,
): AnalyzedCard[] {
  const index = new RecognitionUnitIndex(
    cards.map((card) => ({ noteId: card.note.noteId, key: card.note.fields.key })),
    entries,
  );
  return cards.map((card) => {
    const conflicts = index.conflicts(card.note.noteId, card.note.fields.key);
    if (conflicts.length === 0 || card.verdict === "exception") return card;
    const noteIds = [card.note.noteId, ...conflicts]
      .toSorted((a, b) => a - b);
    return {
      ...card,
      verdict: "exception",
      reason: "duplicate-recognition-unit",
      detail: `Another scanned card represents the same JMDict entry/sense usage. Note IDs: ${
        noteIds.join(", ")
      }.`,
      needsAI: false,
    };
  });
}
