import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { preextractedJMDictEntry } from "data";
import { renderDictionaryField } from "card_model/dictionary";
import { analyzeCard } from "../src/analyze.ts";
import { entriesById, makeNote, makeWord } from "./fixtures.ts";

const TWO_SENSES = makeWord({
  id: "1226200",
  kanji: ["掬う"],
  kana: ["すくう"],
  senses: [
    { glosses: ["to scoop", "to ladle out"] },
    { glosses: ["to dip up"] },
  ],
});

function renderDictionary(word: JMdictWord): string {
  return renderDictionaryField([word]);
}

Deno.test("analyzeCard: unchanged when stored HTML matches the latest rendering", async () => {
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(TWO_SENSES));
  assertEquals(card.verdict, "unchanged");
});

Deno.test("analyzeCard: normalize when only entity encoding differs", async () => {
  const word = makeWord({ senses: [{ glosses: ["when it's most important"] }] });
  const note = makeNote({
    key: "言葉 | 1000000",
    dictionary: renderDictionary(word).replaceAll("'", "&#39;"),
  });
  const card = await analyzeCard(note, entriesById(word));
  assertEquals(card.verdict, "normalize");
  assertEquals(card.reason, "encoding-only");
});

Deno.test("analyzeCard: exception when the entry was deleted", async () => {
  const note = makeNote({ key: "掬う | 1226200", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, new Map());
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "entry-deleted");
});

Deno.test("analyzeCard: exception for malformed keys", async () => {
  const note = makeNote({ key: "not a key", dictionary: "<p>x</p>" });
  assertEquals((await analyzeCard(note, entriesById(TWO_SENSES))).reason, "invalid-key");
});

Deno.test("analyzeCard: exception when the spelling left the entry", async () => {
  const renamed = makeWord({
    id: "1226200",
    kanji: ["抄う"],
    kana: ["すくう"],
    senses: [{ glosses: ["to scoop", "to ladle out"] }, { glosses: ["to dip up"] }],
  });
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(renamed));
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "spelling-removed");
});

Deno.test("analyzeCard: exception when the key targets a sense the stored entry lacks", async () => {
  const note = makeNote({ key: "掬う | 1226200:5", dictionary: renderDictionary(TWO_SENSES) });
  assertEquals((await analyzeCard(note, entriesById(TWO_SENSES))).reason, "target-out-of-range");
});

Deno.test("analyzeCard: routine for single-sense entries even when the gloss changed", async () => {
  const before = makeWord({ senses: [{ glosses: ["boisterous dance"] }] });
  const after = makeWord({ senses: [{ glosses: ["boisterous dancing"] }] });
  const note = makeNote({ key: "言葉 | 1000000", dictionary: renderDictionary(before) });
  const card = await analyzeCard(note, entriesById(after));
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
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(after));
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
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(swapped));
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "targets-renumbered");
  assertEquals(card.proposedKey, "掬う | 1226200:2");
});

Deno.test("analyzeCard: keeps multiple readings valid when a targeted sense moves", async () => {
  const word = await preextractedJMDictEntry("1158110");
  const swapped = structuredClone(word);
  swapped.sense.reverse();
  const note = makeNote({
    key: "異名 | 1158110:1",
    reading: "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
    dictionary: renderDictionary(word),
  });
  const card = await analyzeCard(note, entriesById(swapped));

  assertEquals(card.proposedKey, "異名 | 1158110:2");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: validates multiple readings against one Key usage", async () => {
  const word = await preextractedJMDictEntry("1158110");
  const note = makeNote({
    key: "異名 | 1158110:1",
    reading: "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
    dictionary: renderDictionary(word),
  });

  const card = await analyzeCard(note, entriesById(word));
  assertEquals(card.verdict, "unchanged");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: preserves a custom single-reading display", async () => {
  const word = await preextractedJMDictEntry("1158110");
  const note = makeNote({
    key: "異名 | 1158110:1",
    recognitionTarget: "その異名",
    reading: "その 異[い] 名[みょう]",
    dictionary: renderDictionary(word),
  });

  const card = await analyzeCard(note, entriesById(word));
  assertEquals(card.verdict, "unchanged");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: rejects a custom display whose reading is incompatible with the Key", async () => {
  const word = await preextractedJMDictEntry("1158110");
  const note = makeNote({
    key: "異名 | 1158110:2",
    recognitionTarget: "その異名",
    reading: "その 異[い] 名[みょう]",
    dictionary: renderDictionary(word),
  });

  const card = await analyzeCard(note, entriesById(word));
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "invalid-reading");
});

Deno.test("analyzeCard: canonically orders readings within a custom display", async () => {
  const word = await preextractedJMDictEntry("1158110");
  const note = makeNote({
    key: "異名 | 1158110:1",
    recognitionTarget: "その異名",
    reading: "<ul><li>その 異[い] 名[めい]</li><li>その 異[い] 名[みょう]</li></ul>",
    dictionary: renderDictionary(word),
  });

  const card = await analyzeCard(note, entriesById(word));
  assertEquals(
    card.proposedReading,
    "<ul><li>その 異[い] 名[みょう]</li><li>その 異[い] 名[めい]</li></ul>",
  );
});

Deno.test("analyzeCard: validates a Reading for a non-Han JMDict kanji form", async () => {
  const word = await preextractedJMDictEntry("1000110");
  const note = makeNote({
    key: "ＣＤプレイヤー | 1000110",
    reading: "Ｃ[シー] Ｄ[ディー]プレイヤー",
    dictionary: renderDictionary(word),
  });

  const card = await analyzeCard(note, entriesById(word));
  assertEquals(card.verdict, "unchanged");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: validates equivalent entries from the Key", async () => {
  const word = await preextractedJMDictEntry("1645430");
  const equivalent = await preextractedJMDictEntry("2863046");
  const note = makeNote({
    key: "生業 | 1645430;2863046",
    reading: "<ul><li>生[すぎ] 業[わい]</li><li>生[なり] 業[わい]</li></ul>",
    dictionary: renderDictionaryField([word, equivalent]),
  });

  const card = await analyzeCard(note, entriesById(word, equivalent));
  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "furigana-placement");
  assertEquals(
    card.proposedReading,
    "<ul><li>生業[なりわい]</li><li>生業[すぎわい]</li></ul>",
  );
});

Deno.test("analyzeCard: rejects noncanonical multi-entry Key order", async () => {
  const lowerId = await preextractedJMDictEntry("1645430");
  const higherId = await preextractedJMDictEntry("2863046");
  const note = makeNote({
    key: "生業 | 2863046;1645430",
    reading: "<ul><li>生業[すぎわい]</li><li>生業[なりわい]</li></ul>",
    dictionary: renderDictionaryField([higherId, lowerId]),
  });

  const card = await analyzeCard(note, entriesById(lowerId, higherId));
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "invalid-key");
  assertEquals(card.proposedKey, null);
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: renumbers a targeted sense in an equivalent entry", async () => {
  const anchor = await preextractedJMDictEntry("1550670");
  const equivalent = await preextractedJMDictEntry("2858813");
  const updatedEquivalent = structuredClone(equivalent);
  [updatedEquivalent.sense[0], updatedEquivalent.sense[1]] = [
    updatedEquivalent.sense[1],
    updatedEquivalent.sense[0],
  ];
  const note = makeNote({
    key: "裏面 | 1550670:1;2858813:1",
    reading: "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
    dictionary: renderDictionaryField([anchor, equivalent]),
  });

  const card = await analyzeCard(
    note,
    entriesById(anchor, updatedEquivalent),
  );

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "supplemental-targets-renumbered");
  assertEquals(card.proposedKey, "裏面 | 1550670:1;2858813:2");
});

Deno.test("analyzeCard: fails closed when an equivalent entry's target changed", async () => {
  const anchor = await preextractedJMDictEntry("1550670");
  const equivalent = await preextractedJMDictEntry("2858813");
  const updatedEquivalent = structuredClone(equivalent);
  updatedEquivalent.sense[0].gloss[0].text = "reverse side of an object";
  const note = makeNote({
    key: "裏面 | 1550670:1;2858813:1",
    reading: "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
    dictionary: renderDictionaryField([anchor, equivalent]),
  });

  const card = await analyzeCard(
    note,
    entriesById(anchor, updatedEquivalent),
  );

  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "supplemental-target-changed");
});

Deno.test("analyzeCard: rechecks equivalence when a one-sense supplemental entry changes", async () => {
  const anchor = await preextractedJMDictEntry("1645430");
  const equivalent = await preextractedJMDictEntry("2863046");
  const updatedEquivalent = structuredClone(equivalent);
  updatedEquivalent.sense[0].gloss[0].text = "way of making a living";
  const note = makeNote({
    key: "生業 | 1645430:1;2863046",
    reading: "<ul><li>生業[なりわい]</li><li>生業[すぎわい]</li></ul>",
    dictionary: renderDictionaryField([anchor, equivalent]),
  });

  const card = await analyzeCard(
    note,
    entriesById(anchor, updatedEquivalent),
  );

  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "supplemental-target-changed");
});

Deno.test("analyzeCard: rechecks equivalence when the anchor target changes", async () => {
  const anchor = await preextractedJMDictEntry("1550670");
  const equivalent = await preextractedJMDictEntry("2858813");
  const updatedAnchor = structuredClone(anchor);
  updatedAnchor.sense[0].gloss[0].text = "reverse side";
  const note = makeNote({
    key: "裏面 | 1550670:1;2858813:1",
    reading: "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
    dictionary: renderDictionaryField([anchor, equivalent]),
  });

  const card = await analyzeCard(
    note,
    entriesById(updatedAnchor, equivalent),
  );

  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "equivalent-target-changed");
});

Deno.test("analyzeCard: keeps multi-entry cards routine when only an unselected sense changes", async () => {
  const anchor = await preextractedJMDictEntry("1550670");
  const equivalent = await preextractedJMDictEntry("2858813");
  const updatedAnchor = structuredClone(anchor);
  updatedAnchor.sense[1].gloss[0].text = "B-side of a phonograph record";
  const note = makeNote({
    key: "裏面 | 1550670:1;2858813:1",
    reading: "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
    dictionary: renderDictionaryField([anchor, equivalent]),
  });

  const card = await analyzeCard(
    note,
    entriesById(updatedAnchor, equivalent),
  );

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "targets-intact");
});

Deno.test("analyzeCard: rejects a multi-entry field missing its equivalent block", async () => {
  const primary = await preextractedJMDictEntry("1645430");
  const equivalent = await preextractedJMDictEntry("2863046");
  const note = makeNote({
    key: "生業 | 1645430;2863046",
    reading: "<ul><li>生業[なりわい]</li><li>生業[すぎわい]</li></ul>",
    dictionary: renderDictionary(primary),
  });

  const card = await analyzeCard(note, entriesById(primary, equivalent));
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "stored-entry-unparseable");
});

Deno.test("analyzeCard: rejects an equivalent Key usage unsupported by Reading", async () => {
  const word = await preextractedJMDictEntry("1645430");
  const equivalent = await preextractedJMDictEntry("2863046");
  const note = makeNote({
    key: "生業 | 1645430;2863046",
    reading: "生[なり] 業[わい]",
    dictionary: renderDictionaryField([word, equivalent]),
  });

  const card = await analyzeCard(note, entriesById(word, equivalent));
  assertEquals(card.verdict, "exception");
  assertEquals(card.reason, "invalid-reading");
  assertEquals(card.detail.includes("2863046"), true);
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
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(tagged));
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
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(reworded));
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
  const note = makeNote({ key: "息抜き | 1404430", dictionary: renderDictionary(before) });
  const card = await analyzeCard(note, entriesById(after));
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
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(shrunk));
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
  const note = makeNote({ key: "掬う | 1226200:1", dictionary: renderDictionary(TWO_SENSES) });
  const card = await analyzeCard(note, entriesById(reshuffled));

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
      dictionary: renderDictionary(word),
    });
    const card = await analyzeCard(note, entriesById(word));

    assertEquals(card.verdict, "routine");
    assertEquals(card.reason, "furigana-placement");
    assertEquals(card.proposedReading, "食[た]べる");
    assertEquals(card.changeChips.map((chip) => chip.kind), ["reading"]);
  },
);

Deno.test("analyzeCard: updates furigana beneath automatic affix notation", async () => {
  const word = makeWord({
    id: "1358280",
    kanji: ["食べる"],
    kana: ["たべる"],
    senses: [{ glosses: ["to eat"] }],
  });
  const note = makeNote({
    key: "食べる | 1358280",
    recognitionTarget: "～食べる",
    reading: "～食べ[たべ]る",
    dictionary: renderDictionary(word),
  });
  const card = await analyzeCard(note, entriesById(word));

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "furigana-placement");
  assertEquals(card.proposedReading, "～ 食[た]べる");
});

Deno.test("analyzeCard: keeps a leading affix marker outside the first ruby base", async () => {
  const word = makeWord({
    id: "1358280",
    kanji: ["食べる"],
    kana: ["たべる"],
    senses: [{ glosses: ["to eat"] }],
  });
  const note = makeNote({
    key: "食べる | 1358280",
    recognitionTarget: "～食べる",
    reading: "～ 食[た]べる",
    dictionary: renderDictionary(word),
  });
  const card = await analyzeCard(note, entriesById(word));

  assertEquals(card.verdict, "unchanged");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: preserves a stored half-width affix marker while updating furigana", async () => {
  const word = makeWord({
    id: "1358280",
    kanji: ["食べる"],
    kana: ["たべる"],
    senses: [{ glosses: ["to eat"] }],
  });
  const note = makeNote({
    key: "食べる | 1358280",
    recognitionTarget: "〜食べる",
    reading: "〜食べ[たべ]る",
    dictionary: renderDictionary(word),
  });
  const card = await analyzeCard(note, entriesById(word));

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "furigana-placement");
  assertEquals(card.proposedReading, "〜 食[た]べる");
});

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
    dictionary: renderDictionary(word).replaceAll("'", "&#39;"),
  });
  const card = await analyzeCard(note, entriesById(word));

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
    dictionary: renderDictionary(word),
  });
  const card = await analyzeCard(note, entriesById(word));

  assertEquals(card.verdict, "unchanged");
  assertEquals(card.reason, "unchanged");
  assertEquals(card.proposedReading, null);
});

Deno.test("analyzeCard: repairs malformed zero-surface furigana annotations", async () => {
  const word = makeWord({
    id: "2252350",
    kanji: ["大人買い"],
    kana: ["おとながい"],
    senses: [{ glosses: ["buying a large amount as an adult"] }],
  });
  const note = makeNote({
    key: "大人買い | 2252350",
    reading: "大[お] 人[と] [な] 買[が]い",
    dictionary: renderDictionary(word),
  });
  const card = await analyzeCard(note, entriesById(word));

  assertEquals(card.verdict, "routine");
  assertEquals(card.reason, "furigana-placement");
  assertEquals(card.proposedReading, "大人[おとな] 買[が]い");
});

Deno.test(
  "analyzeCard: rejects genuinely malformed readings",
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
      dictionary: renderDictionary(word),
    });
    const card = await analyzeCard(note, entriesById(word));

    assertEquals(card.verdict, "exception");
    assertEquals(card.reason, "invalid-reading");
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
    dictionary: renderDictionary(word),
  });

  assertEquals((await analyzeCard(note, entriesById(word))).verdict, "unchanged");
});
