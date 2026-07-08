import { assertEquals } from "@std/assert";
import { renderEntry } from "jmdict_to_html";
import { analyzeCard } from "../src/analyze.ts";
import { makeNote, makeWord } from "./fixtures.ts";

const TWO_SENSES = makeWord({
  id: "1226200",
  kanji: ["掬う"],
  kana: ["すくう"],
  senses: [
    { glosses: ["to scoop", "to ladle out"] },
    { glosses: ["to dip up"] },
  ],
});

Deno.test("analyzeCard: unchanged when stored HTML matches the latest rendering", () => {
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, TWO_SENSES);
  assertEquals(card.verdict, "unchanged");
});

Deno.test("analyzeCard: normalize when only entity encoding differs", () => {
  const word = makeWord({ senses: [{ glosses: ["when it's most important"] }] });
  const note = makeNote({
    key: "言葉 | 1000000",
    dictionaryEntry: renderEntry(word).replaceAll("'", "&#39;"),
  });
  const card = analyzeCard(note, word);
  assertEquals(card.verdict, "normalize");
  assertEquals(card.reason, "encoding-only");
});

Deno.test("analyzeCard: exception when the entry was deleted", () => {
  const note = makeNote({ key: "掬う | 1226200", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, undefined);
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "entry-deleted");
});

Deno.test("analyzeCard: exception for malformed keys", () => {
  const note = makeNote({ key: "not a key", dictionaryEntry: "<p>x</p>" });
  assertEquals(analyzeCard(note, TWO_SENSES).reason, "invalid-key");
});

Deno.test("analyzeCard: exception when the spelling left the entry", () => {
  const renamed = makeWord({
    id: "1226200",
    kanji: ["抄う"],
    kana: ["すくう"],
    senses: [{ glosses: ["to scoop", "to ladle out"] }, { glosses: ["to dip up"] }],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, renamed);
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "spelling-removed");
});

Deno.test("analyzeCard: exception when the key targets a sense the stored entry lacks", () => {
  const note = makeNote({ key: "掬う | 1226200 | 5", dictionaryEntry: renderEntry(TWO_SENSES) });
  assertEquals(analyzeCard(note, TWO_SENSES).reason, "target-out-of-range");
});

Deno.test("analyzeCard: routine for single-sense entries even when the gloss changed", () => {
  const before = makeWord({ senses: [{ glosses: ["boisterous dance"] }] });
  const after = makeWord({ senses: [{ glosses: ["boisterous dancing"] }] });
  const note = makeNote({ key: "言葉 | 1000000", dictionaryEntry: renderEntry(before) });
  const card = analyzeCard(note, after);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "single-sense");
  assertEquals(card.changeChips.some((chip) => chip.kind === "sense-edited"), true);
});

Deno.test("analyzeCard: routine when only non-targeted senses changed", () => {
  const after = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [
      { glosses: ["to scoop", "to ladle out"] },
      { glosses: ["to dip up", "to draw (water)"] },
    ],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, after);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "targets-intact");
  assertEquals(card.needsAI, false);
});

Deno.test("analyzeCard: routine rekey when the targeted sense text merely moved", () => {
  const swapped = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [
      { glosses: ["to dip up"] },
      { glosses: ["to scoop", "to ladle out"] },
    ],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, swapped);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "targets-renumbered");
  assertEquals(card.proposedKey, "掬う | 1226200 | 2");
});

Deno.test("analyzeCard: routine when only targeted-sense metadata changed", () => {
  const tagged = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [
      { glosses: ["to scoop", "to ladle out"], misc: ["uk"] },
      { glosses: ["to dip up"] },
    ],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, tagged);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "target-metadata");
});

Deno.test("analyzeCard: retarget when a targeted sense's text changed", () => {
  const reworded = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [
      { glosses: ["to scoop up", "to dish up"] },
      { glosses: ["to dip up"] },
    ],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, reworded);
  assertEquals(card.verdict, "retarget");
  assertEquals(card.reason, "target-changed");
  assertEquals(card.needsAI, true);
});

Deno.test("analyzeCard: retarget when an all-senses entry gains a sense", () => {
  const before = makeWord({
    id: "1404430",
    kanji: ["息抜き"],
    kana: ["いきぬき"],
    senses: [{ glosses: ["taking a breather"] }],
  });
  const after = makeWord({
    id: "1404430",
    kanji: ["息抜き"],
    kana: ["いきぬき"],
    senses: [{ glosses: ["taking a breather"] }, { glosses: ["vent hole"] }],
  });
  const note = makeNote({ key: "息抜き | 1404430", dictionaryEntry: renderEntry(before) });
  const card = analyzeCard(note, after);
  assertEquals(card.verdict, "retarget");
  assertEquals(card.reason, "all-senses-reshaped");
  assertEquals(card.needsAI, true);
  assertEquals(card.senseViews.map((view) => view.isNew), [false, true]);
  assertEquals(card.mappedTargetSenses, [1]);
});

Deno.test("analyzeCard: retarget when a targeted sense disappeared", () => {
  const shrunk = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [{ glosses: ["to dip up"] }],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, shrunk);
  assertEquals(card.verdict, "retarget");
  assertEquals(card.reason, "target-gone");
  assertEquals(card.removedTargetedSenses, [1]);
});

Deno.test("analyzeCard: sense views annotate diffs, origins, and targeting", () => {
  const reshuffled = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [
      { glosses: ["to dip up"] },
      { glosses: ["to scoop", "to ladle out", "to dish up"] },
    ],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = analyzeCard(note, reshuffled);

  const [first, second] = card.senseViews;
  assertEquals(first.fromOldSense, 2);
  assertEquals(first.wasTargeted, false);
  assertEquals(second.fromOldSense, 1);
  assertEquals(second.wasTargeted, true);
  assertEquals(second.segments !== undefined, true);
});
