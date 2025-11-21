// Expand various JMdict tags into human-readable form.
import type { Tag } from "@scriptin/jmdict-simplified-types";
import { assert } from "@std/assert";
import rawTags from "./jmdict_tags.json" with { type: "json" };

const tags = rawTags as Record<string, string>;

// The partOfSpeech property of a JMdictSense.
export function partOfSpeech(partOfSpeech: Tag): string {
  switch (partOfSpeech) {
    case "n":
      return "noun";
    case "adv":
      return "adverb";
    case "adv-to":
      return `<span lang="ja">と</span>-adverb`;
    case "adj-na":
      return `<span lang="ja">な</span>-adj`;
    case "adj-i":
      return `<span lang="ja">い</span>-adj`;
    case "adj-no":
      return `<span lang="ja">の</span>-adj`;
    case "adj-f":
      return "prenoun modifier";
    case "v1":
      return `<span lang="ja">1段</span> verb`;
    case "v5b":
    case "v5g":
    case "v5k":
    case "v5m":
    case "v5n":
    case "v5r":
    case "v5s":
    case "v5t":
    case "v5u":
      return `<span lang="ja">5段</span> verb`;
    case "vs":
    case "vs-s":
    case "vs-i":
      return `<span lang="ja">する</span> verb`;
    case "vt":
      return "transitive";
    case "vi":
      return "intransitive";
    case "exp":
      return "expression";
    default:
      assert(partOfSpeech in tags, `Unknown part of speech: ${partOfSpeech}`);
      return tags[partOfSpeech];
  }
}

// The misc property of a JMdictSense.
export function misc(misc: Tag): string {
  switch (misc) {
    case "uk":
      return "usually kana";
    case "pol":
      return "polite";
    case "on-mim":
      return "mimetic";
    case "yoji":
      return "四字熟語";
    default:
      assert(misc in tags, `Unknown misc: ${misc}`);
      return tags[misc];
  }
}

// The field property of a JMdictSense.
export function field(field: Tag): string {
  assert(field in tags, `Unknown field: ${field}`);
  return tags[field];
}

// The tags property of a JMdictKana or JMdictKanji.
export function tag(tag: Tag): string {
  // http://www.edrdg.org/wiki/index.php/Kanji_and_Reading_Information_Fields
  switch (tag) {
    case "rk":
    case "rK":
      return "rarely-used";
    case "ik":
    case "iK":
      return "irregular";
    case "sk":
    case "sK":
      return "search-only";
    case "ateji":
      return "ateji";
    case "gikun":
      return `<span lang="ja">義訓・熟字訓</span>`;
    default:
      assert(tag in tags, `Unknown tag: ${tag}`);
      return tags[tag];
  }
}
