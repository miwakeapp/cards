import type { JMdictGloss as ExternalJMdictGloss } from "@scriptin/jmdict-simplified-types";
import { translate } from "translate-american-british-english";

/**
 * JMDict gloss accepted by the renderer's spelling filter.
 * Like `JMDictWord`, this alias avoids Deno documentation lint treating the npm type as private.
 * @internal
 */
export type JMdictGloss = ExternalJMdictGloss;

/** Removes redundant British variants in parentheses and separate same-sense glosses. */
export function filterRedundantBritishEnglishGlosses(glosses: JMdictGloss[]): JMdictGloss[] {
  glosses = glosses.map((gloss) => {
    if (gloss.lang !== "eng") {
      return gloss;
    }
    const text = removeParentheticalBritishVariants(gloss.text);
    return text === gloss.text ? gloss : { ...gloss, text };
  });
  const redundant = redundantBritishVariants(
    glosses.filter((gloss) => gloss.lang === "eng").map((gloss) => gloss.text),
  );
  return glosses.filter((gloss) => gloss.lang !== "eng" || !redundant.has(gloss.text));
}

function removeParentheticalBritishVariants(text: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(/ *\(([^()]*)\)/gu)) {
    result += text.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const variant = match[1];
    const americanized = americanizeBritishSpelling(variant);
    const start = result.length - americanized.text.length;
    // Match a complete adjacent word or phrase, not a suffix inside another word.
    // Explanatory lists and qualifiers must not be treated as spelling aliases.
    const redundant = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/u.test(variant) &&
      americanized.changed && result.endsWith(americanized.text) &&
      (start === 0 || !/[\p{L}\p{M}\p{N}_'’-]/u.test(result[start - 1])) &&
      !/[\p{L}\p{M}\p{N}_]/u.test(text[lastIndex] ?? "");
    if (!redundant) {
      const items = variant.split(/,\s*/u);
      const redundantItems = redundantBritishVariants(items);
      result += redundantItems.size === 0
        ? match[0]
        : match[0].replace(variant, () =>
          items.filter((item) => !redundantItems.has(item)).join(", "));
    }
  }
  return result + text.slice(lastIndex);
}

function redundantBritishVariants(texts: string[]): Set<string> {
  const americanized = texts.map(americanizeBritishSpelling);
  const unchanged = new Set(
    texts.filter((_, index) => !americanized[index].changed),
  );
  return new Set(texts.filter((_, index) => {
    const result = americanized[index];
    return result.changed && unchanged.has(result.text);
  }));
}

function americanizeBritishSpelling(text: string): { text: string; changed: boolean } {
  const americanized = translate(text, { american: true });
  return { text: americanized, changed: americanized !== text };
}
