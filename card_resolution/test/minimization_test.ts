import { assertEquals, assertThrows } from "@std/assert";
import {
  markedContextTextTemplate,
  renderMarkedContextText,
  renderMinimizedContextText,
} from "../src/minimization.ts";

Deno.test("markedContextTextTemplate extracts visible text and opaque targets", () => {
  assertEquals(
    markedContextTextTemplate(
      "<p>前の文章。</p><p>頼っ<ruby>たり<rt>たり</rt></ruby><mark>頼られた</mark>りした。</p>",
    ),
    {
      text: "前の文章。\n\n頼ったり⟪target:0⟫頼られた⟪/target:0⟫りした。",
      targets: [{ id: 0, surface: "頼られた", html: "頼られた" }],
    },
  );
});

Deno.test("renderMarkedContextText omits ruby readings and preserves rendered block boundaries", () => {
  assertEquals(
    renderMarkedContextText(
      "<p><ruby>木<rt>き</rt></ruby>には<mark>年輪</mark>がある。</p><p>次の段落。</p>",
    ),
    "木には年輪がある。\n\n次の段落。",
  );
});

Deno.test("markedContextTextTemplate preserves textual Anki furigana for minimization", () => {
  const template = markedContextTextTemplate(
    "前の 文[ぶん]。<mark>餃[ぎょう] 子[ざ]</mark>を食べる。",
  );
  assertEquals(template, {
    text: "前の 文[ぶん]。⟪target:0⟫餃[ぎょう] 子[ざ]⟪/target:0⟫を食べる。",
    targets: [{ id: 0, surface: "餃[ぎょう] 子[ざ]", html: "餃[ぎょう] 子[ざ]" }],
  });
  assertEquals(
    renderMinimizedContextText(
      template,
      "⟪target:0⟫餃[ぎょう] 子[ざ]⟪/target:0⟫を食べる。",
    ),
    "<mark>餃[ぎょう] 子[ざ]</mark>を食べる。",
  );
});

Deno.test("markedContextTextTemplate rejects missing, nested, and empty marks", () => {
  assertThrows(
    () => markedContextTextTemplate("<p>対象がない。</p>"),
    Error,
    "at least one <mark>",
  );
  assertThrows(
    () => markedContextTextTemplate("<mark>外<mark>内</mark></mark>"),
    Error,
    "nested <mark>",
  );
  assertThrows(
    () => markedContextTextTemplate("<mark><rt>よみ</rt></mark>"),
    Error,
    "substantive visible text",
  );
});

Deno.test("renderMinimizedContextText escapes text and restores paragraph markup", () => {
  const template = markedContextTextTemplate(
    "<p>長い前置き。</p><p>&lt;危険&gt;&amp;<mark>対象</mark>の説明。</p><p>次の長い説明。</p>",
  );
  assertEquals(
    renderMinimizedContextText(
      template,
      "<危険>&⟪target:0⟫対象⟪/target:0⟫。\n\n次。",
    ),
    "<p>&lt;危険&gt;&amp;<mark>対象</mark>。</p>\n\n<p>次。</p>",
  );
});

Deno.test("renderMinimizedContextText restores source markup without exposing it to the model", () => {
  const template = markedContextTextTemplate(
    "長い前置きのあと、<mark><ruby>臨<rt>りん</rt></ruby>" +
      '<ruby class="reading">時<rt>じ</rt></ruby></mark>休業した。',
  );
  assertEquals(
    template,
    {
      text: "長い前置きのあと、⟪target:0⟫臨時⟪/target:0⟫休業した。",
      targets: [{
        id: 0,
        surface: "臨時",
        html: '<ruby>臨<rt>りん</rt></ruby><ruby class="reading">時<rt>じ</rt></ruby>',
      }],
    },
  );
  assertEquals(
    renderMinimizedContextText(template, "⟪target:0⟫臨時⟪/target:0⟫休業した。"),
    '<mark><ruby>臨<rt>りん</rt></ruby><ruby class="reading">時<rt>じ</rt></ruby></mark>休業した。',
  );
});

Deno.test("renderMinimizedContextText may omit a repeated target occurrence", () => {
  const template = markedContextTextTemplate(
    "<p><mark>頼る</mark>こともあれば、長い説明を挟んで、また<mark>頼る</mark>こともある。</p>",
  );
  assertEquals(
    renderMinimizedContextText(template, "また⟪target:1⟫頼る⟪/target:1⟫こともある。"),
    "また<mark>頼る</mark>こともある。",
  );
});

Deno.test("renderMinimizedContextText restores markup for the retained target occurrence", () => {
  const template = markedContextTextTemplate(
    "<mark><ruby>生<rt>せい</rt></ruby></mark>という読みの長い説明が続くが、" +
      "ここでは<mark><ruby>生<rt>なま</rt></ruby></mark>と読む。",
  );
  assertEquals(
    renderMinimizedContextText(
      template,
      "ここでは⟪target:1⟫生⟪/target:1⟫と読む。",
    ),
    "ここでは<mark><ruby>生<rt>なま</rt></ruby></mark>と読む。",
  );
});

Deno.test("renderMinimizedContextText rejects unknown and duplicated target occurrence IDs", () => {
  const template = markedContextTextTemplate(
    "長い前置きのあとで、<mark>対象</mark>について詳しく説明した。",
  );
  assertThrows(
    () => renderMinimizedContextText(template, "⟪target:9⟫対象⟪/target:9⟫だ。"),
    Error,
    "unknown target occurrence ID 9",
  );
  assertThrows(
    () =>
      renderMinimizedContextText(
        template,
        "⟪target:0⟫対象⟪/target:0⟫は⟪target:0⟫対象⟪/target:0⟫だ。",
      ),
    Error,
    "duplicates target occurrence ID 0",
  );
});

Deno.test("renderMinimizedContextText handles overlapping target spellings", () => {
  const template = markedContextTextTemplate(
    "<p>長い説明の後で、<mark>大小</mark>を比べ、<mark>大</mark>を選んだ。</p>",
  );
  assertEquals(
    renderMinimizedContextText(
      template,
      "⟪target:0⟫大小⟪/target:0⟫を比べ、⟪target:1⟫大⟪/target:1⟫を選んだ。",
    ),
    "<mark>大小</mark>を比べ、<mark>大</mark>を選んだ。",
  );
});

Deno.test("renderMinimizedContextText preserves unmarked lexical lookalikes", () => {
  const suffixTemplate = markedContextTextTemplate(
    "長い前置きがある。異なるものが、ここでは<mark>なる</mark>。",
  );
  assertEquals(
    renderMinimizedContextText(
      suffixTemplate,
      "異なるものが、ここでは⟪target:0⟫なる⟪/target:0⟫。",
    ),
    "異なるものが、ここでは<mark>なる</mark>。",
  );

  const compoundTemplate = markedContextTextTemplate(
    "長い前置きがある。大小を比べ、<mark>大</mark>を選ぶ。",
  );
  assertEquals(
    renderMinimizedContextText(
      compoundTemplate,
      "大小を比べ、⟪target:0⟫大⟪/target:0⟫を選ぶ。",
    ),
    "大小を比べ、<mark>大</mark>を選ぶ。",
  );
});

Deno.test("renderMinimizedContextText rejects a truly unmarked target occurrence", () => {
  const template = markedContextTextTemplate(
    "<mark>なる</mark>こともあれば、長い説明の後で、また<mark>なる</mark>。",
  );

  assertThrows(
    () =>
      renderMinimizedContextText(
        template,
        "⟪target:0⟫なる⟪/target:0⟫こともあれば、またなる。",
      ),
    Error,
    'retained target surface "なる" without its occurrence sentinel',
  );
});

Deno.test("renderMinimizedContextText rejects unsafe or unhelpful output", () => {
  const template = markedContextTextTemplate(
    "<p>長い前置きのあとで、<mark>対象</mark>について説明した。</p>",
  );

  assertThrows(
    () => renderMinimizedContextText(template, "対象について説明した。"),
    Error,
    "preserve at least one target-sentinel pair",
  );
  assertThrows(
    () => renderMinimizedContextText(template, "⟪target:0⟫別物⟪/target:0⟫だ。"),
    Error,
    "changed target surface for occurrence ID 0",
  );
  assertThrows(
    () => renderMinimizedContextText(template, template.text),
    Error,
    "substantively shorter",
  );
  assertThrows(
    () => renderMinimizedContextText(template, "「⟪target:0⟫対象⟪/target:0⟫だ。"),
    Error,
    "unbalanced 「」",
  );
  assertThrows(
    () => renderMinimizedContextText(template, "⟪target:0⟫対象⟪/target:0⟫の説明"),
    Error,
    "must end as a complete sentence",
  );
  assertThrows(
    () =>
      renderMinimizedContextText(
        markedContextTextTemplate(
          "彼女の心も引っ張られます。ロープで繫がった二<mark>艘</mark>のボートのように。",
        ),
        "ロープで繫がった二⟪target:0⟫艘⟪/target:0⟫のボートのように。",
      ),
    Error,
    "ends in a dependent fragment",
  );
  assertThrows(
    () =>
      renderMinimizedContextText(
        markedContextTextTemplate(
          "彼は危険な道を選んだ。それが<mark>失敗</mark>を招くとも知らずに。",
        ),
        "彼は⟪target:0⟫失敗⟪/target:0⟫を招くとも知らずに。",
      ),
    Error,
    "ends in a dependent fragment",
  );
  assertThrows(
    () => renderMinimizedContextText(template, "⟪target:0⟫対象⟪/target:0⟫を捏造した。"),
    Error,
    "source-unsupported lexical character",
  );
  assertThrows(
    () =>
      renderMinimizedContextText(
        markedContextTextTemplate(
          "本当のことを話し、長い説明のあとで、<mark>対象</mark>について説明した。",
        ),
        "うそだ。⟪target:0⟫対象⟪/target:0⟫だ。",
      ),
    Error,
    'source-unsupported hiragana word(s) "うそ"',
  );
  assertThrows(
    () =>
      renderMinimizedContextText(
        markedContextTextTemplate("<mark>対象</mark>について猫を一度だけ詳しく説明した。"),
        "猫猫と⟪target:0⟫対象⟪/target:0⟫。",
      ),
    Error,
    'source-unsupported adjacent lexical repetition(s) "猫猫"',
  );
  assertEquals(
    renderMinimizedContextText(
      markedContextTextTemplate(
        "前の質問を受けて、家福はそれについて考えた。答えと演技の<mark>境目</mark>を話した。",
      ),
      "家福はそれについて考えた。答えと演技の⟪target:0⟫境目⟪/target:0⟫を話した。",
    ),
    "家福はそれについて考えた。答えと演技の<mark>境目</mark>を話した。",
  );
  assertThrows(
    () =>
      renderMinimizedContextText(
        markedContextTextTemplate("長い、<mark>対象</mark>だ。"),
        "長い⟪target:0⟫対象⟪/target:0⟫だ。",
      ),
    Error,
    "substantively shorter",
  );
});
