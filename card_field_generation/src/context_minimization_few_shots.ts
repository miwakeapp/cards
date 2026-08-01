import {
  contextMinimizationPromptFixtureSignature,
  contextMinimizationPromptOutputSignature,
  type PromptFixtureLink,
  promptFixtureSurfaceText,
} from "./prompt_fixture_signature.ts";

interface ContextMinimizationFewShot {
  /** Eval fixture from which this prompt example was derived. */
  fixtureId: string;
  fullText: string;
  output: { minimizedText: string | null };
}

export const CONTEXT_MINIMIZATION_FEW_SHOTS: readonly ContextMinimizationFewShot[] = [
  {
    fixtureId: "preference-worksheet-なめらか",
    fullText:
      "トラさん。馬締は顔に載せたままだった腕をのばし、⟪target:0⟫なめらか⟪/target:0⟫な毛並みを撫でてやろうと、腹のあたりを探った。",
    output: {
      minimizedText: "馬締は、⟪target:0⟫なめらか⟪/target:0⟫な毛並みを撫でる。",
    },
  },
  {
    fixtureId: "live-context-1782887106791-神秘-repeated",
    fullText:
      "内臓がまだまだ⟪target:0⟫神秘⟪/target:0⟫を秘めているというのに、ことばだけがどうして神から与えられた人間唯一の⟪target:1⟫神秘⟪/target:1⟫だといえるだろう。",
    output: {
      minimizedText: "内臓がまだまだ⟪target:0⟫神秘⟪/target:0⟫を秘めている。",
    },
  },
  {
    fixtureId: "preference-worksheet-たしなみ",
    fullText:
      "キャベツは公園をぐるっと一周して、子どもたちと⟪target:0⟫たしなみ⟪/target:0⟫程度に戯れ、ベンチに座って将棋を指していた老人たちに向かって「どいて欲しいでござる」と言う。",
    output: {
      minimizedText: "子どもたちと⟪target:0⟫たしなみ⟪/target:0⟫程度に戯れた。",
    },
  },
  {
    fixtureId: "historical-context-願わくば",
    fullText: "⟪target:0⟫願わくば⟪/target:0⟫、彼女がいましあわせでありますように。",
    output: { minimizedText: null },
  },
  {
    fixtureId: "preference-worksheet-先刻",
    fullText:
      "⟪target:0⟫先刻⟪/target:0⟫は、もしかしたら草薙に頼まれて何かを探りにきたのかと疑ったのだが、どうやら考えすぎらしいと石神は思った。",
    output: {
      minimizedText: "⟪target:0⟫先刻⟪/target:0⟫は、草薙に頼まれて何かを探りにきたのかと疑った。",
    },
  },
  {
    fixtureId: "live-context-1740391568555-艘",
    fullText:
      "彼女の心が動けば、私の心もそれにつれて引っ張られます。ロープで繫がった二⟪target:0⟫艘⟪/target:0⟫のボートのように。",
    output: { minimizedText: null },
  },
  {
    fixtureId: "preference-worksheet-芽生える",
    fullText:
      "「まず一日目。世界は暗闇だったんですね。そこに神様が光をつくって、昼と夜ができたわけ。で、二日目。神様は天をつくり、三日目に地をつくった。天地創造です！　それで海が生まれて、植物が⟪target:0⟫芽生えた⟪/target:0⟫と」",
    output: { minimizedText: "海が生まれて、植物が⟪target:0⟫芽生えた⟪/target:0⟫。" },
  },
  {
    fixtureId: "live-context-1740803371826-何かの拍子",
    fullText:
      "「うまくいけば、⟪target:0⟫何かの拍子⟪/target:0⟫にそのほんの一部だけが思い出せる。あくまで突発的に、小さな覗き穴から壁の向こうを覗くみたいにね。そこにある光景のほんの一画しか見ることはできない。あなたは自分の前世のことが何か思い出せる？」",
    output: {
      minimizedText:
        "うまくいけば、⟪target:0⟫何かの拍子⟪/target:0⟫に前世のほんの一部だけが思い出せる。",
    },
  },
  {
    fixtureId: "live-context-1762485237716-取り返しのつかない",
    fullText:
      "俺は、使用するソードスキルをごく初歩的なものに限定し、わざと時間をかけてゴブリンたちと戦った。それが、最終的に⟪target:0⟫取り返しのつかない⟪/target:0⟫過ちへと繫がることになるとも知らずに。",
    output: {
      minimizedText:
        "⟪target:0⟫取り返しのつかない⟪/target:0⟫過ちへと繫がることになるとも知らず、俺はゴブリンたちと戦った。",
    },
  },
];

/** Eval fixture IDs from which context-minimization prompt few-shots were derived. */
export const CONTEXT_MINIMIZATION_PROMPT_FIXTURE_IDS: readonly string[] = Object.freeze(
  CONTEXT_MINIMIZATION_FEW_SHOTS.map(({ fixtureId }) => fixtureId),
);

/** Semantic links from context-minimization prompt few-shots to their source eval fixtures. */
export const CONTEXT_MINIMIZATION_PROMPT_FIXTURE_LINKS: readonly PromptFixtureLink[] = Object
  .freeze(
    CONTEXT_MINIMIZATION_FEW_SHOTS.map(({ fixtureId, fullText, output }) => ({
      fixtureId,
      inputSignature: contextMinimizationPromptFixtureSignature(fullText),
      contextLength: promptFixtureSurfaceText(fullText).length,
      outputSignature: contextMinimizationPromptOutputSignature(output.minimizedText),
    })),
  );
