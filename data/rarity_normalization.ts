const spaceRegex = /[\s\u3000]+/gu;

/** Canonicalizes a corpus term or plain-text lookup key. */
export function normalizeRarityTerm(term: string): string {
  return term
    .normalize("NFKC")
    .replace(spaceRegex, "")
    .normalize("NFKC")
    .trim();
}
