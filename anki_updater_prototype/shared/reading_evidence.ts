import { bccwjLUW2LemmaReadingHit } from "data/rarity";

/** Corpus evidence for the focused reading-selection operation. */
export async function readingEvidence(recognitionTarget: string, kanaReading: string) {
  return {
    kanaReading,
    bccwjFrequencyPerMillion:
      (await bccwjLUW2LemmaReadingHit(recognitionTarget, kanaReading))?.totalPMW ?? null,
  };
}

/** Encounter-supported readings bypass this filter; it applies only to proposed alternatives. */
export function hasRejectedReadingTag(tags: readonly string[]): boolean {
  return tags.some((tag) => tag === "ok" || tag === "rk" || tag === "sk");
}
