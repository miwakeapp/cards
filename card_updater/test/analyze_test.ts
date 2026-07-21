import "../../data/test/use_furigana_fixture.ts";

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

Deno.test("analyzeCard: unchanged when stored HTML matches the latest rendering", async () => {
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = await analyzeCard(note, TWO_SENSES);
  assertEquals(card.verdict, "unchanged");
});

Deno.test("analyzeCard: normalize when only entity encoding differs", async () => {
  const word = makeWord({ senses: [{ glosses: ["when it's most important"] }] });
  const note = makeNote({
    key: "言葉 | 1000000",
    dictionaryEntry: renderEntry(word).replaceAll("'", "&#39;"),
  });
  const card = await analyzeCard(note, word);
  assertEquals(card.verdict, "normalize");
  assertEquals(card.reason, "encoding-only");
});

Deno.test("analyzeCard: exception when the entry was deleted", async () => {
  const note = makeNote({ key: "掬う | 1226200", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = await analyzeCard(note, undefined);
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "entry-deleted");
});

Deno.test("analyzeCard: exception for malformed keys", async () => {
  const note = makeNote({ key: "not a key", dictionaryEntry: "<p>x</p>" });
  assertEquals((await analyzeCard(note, TWO_SENSES)).reason, "invalid-key");
});

Deno.test("analyzeCard: exception when the spelling left the entry", async () => {
  const renamed = makeWord({
    id: "1226200",
    kanji: ["抄う"],
    kana: ["すくう"],
    senses: [{ glosses: ["to scoop", "to ladle out"] }, { glosses: ["to dip up"] }],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = await analyzeCard(note, renamed);
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "spelling-removed");
});

Deno.test("analyzeCard: exception when the key targets a sense the stored entry lacks", async () => {
  const note = makeNote({ key: "掬う | 1226200 | 5", dictionaryEntry: renderEntry(TWO_SENSES) });
  assertEquals((await analyzeCard(note, TWO_SENSES)).reason, "target-out-of-range");
});

Deno.test("analyzeCard: routine for single-sense entries even when the gloss changed", async () => {
  const before = makeWord({ senses: [{ glosses: ["boisterous dance"] }] });
  const after = makeWord({ senses: [{ glosses: ["boisterous dancing"] }] });
  const note = makeNote({ key: "言葉 | 1000000", dictionaryEntry: renderEntry(before) });
  const card = await analyzeCard(note, after);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "single-sense");
  assertEquals(card.changeChips.some((chip) => chip.kind === "sense-edited"), true);
});

Deno.test("analyzeCard: routine when only non-targeted senses changed", async () => {
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
  const card = await analyzeCard(note, after);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "targets-intact");
  assertEquals(card.needsAI, false);
});

Deno.test("analyzeCard: routine rekey when the targeted sense text merely moved", async () => {
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
  const card = await analyzeCard(note, swapped);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "targets-renumbered");
  assertEquals(card.proposedKey, "掬う | 1226200 | 2");
});

Deno.test("analyzeCard: routine when only targeted-sense metadata changed", async () => {
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
  const card = await analyzeCard(note, tagged);
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "target-metadata");
});

Deno.test("analyzeCard: retarget when a targeted sense's text changed", async () => {
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
  const card = await analyzeCard(note, reworded);
  assertEquals(card.verdict, "retarget");
  assertEquals(card.reason, "target-changed");
  assertEquals(card.needsAI, true);
});

Deno.test("analyzeCard: retarget when an all-senses entry gains a sense", async () => {
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
  const card = await analyzeCard(note, after);
  assertEquals(card.verdict, "retarget");
  assertEquals(card.reason, "all-senses-reshaped");
  assertEquals(card.needsAI, true);
  assertEquals(card.senseViews.map((view) => view.isNew), [false, true]);
  assertEquals(card.mappedTargetSenses, [1]);
});

Deno.test("analyzeCard: retarget when a targeted sense disappeared", async () => {
  const shrunk = makeWord({
    id: "1226200",
    kanji: ["掬う"],
    kana: ["すくう"],
    senses: [{ glosses: ["to dip up"] }],
  });
  const note = makeNote({ key: "掬う | 1226200 | 1", dictionaryEntry: renderEntry(TWO_SENSES) });
  const card = await analyzeCard(note, shrunk);
  assertEquals(card.verdict, "retarget");
  assertEquals(card.reason, "target-gone");
  assertEquals(card.removedTargetedSenses, [1]);
});

Deno.test("analyzeCard: sense views annotate diffs, origins, and targeting", async () => {
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
  const card = await analyzeCard(note, reshuffled);

  const [first, second] = card.senseViews;
  assertEquals(first.fromOldSense, 2);
  assertEquals(first.wasTargeted, false);
  assertEquals(second.fromOldSense, 1);
  assertEquals(second.wasTargeted, true);
  assertEquals(second.segments !== undefined, true);
});

Deno.test(
  "analyzeCard: routine when furigana boundaries change without pronunciation",
  async () => {
    const word = makeWord({
      id: "1358280",
      kanji: ["食べる"],
      kana: ["たべる"],
      senses: [{ glosses: ["to eat"] }],
    });
    const note = makeNote({
      key: "食べる | 1358280",
      reading: "食べ[たべ]る",
      dictionaryEntry: renderEntry(word),
    });
    const card = await analyzeCard(note, word);

    assertEquals(card.verdict, "routine");
    assertEquals(card.reason, "furigana-placement");
    assertEquals(card.proposedReading, "食[た]べる");
    assertEquals(card.changeChips.map((chip) => chip.kind), ["reading"]);
  },
);

Deno.test("analyzeCard: surfaces Reading changes alongside HTML normalization", async () => {
  const word = makeWord({
    id: "1358280",
    kanji: ["食べる"],
    kana: ["たべる"],
    senses: [{ glosses: ["to eat one's fill"] }],
  });
  const note = makeNote({
    key: "食べる | 1358280",
    reading: "食べ[たべ]る",
    dictionaryEntry: renderEntry(word).replaceAll("'", "&#39;"),
  });
  const card = await analyzeCard(note, word);

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "furigana-placement");
  assertEquals(card.changeChips.map((chip) => chip.kind), ["formatting", "reading"]);
});

Deno.test("analyzeCard: preserves precise readings that have no current lookup", async () => {
  const word = makeWord({
    id: "9999999",
    kanji: ["食べる"],
    kana: ["たべる"],
    senses: [{ glosses: ["to eat"] }],
  });
  const note = makeNote({
    key: "食べる | 9999999",
    reading: "食[た]べる",
    dictionaryEntry: renderEntry(word),
  });
  const card = await analyzeCard(note, word);

  assertEquals(card.verdict, "unchanged");
  assertEquals(card.reason, "unchanged");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: repairs legacy zero-surface furigana annotations", async () => {
  const word = makeWord({
    id: "2252350",
    kanji: ["大人買い"],
    kana: ["おとながい"],
    senses: [{ glosses: ["buying a large amount as an adult"] }],
  });
  const note = makeNote({
    key: "大人買い | 2252350",
    reading: "大[お] 人[と] [な] 買[が]い",
    dictionaryEntry: renderEntry(word),
  });
  const card = await analyzeCard(note, word);

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "furigana-placement");
  assertEquals(card.proposedReading, "大人[おとな] 買[が]い");
});

Deno.test(
  "analyzeCard: preserves genuinely malformed readings without surfacing a change",
  async () => {
    const word = makeWord({
      id: "1791040",
      kanji: ["気風"],
      kana: ["きっぷ"],
      senses: [{ glosses: ["temperament"] }],
    });
    const note = makeNote({
      key: "気風 | 1791040",
      reading: "気[き [っ] 風[ぷ]",
      dictionaryEntry: renderEntry(word),
    });
    const card = await analyzeCard(note, word);

    assertEquals(card.verdict, "unchanged");
    assertEquals(card.proposedReading, null);
  },
);

Deno.test("analyzeCard: leaves coarse fallback readings alone when no lookup exists", async () => {
  const word = makeWord({
    id: "9999999",
    kanji: ["食べる"],
    kana: ["たべる"],
    senses: [{ glosses: ["to eat"] }],
  });
  const note = makeNote({
    key: "食べる | 9999999",
    reading: "食べる[たべる]",
    dictionaryEntry: renderEntry(word),
  });

  assertEquals((await analyzeCard(note, word)).verdict, "unchanged");
});
