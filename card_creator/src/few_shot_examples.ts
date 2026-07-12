/**
 * Few-shot examples for AI field generation.
 * These examples teach the model the expected patterns and conventions.
 */

import type { AIGeneratedFields } from "./types.ts";
import type { JMDictWord } from "data";
import { preextractedJMDictEntry } from "data";

export interface FewShotExample {
  input: {
    recognitionTarget: string;
    context: string;
    jmdictEntry: JMDictWord;
    source?: string;
    sourceURL?: string;
  };
  output: AIGeneratedFields;
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
];
