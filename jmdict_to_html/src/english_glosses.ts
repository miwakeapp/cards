import type { JMdictGloss } from "@scriptin/jmdict-simplified-types";
import { translate } from "translate-american-british-english";

/** Removes British-spelled English glosses only when the same sense has an American equivalent. */
export function filterRedundantBritishEnglishGlosses(glosses: JMdictGloss[]): JMdictGloss[] {
  const americanized = glosses.map((gloss) =>
    gloss.lang === "eng" ? americanizeBritishSpelling(gloss.text) : undefined
  );
  const unchangedEnglishGlosses = new Set(
    glosses.flatMap((gloss, index) => {
      const result = americanized[index];
      return gloss.lang === "eng" && result?.changed === false ? [result.text] : [];
    }),
  );

  return glosses.filter((gloss, index) => {
    if (gloss.lang !== "eng") {
      return true;
    }
    const result = americanized[index]!;
    return !result.changed || !unchangedEnglishGlosses.has(result.text);
  });
}

function americanizeBritishSpelling(text: string): { text: string; changed: boolean } {
  const americanized = translate(text, { american: true });
  return { text: americanized, changed: americanized !== text };
}
