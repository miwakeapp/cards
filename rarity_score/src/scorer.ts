import { bccwjLUW2LemmaHit, nwjcSurface1GramHit } from "data";
import { unescape } from "@std/html/entities";

// These anchors are part of the public score definition. The rare endpoint sits just below one
// occurrence in the current NWJC corpus, while the common endpoint intentionally groups the most
// frequent grammatical terms at zero.
const RAREST_ZIPF = -1.5;
const COMMONEST_ZIPF = 6.5;
const htmlTagRegex = /<\/?[a-z][^>]*>/gi;

export interface RarityLookup {
  nwjcSurface1Gram(target: string): Promise<{ count: number; tokenTotal: number } | null>;
  bccwjLUW2Lemma(target: string): Promise<{ totalPMW: number } | null>;
}

const dataRarityLookup: RarityLookup = {
  nwjcSurface1Gram: nwjcSurface1GramHit,
  bccwjLUW2Lemma: bccwjLUW2LemmaHit,
};

/** Returns rarity from 0 (most common) to 100 (rarest), or null when unscored. */
export function scoreRecognitionTarget(target: string): Promise<number | null> {
  return scoreRecognitionTargetWithLookup(target, dataRarityLookup);
}

export async function scoreRecognitionTargetWithLookup(
  target: string,
  lookup: RarityLookup,
): Promise<number | null> {
  const plainTarget = unescape(target.replace(htmlTagRegex, "")).trim();
  if (!plainTarget) {
    return null;
  }

  const [nwjcHit, bccwjHit] = await Promise.all([
    lookup.nwjcSurface1Gram(plainTarget),
    lookup.bccwjLUW2Lemma(plainTarget),
  ]);
  const nwjcZipf = nwjcHit ? Math.log10(nwjcHit.count * 1_000_000_000 / nwjcHit.tokenTotal) : null;
  const bccwjZipf = bccwjHit && bccwjHit.totalPMW > 0
    ? Math.log10(bccwjHit.totalPMW * 1_000)
    : null;

  if (nwjcZipf === null) {
    return bccwjZipf === null ? null : rarityFromZipf(bccwjZipf);
  }
  return rarityFromZipf(bccwjZipf === null ? nwjcZipf : Math.max(nwjcZipf, bccwjZipf));
}

function rarityFromZipf(zipf: number): number {
  return clamp(
    (COMMONEST_ZIPF - zipf) / (COMMONEST_ZIPF - RAREST_ZIPF) * 100,
    0,
    100,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
