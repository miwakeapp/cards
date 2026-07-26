import { assertEquals } from "@std/assert";
import { applyAnkiFuriganaFilter, renderAnkiTemplate } from "../src/anki_template.ts";

Deno.test("applyAnkiFuriganaFilter converts bracket notation to ruby", () => {
  assertEquals(
    applyAnkiFuriganaFilter("堪忍袋[かんにんぶくろ]の 緒[お]が 切[き]れる"),
    "<ruby><rb>堪忍袋</rb><rt>かんにんぶくろ</rt></ruby>の" +
      "<ruby><rb>緒</rb><rt>お</rt></ruby>が" +
      "<ruby><rb>切</rb><rt>き</rt></ruby>れる",
  );
});

Deno.test("applyAnkiFuriganaFilter works inside stored HTML", () => {
  assertEquals(
    applyAnkiFuriganaFilter("<mark>食[た]べる</mark>"),
    "<mark><ruby><rb>食</rb><rt>た</rt></ruby>べる</mark>",
  );
});

Deno.test("applyAnkiFuriganaFilter preserves sound tags and normalizes nonbreaking spaces", () => {
  assertEquals(
    applyAnkiFuriganaFilter("音声[sound:voice.mp3]&nbsp; 食[た]べる"),
    "音声[sound:voice.mp3] <ruby><rb>食</rb><rt>た</rt></ruby>べる",
  );
});

Deno.test("renderAnkiTemplate applies fields, furigana, and conditional sections", () => {
  const template = [
    "{{#Hint}}<p>{{Hint}}</p>{{/Hint}}",
    "{{^Hint}}<p>no hint</p>{{/Hint}}",
    "<p>{{furigana:Reading}}</p>",
  ].join("");

  assertEquals(
    renderAnkiTemplate(template, { Hint: "", Reading: "食[た]べる" }),
    "<p>no hint</p><p><ruby><rb>食</rb><rt>た</rt></ruby>べる</p>",
  );
});
