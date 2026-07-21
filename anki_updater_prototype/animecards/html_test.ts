import { assertEquals } from "@std/assert";
import {
  contextPlainText,
  extractJMDictIDs,
  normalizeContextHTML,
  parseRecognitionTargetField,
  readingFieldCandidates,
} from "./html.ts";

Deno.test("extractJMDictIDs accepts escaped Jitendex and Takoboto links", () => {
  assertEquals(
    extractJMDictIDs(
      '<a href="https://jitendex.org/?q=1234567&amp;x=1">one</a>' +
        '<a href="https://takoboto.jp/?w=7654321">two</a>',
    ),
    ["1234567", "7654321"],
  );
});

Deno.test("normalizeContextHTML unwraps presentation without discarding ruby", () => {
  const normalized = normalizeContextHTML(
    "<b>彼は<mark><ruby>潤<rt>うるお</rt></ruby>った</mark>。</b>[sound:test.mp3]",
  );
  assertEquals(normalized, "彼は<ruby>潤<rt>うるお</rt></ruby>った。");
  assertEquals(contextPlainText(normalized), "彼は潤った。");
});

Deno.test("readingFieldCandidates understands plain and Anki bracket readings", () => {
  assertEquals(readingFieldCandidates("うるおう"), ["うるおう"]);
  assertEquals(readingFieldCandidates("潤[うるお]う"), ["潤[うるお]う", "うるおう"]);
  assertEquals(readingFieldCandidates("種つけ[たねつけ]"), [
    "種つけ[たねつけ]",
    "たねつけ",
  ]);
  assertEquals(readingFieldCandidates("キョロキョロ"), ["キョロキョロ"]);
});

Deno.test("parseRecognitionTargetField separates spelling and bracketed guidance", () => {
  assertEquals(parseRecognitionTargetField("業[ごう]"), { text: "業", hasHint: false });
  assertEquals(parseRecognitionTargetField("餃[ぎょう] 子[ざ]"), {
    text: "餃子",
    hasHint: false,
  });
  assertEquals(parseRecognitionTargetField("種つけ[たねつけ]"), {
    text: "種つけ",
    hasHint: false,
  });
  assertEquals(parseRecognitionTargetField("～越し"), { text: "～越し", hasHint: false });
  assertEquals(parseRecognitionTargetField("懐 [懐に飛び込んでくる]"), {
    text: "懐",
    hasHint: true,
  });
});
