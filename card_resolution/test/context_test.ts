import { assertEquals, assertThrows } from "@std/assert";
import {
  markContextTargetOccurrences,
  markContextTargets,
  markedContextHasRuby,
} from "../src/context.ts";

Deno.test("markContextTargetOccurrences marks only the selected identical surface", () => {
  assertEquals(
    markContextTargetOccurrences("彼の考えとは異なるが、結果はこうなる。", [
      { start: 16, end: 18, surface: "なる" },
    ]),
    "彼の考えとは異なるが、結果はこう<mark>なる</mark>。",
  );
});

Deno.test("markContextTargetOccurrences marks genuine repeated occurrences", () => {
  assertEquals(
    markContextTargetOccurrences("こうなる、そうなる。", [
      { start: 2, end: 4, surface: "なる" },
      { start: 7, end: 9, surface: "なる" },
    ]),
    "こう<mark>なる</mark>、そう<mark>なる</mark>。",
  );
});

Deno.test("markContextTargetOccurrences uses rendered-text UTF-16 offsets", () => {
  assertEquals(
    markContextTargetOccurrences("😀<span>こう</span>なる。", [
      { start: 4, end: 6, surface: "なる" },
    ]),
    "😀<span>こう</span><mark>なる</mark>。",
  );
  assertThrows(
    () =>
      markContextTargetOccurrences("😀猫", [
        { start: 1, end: 2, surface: "\uDE00" },
      ]),
    Error,
    "splits a UTF-16 surrogate pair",
  );
});

Deno.test("markContextTargets marks ordinary repeated and distinct surfaces", () => {
  assertEquals(
    markContextTargets("猫と犬と猫", ["猫", "犬"]),
    "<mark>猫</mark>と<mark>犬</mark>と<mark>猫</mark>",
  );
});

Deno.test("markContextTargets gives longer overlapping alternatives priority", () => {
  assertEquals(
    markContextTargets("大小と大", ["大", "大小"]),
    "<mark>大小</mark>と<mark>大</mark>",
  );
  assertEquals(markContextTargets("aaaa", ["aa", "aaa"]), "<mark>aaa</mark>a");
});

Deno.test("markContextTargets includes embedded horizontal source whitespace", () => {
  assertEquals(
    markContextTargets("ここは居心地の 良い場所だ。", ["居心地の良い"]),
    "ここは<mark>居心地の 良い</mark>場所だ。",
  );
  assertEquals(
    markContextTargets("頼っ　たり頼られたりした。", ["頼った", "頼られた"]),
    "<mark>頼っ　た</mark>り<mark>頼られた</mark>りした。",
  );
  assertThrows(
    () => markContextTargets("<p>居心地の</p><p>良い場所だ。</p>", ["居心地の良い"]),
    Error,
    "which is absent",
  );
});

Deno.test("markContextTargets ignores attributes and ruby readings", () => {
  assertThrows(
    () => markContextTargets('<span title="猫">犬</span>', ["猫"]),
    Error,
    '"猫", which is absent',
  );
  assertThrows(
    () => markContextTargets("<ruby>猫<rt>ねこ</rt></ruby>", ["ねこ"]),
    Error,
    '"ねこ", which is absent',
  );
});

Deno.test("markContextTargets wraps a whole ruby without changing its contents", () => {
  const ruby =
    "<ruby><rb><span>言</span>葉</rb><rp>（</rp><rt><span>こと</span>ば</rt><rp>）</rp></ruby>";
  assertEquals(
    markContextTargets(`この${ruby}だ`, ["言葉"]),
    `この<mark>${ruby}</mark>だ`,
  );
});

Deno.test("markContextTargets wraps ruby together with following inflection text", () => {
  const ruby = "<ruby><rb>叩</rb><rt>たた</rt></ruby>";
  assertEquals(
    markContextTargets(`${ruby}きつけられた。`, ["叩きつけられた"]),
    `<mark>${ruby}きつけられた</mark>。`,
  );
});

Deno.test("markContextTargets wraps adjacent ruby elements as one target", () => {
  const first = "<ruby><rb>瞳</rb><rt>どう</rt></ruby>";
  const second = "<ruby><rb>孔</rb><rt>こう</rt></ruby>";
  assertEquals(
    markContextTargets(`${first}${second}が開く。`, ["瞳孔"]),
    `<mark>${first}${second}</mark>が開く。`,
  );
});

Deno.test("markContextTargets preserves inline structure and paragraph boundaries", () => {
  assertEquals(
    markContextTargets("<p><span>青</span>い空。</p><p>青い海。</p>", ["青い"]),
    "<p><mark><span>青</span>い</mark>空。</p><p><mark>青い</mark>海。</p>",
  );
});

Deno.test("markContextTargets splits ruby at complete annotation-component boundaries", () => {
  assertEquals(
    markContextTargets(
      "<ruby><rb>鉄</rb><rt>てつ</rt><rb>釘</rb><rt>くぎ</rt></ruby>",
      ["釘"],
    ),
    "<ruby><rb>鉄</rb><rt>てつ</rt></ruby>" +
      "<mark><ruby><rb>釘</rb><rt>くぎ</rt></ruby></mark>",
  );
});

Deno.test("markContextTargets preserves ruby attributes, rp, and nested component markup", () => {
  assertEquals(
    markContextTargets(
      '<ruby id="word" class="reading"><rb><span>鉄</span></rb><rp>（</rp><rt>' +
        "<span>てつ</span></rt><rp>）</rp><rb>釘</rb><rp>（</rp><rt>くぎ</rt><rp>）</rp></ruby>",
      ["釘"],
    ),
    '<ruby id="word" class="reading"><rb><span>鉄</span></rb><rp>（</rp><rt>' +
      '<span>てつ</span></rt><rp>）</rp></ruby><mark><ruby class="reading"><rb>釘</rb>' +
      "<rp>（</rp><rt>くぎ</rt><rp>）</rp></ruby></mark>",
  );
});

Deno.test("markContextTargets supports implicit ruby annotation components", () => {
  assertEquals(
    markContextTargets("<ruby>鉄<rt>てつ</rt>釘<rt>くぎ</rt></ruby>", ["釘"]),
    "<ruby>鉄<rt>てつ</rt></ruby><mark><ruby>釘<rt>くぎ</rt></ruby></mark>",
  );
});

Deno.test("markContextTargets rejects ranges that split a ruby base or inline element", () => {
  assertThrows(
    () => markContextTargets("<ruby><rb>東京</rb><rt>とうきょう</rt></ruby>", ["京"]),
    Error,
    "selects only part of a ruby annotation component",
  );
  assertThrows(
    () => markContextTargets("<span>大小</span>しい", ["小しい"]),
    Error,
    "partially crosses a <span>",
  );
});

Deno.test("markContextTargets rejects existing marks and malformed HTML", () => {
  assertThrows(
    () => markContextTargets("<mark>猫</mark>", ["猫"]),
    Error,
    "must not already contain <mark>",
  );
  assertThrows(
    () => markContextTargets('<p class="one" class="two">猫</p>', ["猫"]),
    Error,
    "could not be parsed safely",
  );
});

Deno.test("markContextTargets validates every distinct requested surface", () => {
  assertThrows(
    () => markContextTargets("猫", ["猫", "犬"]),
    Error,
    '"犬", which is absent',
  );
  assertThrows(
    () => markContextTargets("猫", [] as unknown as readonly [string, ...string[]]),
    Error,
    "at least one nonempty string",
  );
  assertThrows(
    () => markContextTargets("猫", [""]),
    Error,
    "at least one nonempty string",
  );
});

Deno.test("markedContextHasRuby distinguishes marked and unmarked source ruby", () => {
  assertEquals(
    markedContextHasRuby("<mark><span><ruby>猫<rt>ねこ</rt></ruby></span></mark>"),
    true,
  );
  assertEquals(markedContextHasRuby("<ruby>猫<rt>ねこ</rt></ruby><mark>犬</mark>"), false);
});
