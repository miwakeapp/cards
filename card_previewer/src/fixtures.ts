import { type FieldName, fieldOrder } from "card_model";

export const cardFieldNames = fieldOrder;

export type CardFieldName = FieldName;
export type CardFields = Record<CardFieldName, string>;

export interface PreviewFixtureDefinition {
  id: string;
  additionalEntryIds?: readonly string[];
  optionLabel: string;
  reason: string;
  fields: Omit<CardFields, "Dictionary">;
}

export interface PreviewFixture extends PreviewFixtureDefinition {
  primaryTerm: string;
  fields: CardFields;
}

/**
 * A deliberately small cross-section of card and dictionary behavior. Keep the reason user-facing:
 * both preview modes expose it alongside the fixture selector.
 */
export const fixtureDefinitions: PreviewFixtureDefinition[] = [
  {
    id: "1211360",
    optionLabel: "堪忍袋の緒が切れる — long mixed furigana",
    reason:
      "The original wrapping regression: a long expression mixes a wide ruby group, kana, and smaller ruby groups near likely line breaks.",
    fields: {
      "Key": "堪忍袋の緒が切れる | 1211360:1",
      "Recognition target": "堪忍袋の緒が切れる",
      "Reading": "堪忍袋[かんにんぶくろ]の 緒[お]が 切[き]れる",
      "Hint": "",
      "Full context":
        "<mark>堪忍袋[かんにんぶくろ]の 緒[お]が 切[き]れそうになった</mark>時、三谷の咳の連続が途絶えた。",
      "Minimized context": "",
      "Source": "『わたし、定時で帰ります。』",
    },
  },
  {
    id: "1358280",
    optionLabel: "食べる — short ruby baseline",
    reason:
      "A short, common mixed kanji–kana word makes front/back height changes easy to spot without any wrapping noise.",
    fields: {
      "Key": "食べる | 1358280:1,2",
      "Recognition target": "食べる",
      "Reading": "食[た]べる",
      "Hint": "",
      "Full context": "朝ご飯を<mark>食[た]べて</mark>から出かけた。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1591900",
    optionLabel: "綺麗 — template interactions",
    reason:
      "Exercises a hint, minimized/full context expando, search-only forms, and relevant-sense highlighting on a multi-sense entry.",
    fields: {
      "Key": "綺麗 | 1591900:2",
      "Recognition target": "綺麗",
      "Reading": "綺[き] 麗[れい]",
      "Hint": "清潔で整っている",
      "Full context":
        "部屋は隅々まで掃除されていて、以前とは見違えるほど<mark>綺[き] 麗[れい]になっていた</mark>。",
      "Minimized context": "以前とは見違えるほど<mark>綺[き] 麗[れい]になっていた</mark>。",
      "Source": "Conditional-template fixture",
    },
  },
  {
    id: "2030540",
    optionLabel: "狂喜乱舞 — simple dense compound",
    reason:
      "The simplest dictionary-entry fixture, paired with four adjacent ruby groups for a dense but compact reading line.",
    fields: {
      "Key": "狂喜乱舞 | 2030540:1",
      "Recognition target": "狂喜乱舞",
      "Reading": "狂[きょう] 喜[き] 乱[らん] 舞[ぶ]",
      "Hint": "",
      "Full context": "知らせを聞いて、皆が<mark>狂[きょう] 喜[き] 乱[らん] 舞[ぶ]した</mark>。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1414110",
    optionLabel: "大小 — many senses",
    reason:
      "One reading fans out into six senses with per-sense metadata, which also makes selected-sense deemphasis visible on the card.",
    fields: {
      "Key": "大小 | 1414110:1,3",
      "Recognition target": "大小",
      "Reading": "大[だい] 小[しょう]",
      "Hint": "",
      "Full context": "品物の<mark>大[だい] 小[しょう]</mark>を比べた。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1590470",
    optionLabel: "画期的 — multiple forms, one sense",
    reason:
      "Multiple written forms and readings collapse into a single sense, stressing the compact forms rows without a long definition.",
    fields: {
      "Key": "画期的 | 1590470:1",
      "Recognition target": "画期的",
      "Reading": "画[かっ] 期[き] 的[てき]",
      "Hint": "",
      "Full context": "それは当時としては<mark>画[かっ] 期[き] 的[てき]な方法</mark>だった。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1000230",
    optionLabel: "明かん — dialect and variants",
    reason:
      "Kanji and kana variants combine with dialect, miscellaneous, and explanatory metadata across two senses.",
    fields: {
      "Key": "明かん | 1000230:1",
      "Recognition target": "明かん",
      "Reading": "明[あ]かん",
      "Hint": "",
      "Full context": "そんなことをしたら<mark>明[あ]かん</mark>。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1014630",
    optionLabel: "アウター — antonym and abbreviation",
    reason:
      "A kana-only entry with an antonym and an abbreviated sense checks metadata that is intentionally hidden in the minimal style.",
    fields: {
      "Key": "アウター | 1014630:2",
      "Recognition target": "アウター",
      "Reading": "アウター",
      "Hint": "",
      "Full context": "冷えてきたので<mark>アウター</mark>を羽織った。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1061000",
    optionLabel: "シノニム — related references",
    reason:
      "Related-sense references and field labels appear on an otherwise compact kana-only entry.",
    fields: {
      "Key": "シノニム | 1061000:1",
      "Recognition target": "シノニム",
      "Reading": "シノニム",
      "Hint": "",
      "Full context": "この二語は<mark>シノニム</mark>として扱われる。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1122910",
    optionLabel: "ホルモン — language source and dialect",
    reason: "A kana-only loanword whose senses include language-source and dialect metadata.",
    fields: {
      "Key": "ホルモン | 1122910:2",
      "Recognition target": "ホルモン",
      "Reading": "ホルモン",
      "Hint": "",
      "Full context": "店で<mark>ホルモン</mark>を焼いて食べた。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1158110",
    optionLabel: "異名 — reading restrictions",
    reason:
      "Two readings, spelling restrictions, and field labels exercise the relationship between the forms rows and sense metadata.",
    fields: {
      "Key": "異名 | 1158110:1",
      "Recognition target": "異名",
      "Reading": "異[い] 名[みょう]",
      "Hint": "",
      "Full context": "彼は「鉄人」の<mark>異[い] 名[みょう]</mark>で知られる。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "2858813",
    additionalEntryIds: ["1550670"],
    optionLabel: "裏面 — equivalent entries",
    reason:
      "Two pronunciations share one selected meaning but belong to entries with different additional senses, exercising per-entry highlighting and the multi-entry divider.",
    fields: {
      "Key": "裏面 | 1550670:1;2858813:1",
      "Recognition target": "裏面",
      "Reading": "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
      "Hint": "物の後ろ側",
      "Full context": "封筒の<mark>裏[うら] 面[めん]</mark>に住所を書いた。",
      "Minimized context": "封筒の<mark>裏[うら] 面[めん]</mark>に書いた。",
      "Source": "Multi-entry fixture",
    },
  },
  {
    id: "1632080",
    optionLabel: "松明 — whole-word gikun",
    reason:
      "An irregular whole-word reading checks ruby whose annotation cannot be aligned one kanji at a time, plus uncommon form tags.",
    fields: {
      "Key": "松明 | 1632080:1",
      "Recognition target": "松明",
      "Reading": "松明[たいまつ]",
      "Hint": "",
      "Full context": "暗い道を<mark>松明[たいまつ]</mark>で照らした。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "2013080",
    optionLabel: "没する — form restrictions and verb types",
    reason:
      "Four senses combine form applicability restrictions with transitive and intransitive verb metadata.",
    fields: {
      "Key": "没する | 2013080:1,2",
      "Recognition target": "没する",
      "Reading": "没[ぼっ]する",
      "Hint": "",
      "Full context": "船は夕闇の中へ<mark>没[ぼっ]した</mark>。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1178920",
    optionLabel: "於いて — search-only forms",
    reason:
      "Several old-fashioned forms, including search-only forms, combine with shared notes and related references.",
    fields: {
      "Key": "於いて | 1178920:1",
      "Recognition target": "於いて",
      "Reading": "於[お]いて",
      "Hint": "",
      "Full context": "会議は東京に<mark>於[お]いて</mark>開催された。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "2228700",
    optionLabel: "彼岸桜 — shared tags",
    reason:
      "Shared related tags and mixed miscellaneous labels show how inherited metadata lands in a two-sense entry.",
    fields: {
      "Key": "彼岸桜 | 2228700:1",
      "Recognition target": "彼岸桜",
      "Reading": "彼[ひ] 岸[がん] 桜[ざくら]",
      "Hint": "",
      "Full context": "庭の<mark>彼[ひ] 岸[がん] 桜[ざくら]</mark>が咲いた。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "2861582",
    optionLabel: "トスアップ — shared field and source",
    reason:
      "A recent kana-only entry carries shared subject-field and language-source metadata across its senses.",
    fields: {
      "Key": "トスアップ | 2861582:1",
      "Recognition target": "トスアップ",
      "Reading": "トスアップ",
      "Hint": "",
      "Full context": "審判がボールを<mark>トスアップ</mark>した。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1604990",
    optionLabel: "目にあう — many written forms",
    reason:
      "Many orthographic variants stress wrapping, separators, hidden forms, and a reading that mixes ruby with unannotated kana.",
    fields: {
      "Key": "目にあう | 1604990:1",
      "Recognition target": "目にあう",
      "Reading": "目[め]にあう",
      "Hint": "",
      "Full context": "ひどい<mark>目[め]にあった</mark>。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1000100",
    optionLabel: "ＡＢＣ順 — full-width Latin ruby",
    reason:
      "Full-width Latin characters each receive ruby before a kanji suffix, exercising non-kanji annotation and four adjacent groups.",
    fields: {
      "Key": "ＡＢＣ順 | 1000100:1",
      "Recognition target": "ＡＢＣ順",
      "Reading": "Ａ[エー] Ｂ[ビー] Ｃ[シー] 順[じゅん]",
      "Hint": "",
      "Full context": "名簿を<mark>Ａ[エー] Ｂ[ビー] Ｃ[シー] 順[じゅん]</mark>に並べた。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1855690",
    optionLabel: "～等々 — suffix marker and repetition",
    reason:
      "A generated full-width suffix marker precedes separately annotated repeated characters, a historically tricky card-reading shape.",
    fields: {
      "Key": "等々 | 1855690:1",
      "Recognition target": "～等々",
      "Reading": "～ 等[とう] 々[とう]",
      "Hint": "",
      "Full context": "必要なのは、紙、ペン、封筒<mark>～ 等[とう] 々[とう]</mark>だ。",
      "Minimized context": "",
      "Source": "",
    },
  },
  {
    id: "1574430",
    optionLabel: "餃子 — multi-component source ruby",
    reason:
      "The source reading splits across both kanji and differs in script and casing from the dictionary reading.",
    fields: {
      "Key": "餃子 | 1574430:1",
      "Recognition target": "餃子",
      "Reading": "餃[ギョー] 子[ザ]",
      "Hint": "",
      "Full context": "横で<mark>餃[ぎょー] 子[ざ]</mark>を食べている。",
      "Minimized context": "",
      "Source": "Source-ruby fixture",
    },
  },
];
