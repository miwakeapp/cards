import { isGeneratedSurfaceFormForLookupSpelling } from "./recognition_target.ts";

const JAPANESE_WORD_SEGMENTER = new Intl.Segmenter("ja", { granularity: "word" });

const PERMITTED_INSERTED_GRAMMATICAL_WORDS = new Set([
  "が",
  "を",
  "に",
  "へ",
  "と",
  "で",
  "の",
  "は",
  "も",
  "て",
  "だ",
  "には",
  "とは",
  "でも",
  "では",
  "にも",
  "とも",
  "への",
  "との",
]);

const DICTIONARY_FORM_PARTS_OF_SPEECH: Readonly<Record<string, readonly string[]>> = {
  う: ["v5u"],
  く: ["v5k"],
  ぐ: ["v5g"],
  す: ["v5s"],
  つ: ["v5t"],
  ぬ: ["v5n"],
  ぶ: ["v5b"],
  む: ["v5m"],
  る: ["v1", "v5r"],
  い: ["adj-i"],
};

function hiraganaWords(text: string): string[] {
  const words: string[] = [];
  let followsMixedScriptSegment = false;
  for (const { segment, isWordLike } of JAPANESE_WORD_SEGMENTER.segment(text)) {
    if (!isWordLike) {
      followsMixedScriptSegment = false;
      continue;
    }
    if (!/^\p{Script=Hiragana}+$/v.test(segment)) {
      followsMixedScriptSegment = /[\p{Script=Han}\p{Script=Katakana}]/v.test(segment);
      continue;
    }

    // ICU exposes kana suffixes of some mixed-script words as separate segments: `会えなかった`
    // can become `会` + `え` + `なか` + `っ` + `た`, for example. Do not mistake those suffix
    // fragments for independently generated words. A grammatical particle ends the mixed-script
    // word and restores ordinary lexical checking for what follows (`方針` + `が` + `ある`).
    if (followsMixedScriptSegment) {
      if (PERMITTED_INSERTED_GRAMMATICAL_WORDS.has(segment)) {
        followsMixedScriptSegment = false;
      }
      continue;
    }

    // One-mora segments are overwhelmingly particles or inflection fragments, and give us no
    // reliable lexical evidence. The one-mora `する`/`くる` source-stem exception is handled
    // separately by `sourceSupportsDictionaryForm()` rather than treating such fragments as words.
    if ([...segment].length > 1) words.push(segment);
  }
  return words;
}

function sourceSupportsDictionaryForm(word: string, sourceText: string): boolean {
  const partOfSpeech = word === "する"
    ? ["vs-i"]
    : word === "くる"
    ? ["vk"]
    : DICTIONARY_FORM_PARTS_OF_SPEECH[[...word].at(-1)!];
  if (partOfSpeech === undefined) return false;

  // `Intl.Segmenter` can split a kana-only inflection into several words, so compare every
  // contiguous substring of each source kana run with the resolver's exact inflection generator.
  // This is stricter than sharing a stem character: source `あの会社の方針` must not license an
  // invented `方針がある`, while source `ふんで` legitimately licenses dictionary-form `ふむ`.
  for (const match of sourceText.matchAll(/\p{Script=Hiragana}+/gv)) {
    const run = [...match[0]];
    for (let start = 0; start < run.length; ++start) {
      for (let end = start + 1; end <= run.length; ++end) {
        const sourceSurface = run.slice(start, end).join("");
        // A one-mora ichidan stem is indistinguishable from an accidental substring (`あ` in
        // `あの` must not license `ある`). Only the suppletive verbs need one-mora conjunctive
        // stems such as `し` and `き` recognized here.
        if ([...sourceSurface].length === 1 && word !== "する" && word !== "くる") continue;
        if (
          isGeneratedSurfaceFormForLookupSpelling(sourceSurface, word, { partOfSpeech })
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Finds kana-only words in generated text that have no deterministic support in source text.
 *
 * Exact source words are consumed as a multiset. New structural particles are permitted, as are
 * dictionary forms whose source inflection is found in one contiguous hiragana run. Mixed-script
 * words are deliberately outside this helper's scope: callers ground their lexical characters
 * separately, while this check closes the gap for content such as an invented `うそ`.
 *
 * Callers with protected spans, such as recognition targets, must remove those spans from both
 * arguments before calling this function.
 */
export function findSourceUnsupportedHiraganaWords(
  generatedText: string,
  sourceText: string,
): string[] {
  const available = new Map<string, number>();
  for (const word of hiraganaWords(sourceText)) {
    available.set(word, (available.get(word) ?? 0) + 1);
  }

  const unsupported = new Set<string>();
  for (const word of hiraganaWords(generatedText)) {
    const count = available.get(word) ?? 0;
    if (count > 0) {
      available.set(word, count - 1);
    } else if (
      !PERMITTED_INSERTED_GRAMMATICAL_WORDS.has(word) &&
      !sourceSupportsDictionaryForm(word, sourceText)
    ) {
      unsupported.add(word);
    }
  }
  return [...unsupported];
}
