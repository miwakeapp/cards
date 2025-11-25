// Expand various JMdict tags into human-readable form.
import type { Tag } from "@scriptin/jmdict-simplified-types";
import { assert } from "@std/assert";
import rawTags from "./jmdict_tags.json" with { type: "json" };

const tags = rawTags as Record<string, string>;

// The partOfSpeech property of a JMdictSense.
export function partOfSpeech(partOfSpeech: Tag): string {
  switch (partOfSpeech) {
    // Nouns
    case "n":
      return "noun";
    case "n-t":
      return "temporal noun";
    case "n-adv":
      return "adverbial noun";
    case "n-pref":
      return "noun (prefix)";
    case "n-suf":
      return "noun (suffix)";

    // Adjectives
    case "adj-i":
      return `<span lang="ja">い</span>-adj`;
    case "adj-na":
      return `<span lang="ja">な</span>-adj`;
    case "adj-no":
      return `<span lang="ja">の</span>-adj`;
    case "adj-t":
      return `<span lang="ja">たる</span>-adj`;
    case "adj-f":
      return "prenominal";
    case "adj-pn":
      return `<span lang="ja">連体詞</span>`;
    case "adj-ix":
      return `<span lang="ja">いい／よい</span>-adj`;
    case "adj-kari":
    case "adj-ku":
    case "adj-shiku":
    case "adj-nari":
      return "archaic adj";
    case "aux-adj":
      return "auxiliary adj";

    // Adverbs
    case "adv":
      return "adverb";
    case "adv-to":
      return `<span lang="ja">と</span>-adverb`;

    // Verbs - Ichidan
    case "v1":
    case "v1-s":
      return `<span lang="ja">1段</span> verb`;

    // Verbs - Godan
    case "v5b":
    case "v5g":
    case "v5k":
    case "v5k-s":
    case "v5m":
    case "v5n":
    case "v5r":
    case "v5r-i":
    case "v5s":
    case "v5t":
    case "v5u":
    case "v5u-s":
    case "v5aru":
    case "v5uru":
      return `<span lang="ja">5段</span> verb`;

    // Verbs - suru
    case "vs":
    case "vs-s":
    case "vs-i":
    case "vs-c":
      return `<span lang="ja">する</span> verb`;

    // Verbs - irregular
    case "vk":
      return `<span lang="ja">来る</span> verb`;
    case "vz":
      return `<span lang="ja">ずる</span> verb`;
    case "vr":
    case "vn":
      return "irregular verb";

    // Verbs - archaic (Nidan, Yodan)
    case "v2a-s":
    case "v2b-k":
    case "v2b-s":
    case "v2d-k":
    case "v2d-s":
    case "v2g-k":
    case "v2g-s":
    case "v2h-k":
    case "v2h-s":
    case "v2k-k":
    case "v2k-s":
    case "v2m-k":
    case "v2m-s":
    case "v2n-s":
    case "v2r-k":
    case "v2r-s":
    case "v2s-s":
    case "v2t-k":
    case "v2t-s":
    case "v2w-s":
    case "v2y-k":
    case "v2y-s":
    case "v2z-s":
      return `<span lang="ja">2段</span> verb`;
    case "v4b":
    case "v4g":
    case "v4h":
    case "v4k":
    case "v4m":
    case "v4n":
    case "v4r":
    case "v4s":
    case "v4t":
      return `<span lang="ja">4段</span> verb`;

    // Verb transitivity
    case "vt":
      return "transitive";
    case "vi":
      return "intransitive";

    // Verb misc
    case "v-unspec":
      return "verb";

    // Other parts of speech
    case "exp":
      return "expression";
    case "int":
      return "interjection";

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
    case "hon":
      return "尊敬語";
    case "hum":
      return "謙譲語";
    case "form":
      return "formal";
    case "fam":
      return "familiar";
    case "vulg":
      return "vulgar";
    case "dated":
      return "dated";
    case "obs":
      return "obsolete";
    case "rare":
      return "rare";
    case "joc":
      return "humorous";
    case "poet":
      return "poetic";
    case "male":
      return "male term";
    case "fem":
      return "female term";
    case "chn":
      return "children's";
    case "on-mim":
      return "mimetic";
    case "yoji":
      return "四字熟語";
    case "id":
      return "idiom";

    default:
      assert(misc in tags, `Unknown misc: ${misc}`);
      return tags[misc];
  }
}

// The field property of a JMdictSense.
export function field(field: Tag): string {
  switch (field) {
    case "elec":
      return "electrical";
    case "mech":
      return "mechanical";

    default:
      assert(field in tags, `Unknown field: ${field}`);
      return tags[field];
  }
}

// The tags property of a JMdictKana or JMdictKanji.
export function tag(tag: Tag): string {
  // http://www.edrdg.org/wiki/index.php/Kanji_and_Reading_Information_Fields
  switch (tag) {
    case "rk":
    case "rK":
      return "rare";
    case "ik":
    case "iK":
      return "irregular";
    case "ok":
    case "oK":
      return "outdated";
    case "sk":
    case "sK":
      return "search-only";
    case "io":
      return "irregular 送り仮名";
    case "ateji":
      return "当て字";
    case "gikun":
      return "義訓・熟字訓";
    default:
      assert(tag in tags, `Unknown tag: ${tag}`);
      return tags[tag];
  }
}
