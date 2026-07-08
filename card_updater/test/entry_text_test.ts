import { assertEquals } from "@std/assert";
import { renderEntry } from "jmdict_to_html";
import {
  alignSenses,
  canonicalEntryHTML,
  decodeHTMLEntities,
  diffSegments,
  parseRenderedEntry,
} from "../src/entry_text.ts";
import { makeWord } from "./fixtures.ts";

Deno.test("decodeHTMLEntities: named, decimal, and hex forms", () => {
  assertEquals(decodeHTMLEntities("it&#39;s &quot;fine&quot; &amp; dandy"), `it's "fine" & dandy`);
  assertEquals(decodeHTMLEntities("caf&#233; &#x30C6;"), "café テ");
  // `&amp;` decodes last, so double-encoded text stays single-encoded.
  assertEquals(decodeHTMLEntities("&amp;#39;"), "&#39;");
});

Deno.test("canonicalEntryHTML: encoding and whitespace differences vanish", () => {
  const entityVariant = "<ul>\r\n  <li>it&#39;s</li>\n</ul>";
  const rawVariant = "<ul>\n    <li>it's</li>\n</ul>";
  assertEquals(canonicalEntryHTML(entityVariant), canonicalEntryHTML(rawVariant));
  assertEquals(
    canonicalEntryHTML("<li>a</li>") === canonicalEntryHTML("<li>b</li>"),
    false,
  );
});

Deno.test("parseRenderedEntry: forms, gloss separators, shared metadata", () => {
  const word = makeWord({
    kanji: ["掬う", "抄う"],
    kana: ["すくう"],
    senses: [
      { glosses: ["to scoop", "to ladle out"] },
      { glosses: ["to trip up"], misc: ["uk"] },
    ],
  });
  const parsed = parseRenderedEntry(renderEntry(word));

  assertEquals(parsed.kanjiForms, ["掬う", "抄う"]);
  assertEquals(parsed.kanaForms, ["すくう"]);
  assertEquals(parsed.senses.length, 2);
  assertEquals(parsed.senses[0].glosses, ["to scoop", "to ladle out"]);
  assertEquals(parsed.senses[0].text, "to scoop; to ladle out");
  // The misc tag is part of the sense text (separated), but not of the glosses.
  assertEquals(parsed.senses[1].glosses, ["to trip up"]);
  assertEquals(parsed.senses[1].text.startsWith("to trip up"), true);
  assertEquals(parsed.senses[1].text.includes("·"), true);
  // Part of speech is shared by both senses, so it is entry-level text.
  assertEquals(parsed.sharedText, "noun");
});

Deno.test("parseRenderedEntry: tolerates entity-encoded stored HTML", () => {
  const word = makeWord({ senses: [{ glosses: ["when it's most important"] }] });
  const rendered = renderEntry(word);
  const entityEncoded = rendered.replaceAll("'", "&#39;");
  assertEquals(
    parseRenderedEntry(entityEncoded).senses[0].text,
    parseRenderedEntry(rendered).senses[0].text,
  );
});

Deno.test("diffSegments: word-level with CJK characters", () => {
  // Punctuation tokenizes separately, so parenthesization only inserts the parentheses.
  const segments = diffSegments("to be rich in", "to be rich (in)");
  const inserted = segments.filter((segment) => segment.type === "ins").map((s) => s.text);
  const deleted = segments.filter((segment) => segment.type === "del").map((s) => s.text);
  assertEquals(inserted.join(""), "()");
  assertEquals(deleted.join(""), "");

  const jaSegments = diffSegments("魂の番", "魂の相棒");
  assertEquals(jaSegments.some((s) => s.type === "same" && s.text.includes("魂の")), true);
  assertEquals(jaSegments.some((s) => s.type === "del" && s.text === "番"), true);
});

Deno.test("alignSenses: exact, renumbered, fuzzy, added, removed", () => {
  const oldSenses = [
    { number: 1, text: "to scoop; to ladle out", glosses: ["to scoop", "to ladle out"] },
    { number: 2, text: "to dip up", glosses: ["to dip up"] },
    { number: 3, text: "completely unrelated", glosses: ["completely unrelated"] },
  ];
  const newSenses = [
    { number: 1, text: "to dip up", glosses: ["to dip up"] },
    { number: 2, text: "to scoop; to ladle out; to dish up", glosses: ["to scoop"] },
    { number: 3, text: "to trip up", glosses: ["to trip up"] },
  ];
  const alignment = alignSenses(oldSenses, newSenses);

  // Old 2 matches new 1 exactly; old 1 fuzzily matches new 2; old 3 is removed; new 3 is added.
  const exact = alignment.pairs.find((pair) => pair.old.number === 2)!;
  assertEquals(exact.new.number, 1);
  assertEquals(exact.changed, false);

  const fuzzy = alignment.pairs.find((pair) => pair.old.number === 1)!;
  assertEquals(fuzzy.new.number, 2);
  assertEquals(fuzzy.changed, true);

  assertEquals(alignment.removedSenses.map((sense) => sense.number), [3]);
  assertEquals(alignment.addedSenses.map((sense) => sense.number), [3]);
});

Deno.test("alignSenses: prefers same-position exact match over earlier duplicate", () => {
  const duplicated = [
    { number: 1, text: "same text", glosses: ["same text"] },
    { number: 2, text: "same text", glosses: ["same text"] },
  ];
  const alignment = alignSenses(duplicated, duplicated);
  assertEquals(
    alignment.pairs.map((pair) => [pair.old.number, pair.new.number]),
    [[1, 1], [2, 2]],
  );
});
