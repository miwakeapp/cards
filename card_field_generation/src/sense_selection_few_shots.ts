import type { PromptJMDictEntry } from "./jmdict_prompt.ts";
import {
  type PromptFixtureLink,
  promptFixtureSurfaceText,
  promptJMDictProjectionSignature,
  senseSelectionPromptFixtureSignature,
  senseSelectionPromptOutputSignature,
} from "./prompt_fixture_signature.ts";

type SenseSelectionFewShotOutcome =
  | { outcome: "selected"; senseNumbers: readonly number[] }
  | { outcome: "no-match" }
  | { outcome: "ambiguous"; possibleSenseNumbers: readonly number[] };

interface SenseSelectionFewShot {
  /** Eval fixture from which this prompt example was derived. */
  fixtureId: string;
  recognitionTarget: string;
  context: string;
  entry: PromptJMDictEntry;
  outcome: SenseSelectionFewShotOutcome;
  /** Context-only classifications when pedagogical grouping resolves otherwise-unclear senses. */
  contextClassifications?: readonly ("yes" | "no" | "unclear")[];
}

export const SENSE_SELECTION_FEW_SHOTS: readonly SenseSelectionFewShot[] = [
  {
    fixtureId: "animecards-null-1734329958347-金子",
    recognitionTarget: "金子",
    context: "バイトの⟪target:0⟫金子⟪/target:0⟫は配達中だ。",
    entry: {
      id: "1630340",
      senses: [
        {
          number: 1,
          glosses: ["money", "funds"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
          misc: ["dated term"],
        },
        {
          number: 2,
          glosses: ["gold coin"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
          misc: ["dated term"],
        },
      ],
    },
    outcome: { outcome: "no-match" },
  },
  {
    fixtureId: "prompt-control-くよくよ-grammatical-overlap",
    recognitionTarget: "くよくよ",
    context: "失敗は誰にでもあるのだから、いつまでも⟪target:0⟫くよくよ⟪/target:0⟫していないで。",
    entry: {
      id: "1003930",
      senses: [
        {
          number: 1,
          glosses: ["to fret (over)", "to brood (about)", "to mope", "to worry"],
          partOfSpeech: ["noun or participle which takes the aux. verb suru"],
          misc: ["onomatopoeic or mimetic word"],
        },
        {
          number: 2,
          glosses: ["worriedly", "(fretting) constantly", "(worrying) over this and that"],
          partOfSpeech: ["adverb (fukushi)", "adverb taking the 'to' particle"],
          misc: ["onomatopoeic or mimetic word"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "prompt-control-木綿-song-title",
    recognitionTarget: "木綿",
    context: "箸をマイクにして『⟪target:0⟫木綿⟪/target:0⟫のハンカチーフ』を熱唱している。",
    entry: {
      id: "1534870",
      senses: [
        {
          number: 1,
          glosses: ["cotton (material)"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1] },
  },
  {
    fixtureId: "animecards-focused-1780889469082",
    recognitionTarget: "おませ",
    context:
      "『⟪target:0⟫おませ⟪/target:0⟫』は子どもの性別を問わず使いますが、『おしゃま』は女の子に対してしか言いませんよね。",
    entry: {
      id: "2019710",
      senses: [
        {
          number: 1,
          glosses: ["precocious"],
          partOfSpeech: ["adjectival nouns or quasi-adjectives (keiyodoshi)"],
          misc: ["word usually written using kana alone"],
        },
        {
          number: 2,
          glosses: ["precocious child"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
          misc: ["word usually written using kana alone"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "design-見込み-multiple-sense-subset",
    recognitionTarget: "見込み",
    context: "来年3月に学校を卒業する⟪target:0⟫見込み⟪/target:0⟫だ。",
    entry: {
      id: "1604480",
      senses: [
        {
          number: 1,
          glosses: ["possibility", "probability", "likelihood"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
        },
        {
          number: 2,
          glosses: ["expectation", "forecast", "estimate"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
        },
        {
          number: 3,
          glosses: ["side of a structural member"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "animecards-focused-1734502442358",
    recognitionTarget: "鉄壁",
    context: "⟪target:0⟫鉄壁⟪/target:0⟫のアリバイとかっていう話は嫌いじゃない",
    entry: {
      id: "1779800",
      senses: [
        { number: 1, glosses: ["iron wall", "impregnable fortress"] },
        {
          number: 2,
          glosses: ["impregnable", "invulnerable", "unassailable", "cast-iron"],
          partOfSpeech: ["nouns which may take the genitive case particle 'no'"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [2] },
  },
  {
    fixtureId: "animecards-focused-1770034270203",
    recognitionTarget: "女子大生",
    context: "持っている鞄も⟪target:0⟫女子大生⟪/target:0⟫が憧れるようなブランド物ばかりだ。",
    entry: {
      id: "1761890",
      senses: [
        { number: 1, glosses: ["student of a women's college"] },
        { number: 2, glosses: ["female university student"] },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
    contextClassifications: ["no", "yes"],
  },
  {
    fixtureId: "animecards-focused-1776059447108",
    recognitionTarget: "使いみち",
    context:
      "庭の隅には⟪target:0⟫使いみち⟪/target:0⟫のなくなった古い陶製の火鉢が放り出され、火鉢の中には十五センチも雨水がたまっていた。",
    entry: {
      id: "1305900",
      senses: [
        { number: 1, glosses: ["purpose", "utility", "objective"] },
        { number: 2, glosses: ["way to use something"] },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "animecards-focused-1781153489336",
    recognitionTarget: "文体",
    context: "辞書は⟪target:0⟫文体⟪/target:0⟫を統一しなければならないので……。",
    entry: {
      id: "1505510",
      senses: [
        { number: 1, glosses: ["literary style"] },
        {
          number: 2,
          glosses: ["form of (written) language (e.g. classical, modern)"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "animecards-focused-1726739466292",
    recognitionTarget: "数値",
    context: "何か⟪target:0⟫数値⟪/target:0⟫では測れない大きな欠落がそこに起きている。",
    entry: {
      id: "1373160",
      senses: [
        { number: 1, glosses: ["numerical value"] },
        { number: 2, glosses: ["figure", "result", "reading (on a meter, etc.)"] },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "animecards-focused-1781933019442",
    recognitionTarget: "イナゴ",
    context:
      "総勢五十名を超える学生がパーティーに来たら、⟪target:0⟫イナゴ⟪/target:0⟫の群れに襲われた田んぼのように料理が跡形もなくなってしまう。",
    entry: {
      id: "1167880",
      senses: [
        {
          number: 1,
          glosses: ["rice grasshopper (of genus Oxya)"],
          misc: ["word usually written using kana alone"],
        },
        {
          number: 2,
          glosses: ["grasshopper", "locust (of family Catantopidae)"],
          misc: ["word usually written using kana alone"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
    contextClassifications: ["no", "yes"],
  },
  {
    fixtureId: "animecards-focused-1782530981329",
    recognitionTarget: "市販",
    context: "⟪target:0⟫市販⟪/target:0⟫されている銃器はタグ付けされていなかった。",
    entry: {
      id: "1308660",
      senses: [
        {
          number: 1,
          glosses: ["putting on the market", "putting on sale", "making commercially available"],
          partOfSpeech: [
            "noun (common) (futsuumeishi)",
            "noun or participle which takes the aux. verb suru",
            "transitive verb",
          ],
        },
        {
          number: 2,
          glosses: ["commercial", "off-the-shelf", "store-bought", "over-the-counter"],
          partOfSpeech: ["nouns which may take the genitive case particle 'no'"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
  },
  {
    fixtureId: "known-failure-キャッチ-physical-ball",
    recognitionTarget: "キャッチ",
    context: "高く上がったボールを見事に⟪target:0⟫キャッチ⟪/target:0⟫した。",
    entry: {
      id: "1041530",
      senses: [
        {
          number: 1,
          glosses: ["catch", "catching"],
        },
        {
          number: 2,
          glosses: ["catch"],
          field: ["baseball"],
        },
        { number: 3, glosses: ["shop tout", "puller-in"] },
        { number: 4, glosses: ["catching the water"] },
        { number: 5, glosses: ["catcher"], field: ["baseball"] },
        { number: 6, glosses: ["call waiting"] },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [2] },
  },
  {
    fixtureId: "animecards-null-1780037843564-さかしま",
    recognitionTarget: "さかしま",
    context:
      "地名の志摩、『よこしま』や『⟪target:0⟫さかしま⟪/target:0⟫』のしま、揣摩憶測するの揣摩",
    entry: {
      id: "1445760",
      senses: [
        { number: 1, glosses: ["reverse", "inversion", "upside down"] },
        { number: 2, glosses: ["unreasonable", "absurd", "wrong"] },
      ],
    },
    outcome: { outcome: "no-match" },
  },
  {
    fixtureId: "animecards-focused-1771918028811",
    recognitionTarget: "義姉",
    context:
      "「遺影？まだお元気なのに？しかもこんな若い頃の写真」⟪target:0⟫義姉⟪/target:0⟫が首をかしげる。",
    entry: {
      id: "1225800",
      senses: [
        {
          number: 1,
          glosses: ["sister-in-law (spouse's older sister or older brother's wife)"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
        },
        {
          number: 2,
          glosses: ["older stepsister", "older adopted sister", "non-blood-related older sister"],
          partOfSpeech: ["noun (common) (futsuumeishi)"],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2] },
    contextClassifications: ["unclear", "unclear"],
  },
  {
    fixtureId: "exposure-sense-1685762713860-勢い",
    recognitionTarget: "勢い",
    context: "あの⟪target:0⟫勢い⟪/target:0⟫でお代わりされると、ご飯が足りなくなる恐れがある。",
    entry: {
      id: "1375040",
      senses: [
        { number: 1, glosses: ["force", "vigor", "vigour", "energy", "spirit", "life"] },
        { number: 2, glosses: ["influence", "authority", "power", "might"] },
        { number: 3, glosses: ["impetus", "impulse", "momentum", "course (of events)"] },
        { number: 4, glosses: ["naturally", "necessarily", "inevitably"] },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 3] },
  },
  {
    fixtureId: "known-failure-甲子園-qualification",
    recognitionTarget: "甲子園",
    context: "⟪target:0⟫甲子園⟪/target:0⟫出場を賭けた地区大会で優勝した時の写真もある。",
    entry: {
      id: "2092720",
      senses: [
        {
          number: 1,
          glosses: ["Koshien Stadium (baseball park in Nishinomiya, Hyōgo Prefecture)"],
        },
        {
          number: 2,
          glosses: [
            "National High School Baseball Tournament (held annually in August at Koshien Stadium)",
            "Summer Koshien",
          ],
        },
        {
          number: 3,
          glosses: [
            "National High School Baseball Invitational Tournament (held annually in March at Koshien Stadium)",
            "Spring Koshien",
          ],
        },
      ],
    },
    outcome: { outcome: "selected", senseNumbers: [1, 2, 3] },
  },
];

/** Eval fixture IDs from which sense-selection prompt few-shots were derived. */
export const SENSE_SELECTION_PROMPT_FIXTURE_IDS: readonly string[] = Object.freeze(
  SENSE_SELECTION_FEW_SHOTS.map(({ fixtureId }) => fixtureId),
);

/** Semantic links from tracked sense-selection prompt few-shots to their source eval fixtures. */
export const SENSE_SELECTION_PROMPT_FIXTURE_LINKS: readonly PromptFixtureLink[] = Object.freeze(
  SENSE_SELECTION_FEW_SHOTS.map((example) => ({
    fixtureId: example.fixtureId,
    inputSignature: senseSelectionPromptFixtureSignature({
      recognitionTarget: example.recognitionTarget,
      context: example.context,
      jmdictId: example.entry.id,
      compatibleSenseNumbers: example.entry.senses.map(({ number }) => number),
    }),
    contextLength: promptFixtureSurfaceText(example.context).length,
    outputSignature: senseSelectionPromptOutputSignature(example.outcome),
    selectedJMDictProjection: example.entry,
    selectedJMDictProjectionSignature: promptJMDictProjectionSignature(example.entry),
  })),
);
