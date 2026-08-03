import * as path from "@std/path";
import type { JMDictWord } from "data";
import { toHiragana } from "japanese_text";
import kuromoji from "kuromoji";
import { createRequire } from "node:module";
import type { RenderedTextOccurrence } from "./rendered_text.ts";

/** An index of JMDict entries by their exact kanji and kana spellings. */
export type SpellingIndex = {
  kanji: Map<string, JMDictWord[]>;
  kana: Map<string, JMDictWord[]>;
};

interface KuromojiToken {
  surface_form: string;
  basic_form: string;
  pos: string;
  pos_detail_1: string;
  conjugated_form: string;
}

interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[];
}

interface MatchingTokenSpan {
  tokens: KuromojiToken[];
  start: number;
  endExclusive: number;
}

/** Controls deterministic surface-form lookup for an already-selected JMDict spelling. */
export interface SurfaceFormLookupOptions {
  /**
   * JMDict part-of-speech tags for the already-selected entry.
   *
   * Exact and tokenizer-backed lookup remain available when this is omitted, but deterministic
   * spelling-driven inflection generation requires these tags.
   */
  partOfSpeech?: Iterable<string>;
  /** Allows a one-character target inside a larger token when stronger source evidence exists. */
  allowSingleCharacterSubstring?: boolean;
  /**
   * Requires kana in generated source forms to preserve the spelling's hiragana/katakana choices.
   *
   * Source lookup normally treats the scripts as pronunciation-equivalent. Enable this when
   * validating an already-created card whose recognition target must retain source orthography.
   */
  requireExactKanaScript?: boolean;
}

const require = createRequire(import.meta.url);
const kuromojiMainPath = require.resolve("kuromoji");
const kuromojiDictPath = path.join(path.dirname(kuromojiMainPath), "..", "dict");
const ALL_KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/v;

let tokenizerPromise: Promise<KuromojiTokenizer> | null = null;

function addToIndex(index: Map<string, JMDictWord[]>, spelling: string, entry: JMDictWord) {
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

function appearanceSurfaceForms(stem: string): string[] {
  return [
    `${stem}そう`,
    `${stem}そうな`,
    `${stem}そうに`,
    `${stem}そうだ`,
    `${stem}そうで`,
    `${stem}そうだった`,
  ];
}

function verbStemSurfaceForms(stem: string): string[] {
  return [
    `${stem}ます`,
    `${stem}ました`,
    `${stem}ません`,
    `${stem}ませんでした`,
    `${stem}ましょう`,
    `${stem}たい`,
    `${stem}たく`,
    `${stem}たかった`,
    `${stem}たくない`,
    `${stem}たくなかった`,
    `${stem}ながら`,
    ...appearanceSurfaceForms(stem),
  ];
}

function kuruSurfaceForms(dictionaryForm: string): string[] {
  const kanjiSuffix = "来る";
  const kanaSuffix = "くる";
  if (!dictionaryForm.endsWith(kanjiSuffix) && !dictionaryForm.endsWith(kanaSuffix)) {
    return [dictionaryForm];
  }

  const usesKanji = dictionaryForm.endsWith(kanjiSuffix);
  const prefix = dictionaryForm.slice(0, -(usesKanji ? kanjiSuffix : kanaSuffix).length);
  const conjunctiveStem = `${prefix}${usesKanji ? "来" : "き"}`;
  const negativeStem = `${prefix}${usesKanji ? "来" : "こ"}`;
  const conditionalStem = `${prefix}${usesKanji ? "来れ" : "くれ"}`;
  const forms = [
    dictionaryForm,
    `${conjunctiveStem}て`,
    `${conjunctiveStem}た`,
    `${conjunctiveStem}たり`,
    `${negativeStem}ない`,
    `${negativeStem}なかった`,
    `${negativeStem}なく`,
    `${negativeStem}なくて`,
    `${negativeStem}なければ`,
    `${negativeStem}なきゃ`,
    `${conditionalStem}ば`,
    `${conjunctiveStem}たら`,
    `${negativeStem}い`,
    `${negativeStem}よう`,
    ...verbStemSurfaceForms(conjunctiveStem),
    conjunctiveStem,
  ];
  for (
    const derived of [
      `${negativeStem}られる`,
      `${negativeStem}させる`,
    ]
  ) {
    forms.push(...ichidanSurfaceForms(derived, false));
  }
  return forms;
}

function kuruConjunctiveStem(dictionaryForm: string): string | undefined {
  if (dictionaryForm.endsWith("来る")) {
    return `${dictionaryForm.slice(0, -"来る".length)}来`;
  }
  if (dictionaryForm.endsWith("くる")) {
    return `${dictionaryForm.slice(0, -"くる".length)}き`;
  }
  return undefined;
}

function ichidanSurfaceForms(dictionaryForm: string, includeDerivedForms = true): string[] {
  if (!dictionaryForm.endsWith("る")) return [dictionaryForm];
  const stem = dictionaryForm.slice(0, -1);
  const forms = [
    dictionaryForm,
    `${stem}て`,
    `${stem}た`,
    `${stem}たり`,
    `${stem}ない`,
    `${stem}なかった`,
    `${stem}なく`,
    `${stem}なくて`,
    `${stem}なければ`,
    `${stem}なきゃ`,
    `${stem}れば`,
    `${stem}たら`,
    `${stem}ろ`,
    `${stem}よう`,
    ...verbStemSurfaceForms(stem),
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
    `${stem}${teAndPast[1]}り`,
    `${aStem}ない`,
    `${aStem}なかった`,
    `${aStem}なく`,
    `${aStem}なくて`,
    `${aStem}ず`,
    `${aStem}ぬ`,
    `${aStem}なきゃ`,
    `${eStem}ば`,
    `${stem}${teAndPast[1]}ら`,
    eStem,
    `${stem}${row.o}う`,
    ...verbStemSurfaceForms(iStem),
    iStem,
  ];
  // Potential, passive, and causative forms conjugate as ichidan verbs. Expanding those bases
  // catches chains such as `紡ぎ出せなかった` and `叩きのめされた` without trusting the
  // tokenizer to segment the compound consistently.
  for (
    const derived of [
      `${eStem}る`,
      `${aStem}れる`,
      `${aStem}せる`,
      `${aStem}される`,
      `${aStem}せられる`,
    ]
  ) {
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
    `${stem}したり`,
    `${stem}しない`,
    `${stem}しなかった`,
    `${stem}しなく`,
    `${stem}しなくて`,
    `${stem}しなきゃ`,
    `${stem}すれば`,
    `${stem}したら`,
    `${stem}しろ`,
    `${stem}せよ`,
    `${stem}せず`,
    `${stem}せぬ`,
    `${stem}しよう`,
    ...verbStemSurfaceForms(`${stem}し`),
    `${stem}し`,
  ];
  for (const derived of [`${stem}される`, `${stem}させる`]) {
    forms.push(...ichidanSurfaceForms(derived, false));
  }
  return forms;
}

function zuruSurfaceForms(dictionaryForm: string): string[] {
  if (!dictionaryForm.endsWith("ずる")) return [dictionaryForm];
  const stem = dictionaryForm.slice(0, -"ずる".length);
  const jiStem = `${stem}じ`;
  const forms = [
    dictionaryForm,
    `${jiStem}て`,
    `${jiStem}た`,
    `${jiStem}たり`,
    `${jiStem}ない`,
    `${jiStem}なかった`,
    `${jiStem}なく`,
    `${jiStem}なくて`,
    `${jiStem}なきゃ`,
    `${stem}ずれば`,
    `${jiStem}たら`,
    `${jiStem}ろ`,
    `${stem}ぜよ`,
    ...verbStemSurfaceForms(jiStem),
    jiStem,
  ];
  for (const derived of [`${jiStem}られる`, `${jiStem}させる`]) {
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
    `${stem}くて`,
    `${stem}かった`,
    `${stem}かったり`,
    `${stem}くない`,
    `${stem}くなかった`,
    `${stem}くなく`,
    `${stem}ければ`,
    `${stem}さ`,
    `${stem}み`,
    `${stem}げ`,
    ...appearanceSurfaceForms(stem),
  ];
  // `よい` and adjectives ending in `ない` conventionally insert `さ` before appearance `そう`.
  if (dictionaryForm === "よい" || dictionaryForm.endsWith("ない")) {
    forms.push(...appearanceSurfaceForms(`${stem}さ`));
  }
  // Literary and affectionate attributive constructions retain the stem of `～しい`
  // adjectives before `の`, as in `麗しの友` and `愛しの君`. This is not a general i-adjective
  // form: accepting arbitrary stems would misread strings such as `高の原` as forms of `高い`.
  if (dictionaryForm.endsWith("しい")) forms.push(`${stem}の`);
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
  /** Suppletive `ない` forms that must be independent rather than another verb's auxiliary. */
  independentNaiForms: Set<string>;
}

function targetDrivenSurfaceForms(
  lookupSpelling: string,
  partOfSpeech: Iterable<string> | undefined,
): TargetDrivenSurfaceForms {
  const tags = new Set(partOfSpeech ?? []);
  const forms = [lookupSpelling];
  const conjunctiveStems = new Set<string>();
  const independentNaiForms = new Set<string>();
  if ([...tags].some((tag) => tag.startsWith("v5"))) {
    forms.push(...godanSurfaceForms(lookupSpelling));
    // `ある` uses the suppletive negative `ない`; Kuromoji therefore cannot connect these forms
    // by their dictionary form in the tokenizer-backed fallback.
    if (tags.has("v5r-i") && lookupSpelling === "ある") {
      const suppletiveForms = ["ない", "なかった", "なく", "なくて", "なければ", "なきゃ"];
      forms.push(...suppletiveForms);
      for (const form of suppletiveForms) independentNaiForms.add(form);
    }
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
  if (tags.has("vz")) {
    forms.push(...zuruSurfaceForms(lookupSpelling));
    if (lookupSpelling.endsWith("ずる")) {
      conjunctiveStems.add(
        toHiragana(`${lookupSpelling.slice(0, -"ずる".length)}じ`),
      );
    }
  }
  if (tags.has("vk")) {
    forms.push(...kuruSurfaceForms(lookupSpelling));
    const conjunctiveStem = kuruConjunctiveStem(lookupSpelling);
    if (conjunctiveStem !== undefined) {
      conjunctiveStems.add(toHiragana(conjunctiveStem));
    }
  }
  if (tags.has("adj-i")) {
    forms.push(...adjectiveSurfaceForms(lookupSpelling));
  }
  return {
    forms: unique(forms).sort((left, right) => right.length - left.length),
    conjunctiveStems,
    independentNaiForms,
  };
}

/**
 * Whether a complete candidate is a deterministic inflection of an already-selected spelling.
 *
 * This checks only spelling- and part-of-speech-driven morphology; unlike occurrence lookup, it
 * does not inspect surrounding text or consult the tokenizer. Kana script is compared exactly:
 * generated text must preserve orthography, whereas source occurrence lookup deliberately accepts
 * publisher-side hiragana/katakana variation. This is intended for validating an isolated surface
 * that another stage has already delimited exactly.
 */
export function isGeneratedSurfaceFormForLookupSpelling(
  candidateSurface: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): boolean {
  if (lookupSpelling === "") {
    throw new RangeError("lookupSpelling must not be empty");
  }
  return targetDrivenSurfaceForms(lookupSpelling, options.partOfSpeech).forms.includes(
    candidateSurface,
  );
}

function literalSurfaceMatches(
  sentence: string,
  surfaceForms: Iterable<string>,
  allowSingleCharacterSubstring: boolean,
  requireExactKanaScript: boolean,
): RenderedTextOccurrence[] {
  const searchableSentence = requireExactKanaScript ? sentence : toHiragana(sentence);
  const matches: RenderedTextOccurrence[] = [];
  for (const form of surfaceForms) {
    if (form === "") continue;
    if ([...form].length < 2 && !allowSingleCharacterSubstring) continue;
    const searchableForm = requireExactKanaScript ? form : toHiragana(form);
    let start = searchableSentence.indexOf(searchableForm);
    while (start !== -1) {
      const end = start + searchableForm.length;
      matches.push({ start, end, surface: sentence.slice(start, end) });
      start = searchableSentence.indexOf(searchableForm, start + 1);
    }
  }
  // Prefer the longest valid conjugation at each occurrence. This keeps `たべて` instead of the
  // bare conjunctive stem `たべ`, while still retaining genuinely distinct occurrences.
  const seen = new Set<string>();
  return matches
    .filter((match) =>
      !matches.some((other) => other.start === match.start && other.end > match.end)
    )
    .sort((left, right) => left.start - right.start)
    .filter((match) => {
      const key = `${match.start}:${match.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Whether an occurrence is embedded in a tokenizer token for a different lexical item. */
function occurrenceIsEmbeddedInDifferentToken(
  occurrence: RenderedTextOccurrence,
  tokens: readonly KuromojiToken[],
  lookupSpelling: string,
  onlyAllKanaTokens = false,
): boolean {
  let tokenStart = 0;
  for (const token of tokens) {
    const tokenEnd = tokenStart + token.surface_form.length;
    const isStrictlyEmbedded = tokenStart <= occurrence.start &&
      occurrence.end <= tokenEnd &&
      (tokenStart < occurrence.start || occurrence.end < tokenEnd);
    if (isStrictlyEmbedded) {
      if (onlyAllKanaTokens && !ALL_KANA.test(token.surface_form)) {
        return false;
      }
      if (
        tokenBasicCandidates(token).includes(lookupSpelling)
      ) {
        return false;
      }
      // Kuromoji occasionally incorporates sentence-final `よ` into an imperative token and
      // assigns it the wrong potential-verb lemma (`拭き取れよ` → `拭き取れる`). Preserve that
      // finite form, but reject every other candidate embedded in a different lexical token:
      // otherwise a generated imperative such as `焼け` falsely matches the noun `焼け跡`.
      // Add other tokenizer-fusion exceptions only after characterizing their exact metadata.
      const isImperativeWithMergedYo = tokenStart === occurrence.start &&
        token.surface_form === `${occurrence.surface}よ` &&
        token.pos === "動詞" &&
        token.conjugated_form === "命令ｙｏ";
      return !isImperativeWithMergedYo;
    }
    tokenStart = tokenEnd;
  }
  return false;
}

function occurrenceStartsAtIndependentNai(
  occurrence: RenderedTextOccurrence,
  tokens: readonly KuromojiToken[],
): boolean {
  let tokenStart = 0;
  for (const token of tokens) {
    if (tokenStart === occurrence.start) {
      return token.basic_form === "ない" && token.pos === "形容詞" &&
        token.pos_detail_1 === "自立";
    }
    tokenStart += token.surface_form.length;
  }
  return false;
}

function tokenLookupForm(token: KuromojiToken): string {
  const basicForm = token.basic_form === "*" ? token.surface_form : token.basic_form;
  // Independent `いい` uses the suppletive inflectional paradigm of `よい`. Kuromoji therefore
  // tokenizes `カッコいい` as `カッコ` + `いい`, but `カッコよく` as `カッコ` + `よい`.
  // Normalize only the standalone adjective token: lexical adjectives such as `かわいい` retain
  // their own basic form and continue to conjugate regularly as `かわいく`.
  return token.pos === "形容詞" && basicForm === "いい" ? "よい" : basicForm;
}

const INFLECTIONAL_AUXILIARY_BASIC_FORMS = new Set([
  "ない",
  "ぬ",
  "ん",
  "ます",
  "た",
  "う",
  "たい",
]);

function isInflectionContinuation(token: KuromojiToken): boolean {
  if (isAuxiliaryVerbSuffix(token) || isSuruVerb(token)) {
    return true;
  }

  // Retain tightly bound auxiliaries which select an inflectional stem of the encountered
  // predicate. The boundary is morphosyntactic, not semantic: desiderative `たい` and volitional
  // `う` are included, while constructions following an already-complete predicate, such as
  // `べきだ`, `だろう`, and `らしい`, remain outside. An allowlist is intentional: treating every
  // tokenizer `助動詞` as inflection previously expanded `取り締まる` to `取り締まるべきだ` and
  // `もたらす` to `もたらすだろう`.
  if (token.pos === "助動詞" && INFLECTIONAL_AUXILIARY_BASIC_FORMS.has(token.basic_form)) {
    return true;
  }

  // Kuromoji separates a small set of inflectional endings from the lexical token. Do not treat
  // arbitrary particles as morphology: doing so would swallow sentence-final `か`/`ね`, case
  // particles, or discourse connectives into the highlighted word.
  return token.pos === "助詞" && token.pos_detail_1 === "接続助詞" &&
    ["て", "で", "ば"].includes(token.surface_form);
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
          start,
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

function tokenOffsets(tokens: readonly KuromojiToken[]): number[] {
  const offsets = [0];
  for (const token of tokens) {
    offsets.push(offsets.at(-1)! + token.surface_form.length);
  }
  return offsets;
}

function tokenRangeOccurrence(
  sentence: string,
  offsets: readonly number[],
  start: number,
  endExclusive: number,
): RenderedTextOccurrence {
  const occurrenceStart = offsets[start];
  const occurrenceEnd = offsets[endExclusive];
  return {
    start: occurrenceStart,
    end: occurrenceEnd,
    surface: sentence.slice(occurrenceStart, occurrenceEnd),
  };
}

function uniqueOccurrences(
  occurrences: Iterable<RenderedTextOccurrence>,
): RenderedTextOccurrence[] {
  const seen = new Set<string>();
  return [...occurrences]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter((occurrence) => {
      const key = `${occurrence.start}:${occurrence.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeNonoverlappingOccurrences(
  ...groups: readonly RenderedTextOccurrence[][]
): RenderedTextOccurrence[] {
  const merged: RenderedTextOccurrence[] = [];
  for (const group of groups) {
    for (const occurrence of uniqueOccurrences(group)) {
      const overlapsExisting = merged.some((existing) =>
        occurrence.start < existing.end && existing.start < occurrence.end
      );
      if (!overlapsExisting) merged.push(occurrence);
    }
  }
  return uniqueOccurrences(merged);
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
      token.pos === "名詞"
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

/** Builds an exact-spelling index from a collection of JMDict entries. */
export function buildSpellingIndex(entries: Iterable<JMDictWord>): SpellingIndex {
  const kanji = new Map<string, JMDictWord[]>();
  const kana = new Map<string, JMDictWord[]>();

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

/**
 * Finds entries with an exact JMDict spelling.
 *
 * Kanji-form matches take precedence over kana-form matches, mirroring JMDict's distinct form
 * categories when an identical string occurs in both.
 */
export function findEntriesBySpelling(index: SpellingIndex, spelling: string): JMDictWord[] {
  const kanjiMatches = index.kanji.get(spelling) ?? [];
  if (kanjiMatches.length > 0) {
    return kanjiMatches;
  }
  return index.kana.get(spelling) ?? [];
}

/**
 * Derives possible dictionary spellings from an encountered recognition target.
 *
 * The result contains only alternatives to the supplied target. Callers should separately try an
 * exact spelling before consulting these tokenizer-backed candidates.
 */
export async function deriveLookupSpellings(
  sentence: string,
  recognitionTarget: string,
): Promise<string[]> {
  if (recognitionTarget === "") {
    throw new RangeError("recognitionTarget must not be empty");
  }
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
 * Finds occurrences in a sentence that deinflect to a dictionary spelling.
 *
 * Offsets are UTF-16 string offsets. Literal/generated forms and tokenizer-derived forms are
 * merged so that a sentence can contain both, such as dictionary-form `来る` and past `来た`.
 * Keeping every occurrence distinct prevents an unrelated use of the same surface text from
 * being highlighted accidentally. When lookup strategies produce overlapping candidates, the
 * target-driven form wins, followed by an exact tokenizer span and then a derived span.
 */
export async function findSurfaceFormOccurrencesForLookupSpelling(
  sentence: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): Promise<RenderedTextOccurrence[]> {
  if (lookupSpelling === "") {
    throw new RangeError("lookupSpelling must not be empty");
  }
  const partOfSpeech = options.partOfSpeech === undefined ? undefined : [...options.partOfSpeech];
  const targetDrivenForms = targetDrivenSurfaceForms(
    lookupSpelling,
    partOfSpeech,
  );
  let targetDrivenMatches = literalSurfaceMatches(
    sentence,
    targetDrivenForms.forms,
    options.allowSingleCharacterSubstring === true,
    options.requireExactKanaScript === true,
  );
  let tokenizer: KuromojiTokenizer | undefined;
  let tokens: KuromojiToken[] | undefined;
  const hasInflectablePartOfSpeech = targetDrivenForms.conjunctiveStems.size > 0;
  const hasAffixPartOfSpeech =
    partOfSpeech?.some((tag) =>
      tag === "pref" || tag === "n-pref" || tag === "suf" || tag === "n-suf"
    ) ?? false;
  // With no script boundary inside one all-kana tokenizer token, an exact substring does not
  // establish lexical identity: `パン` in `フライパン` is not the bread entry. Mixed-script
  // compounds such as `色とりどり` retain their visible boundary, and explicit affix entries may
  // legitimately attach inside a larger token.
  const needsAllKanaTokenBoundary = ALL_KANA.test(lookupSpelling) &&
    !hasAffixPartOfSpeech;
  if (hasInflectablePartOfSpeech || needsAllKanaTokenBoundary) {
    tokenizer = await kuromojiTokenizer();
    const sentenceTokens = tokenizer.tokenize(sentence);
    tokens = sentenceTokens;
    // Inflected forms must not be substrings of a different lexical token. Validate each
    // occurrence independently: in `異なる…なる`, only the standalone `なる` is this entry.
    targetDrivenMatches = targetDrivenMatches.filter((occurrence) => {
      const normalizedSurface = toHiragana(occurrence.surface);
      if (
        hasInflectablePartOfSpeech &&
        targetDrivenForms.independentNaiForms.has(normalizedSurface) &&
        !occurrenceStartsAtIndependentNai(occurrence, sentenceTokens)
      ) {
        return false;
      }
      return !occurrenceIsEmbeddedInDifferentToken(
        occurrence,
        sentenceTokens,
        lookupSpelling,
        !hasInflectablePartOfSpeech,
      );
    });
  }
  tokenizer ??= await kuromojiTokenizer();
  tokens ??= tokenizer.tokenize(sentence);
  const offsets = tokenOffsets(tokens);
  const exactMatches = findMatchingTokenSpans(tokens, lookupSpelling).map((match) =>
    tokenRangeOccurrence(sentence, offsets, match.start, match.endExclusive)
  );

  const lookupTokens = tokenizer.tokenize(lookupSpelling);
  const sequenceMatches: RenderedTextOccurrence[] = [];
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
      sequenceMatches.push(tokenRangeOccurrence(sentence, offsets, start, endExclusive));
    }
  }
  const derivedMatches: RenderedTextOccurrence[] = [];

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
        ...deriveTrailingSuruCandidates(tokens, { tokens: span, start, endExclusive }),
      ];
      if (derived.includes(lookupSpelling)) {
        derivedMatches.push(tokenRangeOccurrence(sentence, offsets, start, endExclusive));
        break;
      }
    }
  }

  // A tokenizer-backed finite form can extend a generated conjunctive stem (`食べ` →
  // `食べましょう`). Prefer the longest direct morphological candidate only when the selected
  // part of speech establishes such a stem. For a noun such as `業` in `業だ`, the exact literal
  // match must keep priority over the tokenizer's generic noun-plus-copula sequence.
  const directMorphologyMatches = hasInflectablePartOfSpeech
    ? uniqueOccurrences([...targetDrivenMatches, ...sequenceMatches])
    : targetDrivenMatches;

  return mergeNonoverlappingOccurrences(
    directMorphologyMatches,
    exactMatches,
    ...(hasInflectablePartOfSpeech ? [] : [sequenceMatches]),
    derivedMatches,
  );
}

function exactSurfaceOccurrences(sentence: string, surface: string): RenderedTextOccurrence[] {
  const occurrences: RenderedTextOccurrence[] = [];
  for (
    let start = sentence.indexOf(surface);
    start !== -1;
    start = sentence.indexOf(surface, start + 1)
  ) {
    occurrences.push({ start, end: start + surface.length, surface });
  }
  return occurrences;
}

/**
 * Finds distinct surface strings that safely identify all of their occurrences in a sentence.
 *
 * Prefer `findSurfaceFormOccurrencesForLookupSpelling()` when the caller can preserve explicit
 * ranges. This compatibility API omits a surface when the same text also occurs as a different
 * lexical item, because a string-only marker would otherwise highlight that unrelated occurrence.
 */
export async function findSurfaceFormsForLookupSpelling(
  sentence: string,
  lookupSpelling: string,
  options: SurfaceFormLookupOptions = {},
): Promise<string[]> {
  const occurrences = await findSurfaceFormOccurrencesForLookupSpelling(
    sentence,
    lookupSpelling,
    options,
  );
  const selectedRanges = new Set(occurrences.map(({ start, end }) => `${start}:${end}`));

  return unique(occurrences.map(({ surface }) => surface)).filter((surface) =>
    exactSurfaceOccurrences(sentence, surface).every(({ start, end }) =>
      selectedRanges.has(`${start}:${end}`)
    )
  );
}
