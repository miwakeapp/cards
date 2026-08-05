import type { AcceptedJMDictUsage } from "card_creator";
import type { JMDictWord } from "data";

/** One acquisition-provenance edge accepted for the final recognition card. */
export interface AcceptedReadingUsage {
  entry: JMDictWord;
  kanaReading: string;
  applicableSenseNumbers: readonly number[];
}

/** Collapses reading provenance into `card_creator`'s independent usage and reading axes. */
export function cardCreatorInputForAcceptedReadings(
  accepted: readonly [AcceptedReadingUsage, ...AcceptedReadingUsage[]],
): {
  jmdictUsages: [AcceptedJMDictUsage, ...AcceptedJMDictUsage[]];
  kanaReadings: [string, ...string[]];
} {
  const sensesByEntryId = new Map<
    string,
    { entry: JMDictWord; senseNumbers: Set<number> }
  >();
  for (const usage of accepted) {
    const existing = sensesByEntryId.get(usage.entry.id);
    if (existing === undefined) {
      sensesByEntryId.set(usage.entry.id, {
        entry: usage.entry,
        senseNumbers: new Set(usage.applicableSenseNumbers),
      });
    } else {
      for (const senseNumber of usage.applicableSenseNumbers) {
        existing.senseNumbers.add(senseNumber);
      }
    }
  }

  const [firstJMDictUsage, ...remainingJMDictUsages] = [...sensesByEntryId.values()].map(
    ({ entry, senseNumbers }) => ({
      entry,
      applicableSenseNumbers: [...senseNumbers].toSorted((left, right) => left - right),
    }),
  );
  const [firstAccepted, ...remainingAccepted] = accepted;
  const additionalReadings = remainingAccepted.map(({ kanaReading }) => kanaReading).filter(
    (kanaReading, index, readings) =>
      kanaReading !== firstAccepted.kanaReading && readings.indexOf(kanaReading) === index,
  );
  return {
    jmdictUsages: [firstJMDictUsage, ...remainingJMDictUsages],
    kanaReadings: [firstAccepted.kanaReading, ...additionalReadings],
  };
}
