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

function isFunctionToken(token: KuromojiToken): boolean {
  if (token.pos === "助詞" || token.pos === "助動詞" || token.pos === "記号") {
    return true;
  }
  return token.pos === "動詞" &&
    (token.pos_detail_1 === "非自立" || isAuxiliaryVerbSuffix(token));
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function findMatchingTokenSpans(tokens: KuromojiToken[], target: string): KuromojiToken[][] {
  const spans: KuromojiToken[][] = [];

  for (let start = 0; start < tokens.length; ++start) {
    let combined = "";

    for (let end = start; end < tokens.length; ++end) {
      combined += tokens[end].surface_form;

      if (combined === target) {
        spans.push(tokens.slice(start, end + 1));
        break;
      }

      if (!target.startsWith(combined)) {
        break;
      }
    }
  }

  return spans;
}

function deriveCandidatesFromSpan(span: KuromojiToken[]): string[] {
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
  }

  const lexicalTokens = span.filter((token) => !isFunctionToken(token));

  if (lexicalTokens.length === 1) {
    const [token] = lexicalTokens;

    if (token.basic_form === "*") {
      return [];
    }

    if (
      token.pos === "動詞" ||
      token.pos === "形容詞" ||
      token.pos === "副詞" ||
      (token.pos === "名詞" && token.pos_detail_1 === "形容動詞語幹")
    ) {
      return [token.basic_form];
    }

    return [];
  }

  if (
    lexicalTokens.length === 2 &&
    lexicalTokens[0].pos === "名詞" &&
    isSuruVerb(lexicalTokens[1])
  ) {
    const noun = lexicalTokens[0].basic_form;
    return [`${noun}${lexicalTokens[1].basic_form}`, noun];
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
  const tokenSpans = findMatchingTokenSpans(tokenizer.tokenize(sentence), recognitionTarget);
  const candidates = tokenSpans.flatMap((span) => deriveCandidatesFromSpan(span));

  return unique(candidates).filter((candidate) => candidate !== recognitionTarget);
}
