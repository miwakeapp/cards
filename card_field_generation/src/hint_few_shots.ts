import { markedContextTextTemplate } from "card_resolution";
import type { PromptJMDictEntry } from "./jmdict_prompt.ts";
import {
  hintPromptFixtureSignature,
  hintPromptOutputSignature,
  type PromptFixtureLink,
  promptFixtureSurfaceText,
  promptJMDictProjectionSignature,
} from "./prompt_fixture_signature.ts";

interface HintFewShot {
  /** Eval fixture from which this prompt example was derived. */
  fixtureId: string;
  input: {
    recognitionTarget: string;
    context: string;
    selected: PromptJMDictEntry;
    contrasts: PromptJMDictEntry[];
  };
  output: {
    result: {
      semanticContrastExists: boolean;
      sourceEvidenceExists: boolean;
      semanticEvidenceTemplate: string;
      hintSourceTemplate: string;
      hintTemplate: string;
    };
  };
}

export const HINT_FEW_SHOTS: readonly HintFewShot[] = [
  {
    fixtureId: "animecards-1768115818658-沽券",
    input: {
      recognitionTarget: "沽券",
      context: "もちろん<mark>沽券</mark>をかけて父が弁償したが。",
      selected: {
        id: "1568610",
        senses: [{
          number: 1,
          glosses: ["dignity", "credit", "face", "honor", "reputation"],
        }],
      },
      contrasts: [{
        id: "1568610",
        senses: [
          {
            number: 2,
            glosses: ["deed of sale (for a land, forest or house)"],
            misc: ["archaic"],
          },
          { number: 3, glosses: ["sale value", "selling price"], misc: ["archaic"] },
        ],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "⟪target:0⟫沽券⟪/target:0⟫をかけて",
        hintSourceTemplate: "⟪target:0⟫沽券⟪/target:0⟫をかけて",
        hintTemplate: "⟪target⟫沽券⟪/target⟫をかける",
      },
    },
  },
  {
    fixtureId: "exposure-1702301776995-惚れる",
    input: {
      recognitionTarget: "惚れる",
      context: "<mark>惚れた</mark>欲目。",
      selected: {
        id: "1288500",
        senses: [{ number: 1, glosses: ["to fall in love (with)", "to fall for"] }],
      },
      contrasts: [{
        id: "1288500",
        senses: [
          { number: 2, glosses: ["to be attracted (by)", "to be impressed (by)"] },
          { number: 3, glosses: ["to forget oneself", "to be entranced (by)"] },
        ],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "⟪target:0⟫惚れた⟪/target:0⟫欲目",
        hintSourceTemplate: "⟪target:0⟫惚れた⟪/target:0⟫欲目",
        hintTemplate: "⟪target⟫惚れた⟪/target⟫欲目",
      },
    },
  },
  {
    fixtureId: "exposure-1679541681407-怒る",
    input: {
      recognitionTarget: "怒る",
      context: "彼はあれだけ<mark>怒られて</mark>悲しんでいるかと思ったら、すぐに笑いだした。",
      selected: {
        id: "1445690",
        senses: [{ number: 2, glosses: ["to scold", "to tell (someone) off"] }],
      },
      contrasts: [{
        id: "1445690",
        senses: [{ number: 1, glosses: ["to get angry", "to lose one's temper"] }],
      }, {
        id: "2859682",
        senses: [{ number: 1, glosses: ["to get angry"] }],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "⟪target:0⟫怒られて⟪/target:0⟫",
        hintSourceTemplate: "⟪target:0⟫怒られて⟪/target:0⟫",
        hintTemplate: "⟪target⟫怒られる⟪/target⟫",
      },
    },
  },
  {
    fixtureId: "exposure-1673449877905-可愛がる",
    input: {
      recognitionTarget: "可愛がる",
      context: "彼には愛嬌があって、確かに<mark>可愛がられて</mark>いる。",
      selected: {
        id: "1190730",
        senses: [{
          number: 1,
          glosses: [
            "to be affectionate to",
            "to treat tenderly",
            "to dote on",
            "to show one's love (for)",
            "to cherish",
          ],
        }],
      },
      contrasts: [{
        id: "1190730",
        senses: [
          { number: 2, glosses: ["to show favouritism to", "to be partial to"] },
          { number: 3, glosses: ["to fondle", "to caress", "to pet"] },
          {
            number: 4,
            glosses: ["to be tough on", "to be rough with", "to torment", "to train harshly"],
            misc: ["colloquial"],
            info: ["used ironically; often as 可愛がってやる"],
          },
        ],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "愛嬌があって、確かに⟪target:0⟫可愛がられて⟪/target:0⟫いる",
        hintSourceTemplate: "愛嬌があって、確かに⟪target:0⟫可愛がられて⟪/target:0⟫いる",
        hintTemplate: "愛嬌があって⟪target⟫可愛がられる⟪/target⟫",
      },
    },
  },
  {
    fixtureId: "animecards-1762485931491-つきもの",
    input: {
      recognitionTarget: "つきもの",
      context: "スタンドアロンRPGには<mark>つきもの</mark>の勝利ファンファーレが聞こえてきそうだ。",
      selected: {
        id: "1495730",
        senses: [{
          number: 1,
          glosses: ["natural accompaniment", "something that naturally goes with (another thing)"],
        }],
      },
      contrasts: [{
        id: "1495730",
        senses: [
          { number: 2, glosses: ["inevitable aspect (of something)", "part and parcel"] },
          {
            number: 3,
            glosses: ["supplementary printed insert (in a book or magazine)", "appendix"],
          },
        ],
      }, {
        id: "1495650",
        senses: [{ number: 1, glosses: ["attendant"] }],
      }, {
        id: "1566970",
        senses: [{ number: 1, glosses: ["evil spirit (that possesses someone)", "demon"] }],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "スタンドアロンRPGには⟪target:0⟫つきもの⟪/target:0⟫",
        hintSourceTemplate: "スタンドアロンRPGには⟪target:0⟫つきもの⟪/target:0⟫",
        hintTemplate: "RPGには⟪target⟫つきもの⟪/target⟫",
      },
    },
  },
  {
    fixtureId: "exposure-1688300171859-見学",
    input: {
      recognitionTarget: "見学",
      context: "明日の<mark>見学</mark>の際には、身分証明書を持ってきてください。",
      selected: {
        id: "1259440",
        senses: [{
          number: 1,
          glosses: ["inspection", "study by observation", "field trip", "tour", "review"],
        }],
      },
      contrasts: [{
        id: "1259440",
        senses: [{ number: 2, glosses: ["sitting out (e.g. PE class)"] }],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate:
          "⟪target:0⟫見学⟪/target:0⟫の際には、身分証明書を持ってきてください",
        hintSourceTemplate: "⟪target:0⟫見学⟪/target:0⟫の際には、身分証明書を持ってきてください",
        hintTemplate: "⟪target⟫見学⟪/target⟫の際には身分証明書を持ってくる",
      },
    },
  },
  {
    fixtureId: "exposure-1678246299999-すれ違う",
    input: {
      recognitionTarget: "すれ違う",
      context: "昨日<mark>すれ違った</mark>の、まさか君じゃないよね？",
      selected: {
        id: "1595920",
        senses: [{
          number: 1,
          glosses: ["to pass (by) each other", "to brush past"],
        }],
      },
      contrasts: [{
        id: "1595920",
        senses: [
          { number: 2, glosses: ["to miss (meeting) each other", "to fail to meet"] },
          { number: 3, glosses: ["to be at odds", "to clash", "to be in conflict"] },
        ],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "昨日⟪target:0⟫すれ違った⟪/target:0⟫の、まさか君じゃないよね？",
        hintSourceTemplate: "昨日⟪target:0⟫すれ違った⟪/target:0⟫の、まさか君じゃないよね？",
        hintTemplate: "昨日⟪target⟫すれ違った⟪/target⟫の、まさか君じゃないよね？",
      },
    },
  },
  {
    fixtureId: "surfacepro11-live-1725606228180-いける",
    input: {
      recognitionTarget: "いける",
      context:
        "<p>「これ、おいしいんですかねえ？」</p>\n\n<p>アロハは、きのこの山とたけのこの里を交互に眺めながら尋ねる。</p>\n\n<p>「結構<mark>いけ</mark>ますよ」</p>",
      selected: {
        id: "1631370",
        senses: [{ number: 2, glosses: ["to look (taste, etc.) good"] }],
      },
      contrasts: [{
        id: "1631370",
        senses: [
          { number: 1, glosses: ["to be good (at)", "to go well"] },
          { number: 3, glosses: ["to hold one's liquor"] },
        ],
      }, {
        id: "1587190",
        senses: [{ number: 1, glosses: ["to arrange (flowers)", "to plant"] }],
      }, {
        id: "2035430",
        senses: [{ number: 1, glosses: ["to bury (in the ground)"] }],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate:
          "「これ、おいしいんですかねえ？」「結構⟪target:0⟫いけ⟪/target:0⟫ますよ」",
        hintSourceTemplate: "結構⟪target:0⟫いけ⟪/target:0⟫ますよ",
        hintTemplate: "結構⟪target⟫いける⟪/target⟫",
      },
    },
  },
  {
    fixtureId: "prompt-control-null-包む",
    input: {
      recognitionTarget: "包む",
      context: "布で荷物を<mark>包んだ</mark>。",
      selected: {
        id: "1584060",
        senses: [{ number: 1, glosses: ["to wrap up", "to pack"] }],
      },
      contrasts: [{
        id: "2831360",
        senses: [{ number: 1, glosses: ["to wrap up (in)", "to tuck (up)"] }],
      }],
    },
    output: {
      result: {
        semanticContrastExists: false,
        sourceEvidenceExists: false,
        semanticEvidenceTemplate: "",
        hintSourceTemplate: "",
        hintTemplate: "",
      },
    },
  },
  {
    fixtureId: "surfacepro11-live-1735804694459-自重",
    input: {
      recognitionTarget: "自重",
      context: "面倒だと思い、<mark>自重</mark>しておいたのだ。",
      selected: {
        id: "1317910",
        senses: [{
          number: 2,
          glosses: ["prudence", "not acting rashly", "restraining oneself"],
        }],
      },
      contrasts: [{
        id: "1317910",
        senses: [
          { number: 1, glosses: ["self-respect"] },
          {
            number: 3,
            glosses: ["taking care of oneself", "being careful with one's health"],
          },
        ],
      }, {
        id: "1726230",
        senses: [
          { number: 1, glosses: ["weight of an (unloaded) vehicle", "dead load", "tare"] },
          { number: 2, glosses: ["one's own weight"] },
        ],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: true,
        semanticEvidenceTemplate: "面倒だと思い、⟪target:0⟫自重⟪/target:0⟫しておいた",
        hintSourceTemplate: "⟪target:0⟫自重⟪/target:0⟫しておいた",
        hintTemplate: "⟪target⟫自重⟪/target⟫しておく",
      },
    },
  },
  {
    fixtureId: "exposure-1676005658876-移転",
    input: {
      recognitionTarget: "移転",
      context: "万が一<mark>移転</mark>することになったら、僕の仕事は君にお願いしたい。",
      selected: {
        id: "1158390",
        senses: [{ number: 1, glosses: ["moving", "relocation", "change of address"] }],
      },
      contrasts: [{
        id: "1158390",
        senses: [{
          number: 2,
          glosses: ["transfer (of deeds, property, etc.)", "demise"],
        }],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: false,
        semanticEvidenceTemplate: "",
        hintSourceTemplate: "",
        hintTemplate: "",
      },
    },
  },
  {
    fixtureId: "exposure-1681362708348-素直",
    input: {
      recognitionTarget: "素直",
      context: "<mark>素直</mark>であるということは、君の表情からも分かります。",
      selected: {
        id: "1397340",
        senses: [{ number: 2, glosses: ["honest", "frank", "upfront (about one's feelings)"] }],
      },
      contrasts: [{
        id: "1397340",
        senses: [
          { number: 1, glosses: ["obedient", "meek", "docile", "unaffected"] },
          { number: 3, glosses: ["straight (e.g. hair)"] },
          {
            number: 4,
            glosses: [
              "without peculiarity",
              "without mannerisms",
              "standard",
              "neat (e.g. handwriting)",
            ],
          },
        ],
      }],
    },
    output: {
      result: {
        semanticContrastExists: true,
        sourceEvidenceExists: false,
        semanticEvidenceTemplate: "",
        hintSourceTemplate: "",
        hintTemplate: "",
      },
    },
  },
];

/** Eval fixture IDs from which hint prompt few-shots were derived. */
export const HINT_PROMPT_FIXTURE_IDS: readonly string[] = Object.freeze(
  HINT_FEW_SHOTS.map(({ fixtureId }) => fixtureId),
);

/** Semantic links from hint prompt few-shots to their source eval fixtures. */
export const HINT_PROMPT_FIXTURE_LINKS: readonly PromptFixtureLink[] = Object.freeze(
  HINT_FEW_SHOTS.map(({ fixtureId, input, output }) => {
    const disposition = !output.result.semanticContrastExists
      ? "not-needed"
      : !output.result.sourceEvidenceExists
      ? "source-insufficient"
      : "generated";
    const hint = disposition === "generated"
      ? output.result.hintTemplate.replace("⟪target⟫", "").replace("⟪/target⟫", "")
      : undefined;
    return {
      fixtureId,
      inputSignature: hintPromptFixtureSignature({
        recognitionTarget: input.recognitionTarget,
        context: markedContextTextTemplate(input.context).text,
        selectedUsage: {
          jmdictId: input.selected.id,
          senseNumbers: input.selected.senses.map(({ number }) => number),
        },
      }),
      contextLength: promptFixtureSurfaceText(markedContextTextTemplate(input.context).text).length,
      outputSignature: hintPromptOutputSignature({
        disposition,
        ...(hint === undefined ? {} : { hint }),
      }),
      selectedJMDictProjection: input.selected,
      selectedJMDictProjectionSignature: promptJMDictProjectionSignature(input.selected),
      contrastingJMDictProjections: input.contrasts,
      contrastingJMDictProjectionSignatures: input.contrasts.map(
        promptJMDictProjectionSignature,
      ),
    };
  }),
);
