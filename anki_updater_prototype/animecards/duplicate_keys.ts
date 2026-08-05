import type { JMDictWord } from "data";
import { parseKey } from "card_model/keys";
import { normalizePlainText } from "./html.ts";
import { type ConversionCandidate, senseResolutionIsComplete, type SkippedNote } from "./types.ts";

export interface ExistingMiwakeCard {
  noteId: number;
  key: string;
}

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

export function removeDuplicateKeys(
  candidates: ConversionCandidate[],
  existingCards: readonly ExistingMiwakeCard[],
  sourceWordField: string,
  entries: ReadonlyMap<string, JMDictWord>,
): { candidates: ConversionCandidate[]; skipped: SkippedNote[] } {
  const complete = candidates.filter((candidate) =>
    senseResolutionIsComplete(candidate.senseResolution)
  );
  const ownersByKey = new Map<string, Array<{ noteId: number; key: string }>>();
  const ownersByUsage = new Map<string, Array<{ noteId: number; key: string }>>();
  const addOwner = (
    map: Map<string, Array<{ noteId: number; key: string }>>,
    identity: string,
    owner: { noteId: number; key: string },
  ) => map.set(identity, [...(map.get(identity) ?? []), owner]);

  for (const card of existingCards) {
    addOwner(ownersByKey, card.key, card);
    for (const usage of usageIdentityKeys(card.key, entries)) {
      addOwner(ownersByUsage, usage, card);
    }
  }
  for (const candidate of complete) {
    const owner = { noteId: candidate.noteId, key: candidate.target.fields["Key"] };
    addOwner(ownersByKey, owner.key, owner);
    for (
      const usage of usageIdentityKeys(owner.key, entries)
    ) {
      addOwner(ownersByUsage, usage, owner);
    }
  }

  const kept: ConversionCandidate[] = [];
  const skipped: SkippedNote[] = [];
  for (const candidate of complete) {
    const key = candidate.target.fields["Key"];
    const sameKeyOwners = ownersByKey.get(key) ?? [];
    const semanticOwners = usageIdentityKeys(key, entries).flatMap((usage) =>
      ownersByUsage.get(usage) ?? []
    );
    const conflicts = [
      ...new Map(
        [...sameKeyOwners, ...semanticOwners]
          .filter(({ noteId }) => noteId !== candidate.noteId)
          .map((owner) => [owner.noteId, owner]),
      ).values(),
    ];
    if (conflicts.length === 0) {
      kept.push(candidate);
      continue;
    }

    const crossesKeys = conflicts.some((owner) => owner.key !== key);
    const noteIds = [candidate.noteId, ...conflicts.map(({ noteId }) => noteId)].toSorted((a, b) =>
      a - b
    );
    skipped.push({
      noteId: candidate.noteId,
      word: normalizePlainText(candidate.original.fields[sourceWordField] ?? ""),
      reason: crossesKeys ? "duplicate-miwake-recognition-unit" : "duplicate-miwake-key",
      detail: `${key}; note IDs: ${noteIds.join(", ")}`,
    });
  }
  kept.push(
    ...candidates.filter((candidate) => !senseResolutionIsComplete(candidate.senseResolution)),
  );
  return { candidates: kept, skipped };
}
