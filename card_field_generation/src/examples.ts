/**
 * Few-shot examples for AI field generation.
 * These examples teach the model the expected patterns and conventions.
 */

import { preextractedJMDictEntry } from "data";
import type { CardFieldGenerationInput, GeneratedCardFields } from "./generate.ts";

export interface FewShotExample {
  input: CardFieldGenerationInput;
  senseConstraints: {
    kanaReading: string;
    compatibleSenseNumbers: readonly number[];
  };
  output: GeneratedCardFields;
}

/**
 * Curated examples covering key patterns.
 *
 * 1. 父方: no hint, no minimizedContext (short context, all senses apply)
 * 2. 無垢: has hint, no minimizedContext (short context, specific sense)
 * 3. 返上: no hint, has minimizedContext (long context, single sense)
 * 4. 増幅: has hint, has minimizedContext (long context, specific sense)
 * 5. ハンダ付け: demonstrates preserving katakana in reading
 * 6. 後ろめたい: demonstrates targetInContext for conjugated/inflected forms
 * 7. 金子: none of the entry's senses describes the surname in context
 * 8. 女子大生: a specialized sense needs positive contextual evidence
 * 9. さかしま: the text mentions the spelling without using its meaning
 * 10. おませ: metalinguistic discussion supplies semantic evidence
 */
export const FEW_SHOT_EXAMPLES: FewShotExample[] = [
  // Example 1: 父方 - no hint, no minimizedContext
  // Demonstrates: all senses apply (grammatical variants), short context needs no minimization
  {
    input: {
      recognitionTarget: "父方",
      context:
        "父方の祖母ってことね。そのおばあちゃんがあんたのお世話をしてくれてたってところかな。",
      jmdictEntry: await preextractedJMDictEntry("1497700"),
    },
    senseConstraints: {
      kanaReading: "ちちかた",
      compatibleSenseNumbers: [1, 2],
    },
    output: {
      applicableSenses: [],
      reading: "ちちかた",
      targetInContext: "父方",
      hint: null,
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },

  // Example 2: 無垢 - has hint, no minimizedContext
  // Demonstrates: specific sense (innocence, not material purity or kimono), needs hint
  {
    input: {
      recognitionTarget: "無垢",
      context: "その無垢な顔に、「夜、眠れなかったの」と言う。",
      jmdictEntry: await preextractedJMDictEntry("1529950"),
    },
    senseConstraints: {
      kanaReading: "むく",
      compatibleSenseNumbers: [1, 2, 3],
    },
    output: {
      applicableSenses: [1],
      reading: "むく",
      targetInContext: "無垢",
      hint: "無垢な顔",
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },

  // Example 3: 返上 - no hint, has minimizedContext
  // Demonstrates: single sense (no disambiguation needed), long context needs minimization
  {
    input: {
      recognitionTarget: "返上",
      context: "ふたりはわたしの為に休日を返上して、方々を駆けまわって生活を整えてくれた。",
      jmdictEntry: await preextractedJMDictEntry("1512230"),
    },
    senseConstraints: {
      kanaReading: "へんじょう",
      compatibleSenseNumbers: [1],
    },
    output: {
      applicableSenses: [],
      reading: "へんじょう",
      targetInContext: "返上",
      hint: null,
      minimizedContext: "ふたりはわたしの為に休日を<mark>返上</mark>した。",
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },

  // Example 4: 増幅 - has hint, has minimizedContext
  // Demonstrates: specific sense (figurative, not electronics), long context needs minimization
  {
    input: {
      recognitionTarget: "増幅",
      context:
        "不採用の連絡を受けるたびに、やっぱりわたしなんかが社会に出て働くのは無理なんだと自分を見限る気持ちが膨れ、目減りしていく通帳の残額がそれを増幅させる。",
      jmdictEntry: await preextractedJMDictEntry("1403360"),
    },
    senseConstraints: {
      kanaReading: "ぞうふく",
      compatibleSenseNumbers: [1, 2],
    },
    output: {
      applicableSenses: [2],
      reading: "ぞうふく",
      targetInContext: "増幅",
      hint: "気持ちを増幅する",
      minimizedContext: "気持ちが膨れ、目減りしていく通帳の残額がそれを<mark>増幅</mark>させる。",
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },

  // Example 5: ハンダ付け - katakana preservation in reading
  // Demonstrates: when recognition target contains katakana, preserve it in the reading
  {
    input: {
      recognitionTarget: "ハンダ付け",
      context:
        "電子機器の部品をハンダ付けする工場の工員で、初出勤の日の夜は美晴とアンさんが焼肉をおごってくれた。",
      jmdictEntry: await preextractedJMDictEntry("2258260"),
    },
    senseConstraints: {
      kanaReading: "はんだづけ",
      compatibleSenseNumbers: [1],
    },
    output: {
      applicableSenses: [],
      reading: "ハンダづけ",
      targetInContext: "ハンダ付け",
      hint: null,
      minimizedContext: "電子機器の部品を<mark>ハンダ付け</mark>する。",
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },

  // Example 6: 後ろめたい - targetInContext differs from recognitionTarget
  // Demonstrates: when the word appears in a nominalized form (後ろめたさ), targetInContext captures that
  {
    input: {
      recognitionTarget: "後ろめたい",
      context: "父に対する多少の後ろめたさ以外には、なんの痛みも苦悩もない。",
      jmdictEntry: await preextractedJMDictEntry("2007360"),
      source: "世界から猫が消えたなら",
    },
    senseConstraints: {
      kanaReading: "うしろめたい",
      compatibleSenseNumbers: [1],
    },
    output: {
      applicableSenses: [],
      reading: "うしろめたい",
      targetInContext: "後ろめたさ",
      hint: null,
      minimizedContext: null,
      cleanedSource: "世界から猫が消えたなら",
      sourceURLIsPublic: false,
    },
  },

  // Example 7: 金子 - the spelling occurs, but none of this entry's senses applies
  // Demonstrates: a mismatched JMDict entry must be rejected instead of forcing a sense selection
  {
    input: {
      recognitionTarget: "金子",
      context:
        "朝のピーク時が過ぎると、いつものように奥で小代子たちと休憩を取ることにした。小代子は甘いものが好きだ。大福を彼女は出してくれた。辛党の米沢は関心がなさそうな顔をして茶を啜っている。バイトの金子は配達中だ。",
      jmdictEntry: await preextractedJMDictEntry("1630340"),
    },
    senseConstraints: {
      kanaReading: "きんす",
      compatibleSenseNumbers: [1, 2],
    },
    output: {
      applicableSenses: null,
      hint: null,
    },
  },

  // Example 8: 女子大生 - the context supports the ordinary broad sense, not the narrower one
  // Demonstrates: logical compatibility alone does not make "student of a women's college" apply
  {
    input: {
      recognitionTarget: "女子大生",
      context: "持っている鞄も女子大生が憧れるようなブランド物ばかりだ。",
      jmdictEntry: await preextractedJMDictEntry("1761890"),
    },
    senseConstraints: {
      kanaReading: "じょしだいせい",
      compatibleSenseNumbers: [1, 2],
    },
    output: {
      applicableSenses: [2],
      reading: "じょしだいせい",
      targetInContext: "女子大生",
      hint: "女子大生が憧れる",
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },

  // Example 9: さかしま - the spelling is listed only as an example of the sound "しま"
  // Demonstrates: mentioning a string is not a usage of any dictionary sense
  {
    input: {
      recognitionTarget: "さかしま",
      context:
        "「ストライプ、アイランド、地名の志摩、『よこしま』や『さかしま』のしま、揣摩憶測するの揣摩、仏教用語の四魔……」",
      jmdictEntry: await preextractedJMDictEntry("1445760"),
    },
    senseConstraints: {
      kanaReading: "さかしま",
      compatibleSenseNumbers: [1, 2],
    },
    output: {
      applicableSenses: null,
      hint: null,
    },
  },

  // Example 10: おませ - the characters explicitly discuss the word's usage
  // Demonstrates: metalinguistic explanation is meaningful context, not a bare string mention
  {
    input: {
      recognitionTarget: "おませ",
      context:
        "「『おませ』は子どもの性別を問わず使いますが、『おしゃま』は女の子に対してしか言いませんよね」",
      jmdictEntry: await preextractedJMDictEntry("2019710"),
    },
    senseConstraints: {
      kanaReading: "おませ",
      compatibleSenseNumbers: [1, 2],
    },
    output: {
      applicableSenses: [],
      reading: "おませ",
      targetInContext: "おませ",
      hint: null,
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  },
];
