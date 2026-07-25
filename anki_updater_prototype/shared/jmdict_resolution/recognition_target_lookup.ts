import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import * as path from "@std/path";
import { toHiragana } from "japanese_text";
import kuromoji from "kuromoji";
import { createRequire } from "node:module";

export type SpellingIndex = {
  kanji: Map<string, JMdictWord[]>;
  kana: Map<string, JMdictWord[]>;
};

interface KuromojiToken {
  surface_form: string;
  basic_form: string;
  pos: string;
  pos_detail_1: string;
}

interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[];
}

interface MatchingTokenSpan {
  tokens: KuromojiToken[];
  endExclusive: number;
}

export interface SurfaceFormLookupOptions {
  /** JMDict part-of-speech tags for the already-selected entry. */
  partOfSpeech?: Iterable<string>;
  /** Allows a one-character target inside a larger token when stronger source evidence exists. */
  allowSingleCharacterSubstring?: boolean;
}

const require = createRequire(import.meta.url);
const kuromojiMainPath = require.resolve("kuromoji");
const kuromojiDictPath = path.join(path.dirname(kuromojiMainPath), "..", "dict");

let tokenizerPromise: Promise<KuromojiTokenizer> | null = null;

function createIndexMap(): Map<string, JMdictWord[]> {
  return new Map();
}

function addToIndex(index: Map<string, JMdictWord[]>, spelling: string, entry: JMdictWord) {
  const existing = index.get(spelling);
  if (existing) {
    existing.push(entry);
  } else {
    index.set(spelling, [entry]);
  }
}

function isAuxiliaryVerbSuffix(token: KuromojiToken): boolean {
  return token.pos === "動詞" &&
    token.pos_detail_1 === "接尾" &&
    ["れる", "られる", "せる", "させる"].includes(token.basic_form);
}

function isSuruVerb(token: KuromojiToken): boolean {
  return token.pos === "動詞" && token.basic_form === "する";
}

function isAruVerb(token: KuromojiToken): boolean {
  return token.pos === "動詞" && token.basic_form === "ある";
}

function isFunctionToken(token: KuromojiToken): boolean {
  if (token.pos === "助詞" || token.pos === "助動詞" || token.pos === "記号") {
    return true;
  }
  return token.pos === "動詞" &&
    (token.pos_detail_1 === "非自立" || isAruVerb(token) || isAuxiliaryVerbSuffix(token));
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function ichidanSurfaceForms(dictionaryForm: string, includeDerivedForms = true): string[] {
  if (!dictionaryForm.endsWith("る")) return [dictionaryForm];
  const stem = dictionaryForm.slice(0, -1);
  const forms = [
    dictionaryForm,
    `${stem}て`,
    `${stem}た`,
    `${stem}ない`,
    `${stem}なかった`,
    `${stem}なく`,
    `${stem}なければ`,
    `${stem}れば`,
    `${stem}ろ`,
    `${stem}よう`,
    stem,
  ];
  if (includeDerivedForms) {
    for (const derived of [`${stem}られる`, `${stem}させる`]) {
      forms.push(...ichidanSurfaceForms(derived, false));
    }
  }
  return forms;
}

const GODAN_ROWS: Record<string, { a: string; i: string; e: string; o: string }> = {
  う: { a: "わ", i: "い", e: "え", o: "お" },
  く: { a: "か", i: "き", e: "け", o: "こ" },
  ぐ: { a: "が", i: "ぎ", e: "げ", o: "ご" },
  す: { a: "さ", i: "し", e: "せ", o: "そ" },
  つ: { a: "た", i: "ち", e: "て", o: "と" },
  ぬ: { a: "な", i: "に", e: "ね", o: "の" },
  ぶ: { a: "ば", i: "び", e: "べ", o: "ぼ" },
  む: { a: "ま", i: "み", e: "め", o: "も" },
  る: { a: "ら", i: "り", e: "れ", o: "ろ" },
};

function godanTeAndPast(end: string): [string, string] | null {
  if (["う", "つ", "る"].includes(end)) return ["って", "った"];
  if (["む", "ぶ", "ぬ"].includes(end)) return ["んで", "んだ"];
  if (end === "く") return ["いて", "いた"];
  if (end === "ぐ") return ["いで", "いだ"];
  if (end === "す") return ["して", "した"];
  return null;
}

function godanSurfaceForms(dictionaryForm: string): string[] {
  const end = dictionaryForm.at(-1)!;
  const row = GODAN_ROWS[end];
  const teAndPast = godanTeAndPast(end);
  if (row === undefined || teAndPast === null) return [dictionaryForm];
  const stem = dictionaryForm.slice(0, -1);
  const aStem = `${stem}${row.a}`;
  const iStem = `${stem}${row.i}`;
  const eStem = `${stem}${row.e}`;
  const forms = [
    dictionaryForm,
    `${stem}${teAndPast[0]}`,
    `${stem}${teAndPast[1]}`,
    `${aStem}ない`,
    `${aStem}なかった`,
    `${aStem}なく`,
    `${aStem}ず`,
    `${aStem}ぬ`,
    `${eStem}ば`,
    eStem,
    `${stem}${row.o}う`,
    iStem,
  ];
  // Potential, passive, and causative forms conjugate as ichidan verbs. Expanding those bases
  // catches chains such as `紡ぎ出せなかった` and `叩きのめされた` without trusting the
  // tokenizer to segment the compound consistently.
  for (const derived of [`${eStem}る`, `${aStem}れる`, `${aStem}せる`]) {
    forms.push(...ichidanSurfaceForms(derived, false));
  }
  // `行く`-style verbs use the geminated te/past forms despite their `く` ending. Including both
  // possibilities is safe because the result still has to occur literally in the source.
  if (end === "く") forms.push(`${stem}って`, `${stem}った`);
  return forms;
}

function suruSurfaceForms(dictionaryForm: string): string[] {
  if (!dictionaryForm.endsWith("する")) return [dictionaryForm];
  const stem = dictionaryForm.slice(0, -"する".length);
  const forms = [
    dictionaryForm,
    `${stem}して`,
    `${stem}した`,
    `${stem}しない`,
    `${stem}しなかった`,
    `${stem}しなく`,
    `${stem}すれば`,
    `${stem}しろ`,
    `${stem}せよ`,
    `${stem}せず`,
    `${stem}せぬ`,
    `${stem}し`,
  ];
  for (const derived of [`${stem}される`, `${stem}させる`]) {
    forms.push(...ichidanSurfaceForms(derived, false));
  }
  return forms;
}

function adjectiveSurfaceForms(dictionaryForm: string): string[] {
  if (!dictionaryForm.endsWith("い")) return [dictionaryForm];
  const stem = dictionaryForm.slice(0, -1);
  const forms = [
    dictionaryForm,
    `${stem}く`,
    `${stem}かった`,
    `${stem}くない`,
    `${stem}くなかった`,
    `${stem}くなく`,
    `${stem}ければ`,
    `${stem}さ`,
    `${stem}み`,
  ];
  // Some fixed negative expressions are tagged as i-adjectives in JMDict even though their
  // literary `ず`/`ぬ` forms expose the underlying verb, e.g. `そぐわない` → `そぐわず`.
  if (dictionaryForm.endsWith("ない")) {
    const negativeStem = dictionaryForm.slice(0, -"ない".length);
    forms.push(`${negativeStem}ず`, `${negativeStem}ぬ`);
  }
  return forms;
}

interface TargetDrivenSurfaceForms {
  forms: string[];
  /** Conjunctive stems whose literal occurrence may instead be part of another lexical item. */
  conjunctiveStems: Set<string>;
}

function targetDrivenSurfaceForms(
  lookupSpelling: string,
  partOfSpeech: Iterable<string> | undefined,
): TargetDrivenSurfaceForms {
  const tags = new Set(partOfSpeech ?? []);
  const forms = [lookupSpelling];
  const conjunctiveStems = new Set<string>();
  if ([...tags].some((tag) => tag.startsWith("v5"))) {
    forms.push(...godanSurfaceForms(lookupSpelling));
    const row = GODAN_ROWS[lookupSpelling.at(-1)!];
    if (row !== undefined) {
      conjunctiveStems.add(toHiragana(`${lookupSpelling.slice(0, -1)}${row.i}`));
    }
  }
  if ([...tags].some((tag) => tag === "v1" || tag.startsWith("v1-"))) {
    forms.push(...ichidanSurfaceForms(lookupSpelling));
    if (lookupSpelling.endsWith("る")) {
      conjunctiveStems.add(toHiragana(lookupSpelling.slice(0, -1)));
    }
  }
  if ([...tags].some((tag) => tag === "vs" || tag.startsWith("vs-"))) {
    forms.push(...suruSurfaceForms(lookupSpelling));
    if (lookupSpelling.endsWith("する")) {
      conjunctiveStems.add(
        toHiragana(`${lookupSpelling.slice(0, -"する".length)}し`),
      );
    }
  }
  if (tags.has("adj-i")) {
    forms.push(...adjectiveSurfaceForms(lookupSpelling));
  }
  return {
    forms: unique(forms).sort((left, right) => right.length - left.length),
    conjunctiveStems,
  };
}

function literalSurfaceMatches(
  sentence: string,
  surfaceForms: Iterable<string>,
  allowSingleCharacterSubstring: boolean,
): string[] {
  const normalizedSentence = toHiragana(sentence);
  const matches: Array<{ start: number; end: number; surface: string }> = [];
  for (const form of surfaceForms) {
    if ([...form].length < 2 && !allowSingleCharacterSubstring) continue;
    const normalizedForm = toHiragana(form);
    let start = normalizedSentence.indexOf(normalizedForm);
    while (start !== -1) {
      const end = start + normalizedForm.length;
      matches.push({ start, end, surface: sentence.slice(start, end) });
      start = normalizedSentence.indexOf(normalizedForm, start + 1);
    }
  }
  // Prefer the longest valid conjugation at each occurrence. This keeps `たべて` instead of the
  // bare conjunctive stem `たべ`, while still retaining genuinely distinct occurrences.
  return unique(
    matches
      .filter((match) =>
        !matches.some((other) => other.start === match.start && other.end > match.end)
      )
      .sort((left, right) => left.start - right.start)
      .map((match) => match.surface),
  );
}

/**
 * A bare conjunctive stem is unsafe when the same characters are a strict substring of one
 * tokenizer token. For example, `食べ` is a valid inflection of `食べる`, but the occurrence in
 * `食べ物` belongs to a different lexical item. Exact-token stems such as `剥き出し`, and stems
 * crossing an unreliable token boundary such as `憑き` in `憑きもの`, remain available.
 *
 * Since callers mark every occurrence of a returned surface, one embedded occurrence makes that
 * surface ambiguous even when another occurrence is independently valid.
 */
function stemHasEmbeddedOccurrence(
  sentence: string,
  surface: string,
  tokens: readonly KuromojiToken[],
): boolean {
  const tokenRanges: Array<{ start: number; end: number }> = [];
  let tokenStart = 0;
  for (const token of tokens) {
    const tokenEnd = tokenStart + token.surface_form.length;
    tokenRanges.push({ start: tokenStart, end: tokenEnd });
    tokenStart = tokenEnd;
  }

  for (
    let start = sentence.indexOf(surface);
    start !== -1;
    start = sentence.indexOf(surface, start + 1)
  ) {
    const end = start + surface.length;
    if (
      tokenRanges.some((token) =>
        token.start <= start && end <= token.end &&
        (token.start < start || end < token.end)
      )
    ) {
      return true;
    }
  }
  return false;
}

function tokenLookupForm(token: KuromojiToken): string {
  return token.basic_form === "*" ? token.surface_form : token.basic_form;
}

function isInflectionContinuation(token: KuromojiToken): boolean {
  return token.pos === "助詞" || token.pos === "助動詞" ||
    isAuxiliaryVerbSuffix(token) || isSuruVerb(token);
}

function surfaceSuffixCandidates(surface: string): string[] {
  return [
    "である",
    "だった",
    "でした",
    "ない",
    "だ",
    "で",
    "の",
    "に",
  ]
    .filter((suffix) => surface.endsWith(suffix) && surface.length > suffix.length)
    .map((suffix) => surface.slice(0, -suffix.length));
}

function surfaceTrailingSuruCandidates(sentence: string, recognitionTarget: string): string[] {
  const candidates: string[] = [];

  for (const suffix of ["する", "にする"]) {
    const candidate = `${recognitionTarget}${suffix}`;
    if (sentence.includes(candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function tokenBasicCandidates(token: KuromojiToken): string[] {
  if (token.basic_form === "*") {
    return [];
  }

  const candidates = [token.basic_form];

  if (token.pos === "動詞" && token.basic_form.endsWith("する")) {
    candidates.push(token.basic_form.slice(0, -"する".length));
  }

  if (token.pos === "副詞" && token.basic_form.endsWith("と")) {
    candidates.push(token.basic_form.slice(0, -"と".length));
  }

  if (token.surface_form.endsWith("く")) {
    candidates.push(`${token.surface_form.slice(0, -"く".length)}い`);
  }

  return unique(candidates).filter((candidate) => candidate.length > 0);
}

function findMatchingTokenSpans(tokens: KuromojiToken[], target: string): MatchingTokenSpan[] {
  const spans: MatchingTokenSpan[] = [];

  for (let start = 0; start < tokens.length; ++start) {
    let combined = "";

    for (let end = start; end < tokens.length; ++end) {
      combined += tokens[end].surface_form;

      if (combined === target) {
        spans.push({
          tokens: tokens.slice(start, end + 1),
          endExclusive: end + 1,
        });
        break;
      }

      if (!target.startsWith(combined)) {
        break;
      }
    }
  }

  return spans;
}

function deriveTrailingSuruCandidates(tokens: KuromojiToken[], span: MatchingTokenSpan): string[] {
  if (span.tokens.some(isSuruVerb)) {
    return [];
  }

  const lexicalTokens = span.tokens.filter((token) => !isFunctionToken(token));
  if (lexicalTokens.length !== 1) {
    return [];
  }

  const [token] = lexicalTokens;
  if (!["名詞", "副詞", "形容詞"].includes(token.pos)) {
    return [];
  }

  const nextToken = tokens[span.endExclusive];
  if (nextToken && isSuruVerb(nextToken)) {
    return tokenBasicCandidates(token).map((candidate) => `${candidate}する`);
  }

  const nextNextToken = tokens[span.endExclusive + 1];
  if (
    nextToken?.pos === "助詞" &&
    nextToken.surface_form === "に" &&
    nextNextToken &&
    isSuruVerb(nextNextToken)
  ) {
    return tokenBasicCandidates(token).map((candidate) => `${candidate}にする`);
  }

  return [];
}

function deriveLeadingModifierCandidates(
  span: KuromojiToken[],
  lexicalTokens: KuromojiToken[],
): string[] {
  if (lexicalTokens.length < 2) {
    return [];
  }

  const [first, second] = lexicalTokens;
  const firstIndex = span.indexOf(first);
  const tokenAfterFirst = span[firstIndex + 1];

  if (first.pos === "副詞") {
    return tokenBasicCandidates(first);
  }

  if (first.pos === "形容詞" && second.pos === "動詞" && second.basic_form === "なる") {
    return tokenBasicCandidates(first);
  }

  if (
    first.pos === "名詞" &&
    tokenAfterFirst?.pos === "助詞" &&
    tokenAfterFirst.surface_form === "に"
  ) {
    return tokenBasicCandidates(first);
  }

  return [];
}

function deriveCandidatesFromSpan(span: KuromojiToken[]): string[] {
  const spanSurface = span.map((token) => token.surface_form).join("");
  const suruIndex = span.findIndex(isSuruVerb);
  if (suruIndex > 0) {
    const precedingSpan = span.slice(0, suruIndex);
    const precedingLexicalTokens = precedingSpan.filter((token) => !isFunctionToken(token));

    if (
      precedingLexicalTokens.length === 1 &&
      precedingLexicalTokens[0].pos === "名詞" &&
      precedingLexicalTokens[0].basic_form !== "*" &&
      precedingSpan.some((token) => token.pos === "助詞" && token.surface_form === "に")
    ) {
      return [`${precedingLexicalTokens[0].basic_form}にする`];
    }

    if (
      precedingLexicalTokens.length === 1 &&
      ["副詞", "形容詞"].includes(precedingLexicalTokens[0].pos) &&
      precedingLexicalTokens[0].basic_form !== "*"
    ) {
      return tokenBasicCandidates(precedingLexicalTokens[0]);
    }
  }

  const lexicalTokens = span.filter((token) => !isFunctionToken(token));
  const directSurfaceCandidates = lexicalTokens.length === 1 && lexicalTokens[0].pos !== "動詞"
    ? surfaceSuffixCandidates(spanSurface)
    : [];

  if (lexicalTokens.length === 1) {
    const [token] = lexicalTokens;

    if (
      token.pos === "動詞" ||
      token.pos === "形容詞" ||
      token.pos === "副詞" ||
      token.pos === "名詞" ||
      (token.pos === "名詞" && token.pos_detail_1 === "形容動詞語幹")
    ) {
      const candidates = tokenBasicCandidates(token);

      if (spanSurface.endsWith("なく") && !token.basic_form.endsWith("ない")) {
        candidates.push(`${token.basic_form}ない`);
      }

      return unique([...directSurfaceCandidates, ...candidates]);
    }

    return directSurfaceCandidates;
  }

  if (
    lexicalTokens.length === 2 &&
    lexicalTokens[0].pos === "動詞" &&
    lexicalTokens[1].pos === "形容詞" &&
    lexicalTokens[1].basic_form === "やすい"
  ) {
    return tokenBasicCandidates(lexicalTokens[0]);
  }

  if (
    lexicalTokens.length === 2 &&
    lexicalTokens[0].pos === "名詞" &&
    isSuruVerb(lexicalTokens[1])
  ) {
    const noun = lexicalTokens[0].basic_form;
    return [`${noun}${lexicalTokens[1].basic_form}`, noun];
  }

  const leadingModifierCandidates = deriveLeadingModifierCandidates(span, lexicalTokens);
  if (leadingModifierCandidates.length > 0) {
    return leadingModifierCandidates;
  }

  if (spanSurface.endsWith("そうだ")) {
    const verb = lexicalTokens.find((token) => token.pos === "動詞");
    if (verb) {
      return tokenBasicCandidates(verb);
    }
  }

  return [];
}

function kuromojiTokenizer(): Promise<KuromojiTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: kuromojiDictPath }).build((
        error: Error | null,
        tokenizer: unknown,
      ) => {
        if (error) {
          reject(error);
        } else {
          resolve(tokenizer as KuromojiTokenizer);
        }
      });
    });
  }

  return tokenizerPromise;
}

export function buildSpellingIndex(entries: Iterable<JMdictWord>): SpellingIndex {
  const kanji = createIndexMap();
  const kana = createIndexMap();

  for (const entry of entries) {
    for (const item of entry.kanji) {
      addToIndex(kanji, item.text, entry);
    }
    for (const item of entry.kana) {
      addToIndex(kana, item.text, entry);
    }
  }

  return { kanji, kana };
}

export function findEntriesBySpelling(index: SpellingIndex, spelling: string): JMdictWord[] {
  const kanjiMatches = index.kanji.get(spelling) ?? [];
  if (kanjiMatches.length > 0) {
    return kanjiMatches;
  }
  return index.kana.get(spelling) ?? [];
}

export async function deriveLookupSpellings(
  sentence: string,
  recognitionTarget: string,
): Promise<string[]> {
  if (!sentence.includes(recognitionTarget)) {
    return [];
  }

  const tokenizer = await kuromojiTokenizer();
  const tokens = tokenizer.tokenize(sentence);
  const tokenSpans = findMatchingTokenSpans(tokens, recognitionTarget);
  const candidates = [
    ...surfaceTrailingSuruCandidates(sentence, recognitionTarget),
    ...tokenSpans.flatMap((span) => [
      ...deriveCandidatesFromSpan(span.tokens),
      ...deriveTrailingSuruCandidates(tokens, span),
    ]),
  ];

  return unique(candidates).filter((candidate) => candidate !== recognitionTarget);
}

/**
 * Finds the surface form(s) in a sentence that deinflect to a dictionary spelling.
 *
 * Exact occurrences are returned immediately. Otherwise, tokenizer spans are tested with the
 * same deinflection rules as `deriveLookupSpellings()`. Multiple distinct results are retained so
 * callers can decline ambiguous conversions instead of guessing which occurrence to highlight.
 */
export async function findSurfaceFormsForLookupSpelling(
  sentence: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): Promise<string[]> {
  const targetDrivenForms = targetDrivenSurfaceForms(
    lookupSpelling,
    options.partOfSpeech,
  );
  let targetDrivenMatches = literalSurfaceMatches(
    sentence,
    targetDrivenForms.forms,
    options.allowSingleCharacterSubstring === true,
  );
  const unsafeConjunctiveSurfaces = new Set<string>();
  let tokenizer: KuromojiTokenizer | undefined;
  let tokens: KuromojiToken[] | undefined;
  if (
    targetDrivenMatches.some((surface) =>
      targetDrivenForms.conjunctiveStems.has(toHiragana(surface))
    )
  ) {
    tokenizer = await kuromojiTokenizer();
    const sentenceTokens = tokenizer.tokenize(sentence);
    tokens = sentenceTokens;
    targetDrivenMatches = targetDrivenMatches.filter((surface) => {
      if (
        targetDrivenForms.conjunctiveStems.has(toHiragana(surface)) &&
        stemHasEmbeddedOccurrence(sentence, surface, sentenceTokens)
      ) {
        unsafeConjunctiveSurfaces.add(surface);
        return false;
      }
      return true;
    });
  }
  if (targetDrivenMatches.length > 0) return targetDrivenMatches;

  const safeSurfaceMatches = (surfaces: Iterable<string>): string[] =>
    unique(surfaces).filter((surface) => !unsafeConjunctiveSurfaces.has(surface));

  tokenizer ??= await kuromojiTokenizer();
  tokens ??= tokenizer.tokenize(sentence);
  const exactMatches = findMatchingTokenSpans(tokens, lookupSpelling);
  if (exactMatches.length > 0) {
    const safeMatches = safeSurfaceMatches(
      exactMatches.map((match) => match.tokens.map((token) => token.surface_form).join("")),
    );
    if (safeMatches.length > 0) return safeMatches;
  }
  // Kuromoji sometimes treats a valid multi-character word plus an adjacent suffix as one token
  // (e.g. `色とりどり` or `安全圏内`). The already-resolved JMDict entry makes a literal fallback
  // safe for nontrivial spellings, while excluding dangerous one-character substrings such as
  // `生` inside `生活`.
  if (
    [...lookupSpelling].length >= 2 &&
    sentence.includes(lookupSpelling) &&
    !unsafeConjunctiveSurfaces.has(lookupSpelling)
  ) {
    return [lookupSpelling];
  }

  const lookupTokens = tokenizer.tokenize(lookupSpelling);
  const sequenceMatches: string[] = [];
  if (lookupTokens.length > 0) {
    for (let start = 0; start + lookupTokens.length <= tokens.length; ++start) {
      const matchesLookupTokens = lookupTokens.every((lookupToken, offset) =>
        tokenLookupForm(tokens[start + offset]) === tokenLookupForm(lookupToken)
      );
      if (!matchesLookupTokens) {
        continue;
      }

      let endExclusive = start + lookupTokens.length;
      while (endExclusive < tokens.length && isInflectionContinuation(tokens[endExclusive])) {
        ++endExclusive;
      }
      sequenceMatches.push(
        tokens.slice(start, endExclusive).map((token) => token.surface_form).join(""),
      );
    }
  }
  if (sequenceMatches.length > 0) {
    const safeMatches = safeSurfaceMatches(sequenceMatches);
    if (safeMatches.length > 0) return safeMatches;
  }

  const matches: string[] = [];

  for (let start = 0; start < tokens.length; ++start) {
    if (isFunctionToken(tokens[start])) {
      continue;
    }

    let maximumEnd = start + 1;
    while (maximumEnd < tokens.length && maximumEnd < start + 8) {
      const token = tokens[maximumEnd];
      if (!isInflectionContinuation(token)) {
        break;
      }
      ++maximumEnd;
    }

    // Prefer the complete inflected form, then shorten only if a trailing function token changes
    // the lookup result. This includes `て`/`た` and passive suffixes, but excludes aspectual verbs
    // such as the `きた` in `潤ってきた`.
    for (let endExclusive = maximumEnd; endExclusive > start; --endExclusive) {
      const span = tokens.slice(start, endExclusive);
      const derived = [
        ...deriveCandidatesFromSpan(span),
        ...deriveTrailingSuruCandidates(tokens, { tokens: span, endExclusive }),
      ];
      if (derived.includes(lookupSpelling)) {
        matches.push(span.map((token) => token.surface_form).join(""));
        break;
      }
    }
  }

  return safeSurfaceMatches(matches);
}
