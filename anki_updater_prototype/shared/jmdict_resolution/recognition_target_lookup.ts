import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import * as path from "@std/path";
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

async function kuromojiTokenizer(): Promise<KuromojiTokenizer> {
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
