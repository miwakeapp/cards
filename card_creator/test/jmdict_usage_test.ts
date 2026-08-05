import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { type JMDictWord, preextractedJMDictEntry } from "data";
import {
  compatibleSenseNumbersForJMDictUsage,
  jmdictAlternativesForCardFront,
  jmdictUsagesForSpelling,
} from "card_creator/jmdict";

function oneSenseEntry(id: string, partOfSpeech: string[]): JMDictWord {
  return {
    id,
    kanji: [],
    kana: [{ common: false, text: "ヅラ", tags: [], appliesToKanji: ["*"] }],
    sense: [{
      partOfSpeech,
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [{ lang: "eng", gender: null, type: null, text: `usage ${id}` }],
    }],
  };
}

Deno.test("compatibleSenseNumbersForJMDictUsage applies reading restrictions", async () => {
  const entry = await preextractedJMDictEntry("1158110");

  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "異名", "いみょう"),
    [1],
  );
  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "異名", "いめい"),
    [1, 2],
  );
  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "いみょう", undefined),
    [1],
  );
});

Deno.test("compatibleSenseNumbersForJMDictUsage retains unrestricted senses", async () => {
  const entry = await preextractedJMDictEntry("1414110");

  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "大小", "だいしょう"),
    [1, 2, 3, 4, 5, 6],
  );
});

Deno.test("compatibleSenseNumbersForJMDictUsage applies spelling restrictions", async () => {
  const entry = await preextractedJMDictEntry("2013080");

  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "歿する", "ぼっする"),
    [2],
  );
  assertEquals(
    compatibleSenseNumbersForJMDictUsage(entry, "没する", "ぼっする"),
    [1, 2, 3, 4],
  );
});

Deno.test("jmdictUsagesForSpelling unions senses across applicable readings", async () => {
  const entry = await preextractedJMDictEntry("1158110");

  // 異名 has readings いみょう (sense 1 only) and いめい (senses 1 and 2). A front-side
  // spelling competitor must include both readings even when a particular card selected one.
  assertEquals(jmdictUsagesForSpelling([entry], "異名"), [{
    entry,
    senseNumbers: [1, 2],
  }]);

  // An exact kana spelling represents only the senses allowed for that kana form.
  assertEquals(jmdictUsagesForSpelling([entry], "いみょう"), [{
    entry,
    senseNumbers: [1],
  }]);
  assertEquals(jmdictUsagesForSpelling([entry], "not a spelling"), []);

  const spellingRestrictedEntry = await preextractedJMDictEntry("2013080");
  assertEquals(jmdictUsagesForSpelling([spellingRestrictedEntry], "歿する"), [{
    entry: spellingRestrictedEntry,
    senseNumbers: [2],
  }]);
  assertEquals(jmdictUsagesForSpelling([spellingRestrictedEntry], "没する"), [{
    entry: spellingRestrictedEntry,
    senseNumbers: [1, 2, 3, 4],
  }]);
});

Deno.test("jmdictUsagesForSpelling omits entries without an available exact spelling", async () => {
  const matching = await preextractedJMDictEntry("1158110");
  const unrelated = await preextractedJMDictEntry("1414110");

  assertEquals(jmdictUsagesForSpelling([matching, unrelated], "異名"), [{
    entry: matching,
    senseNumbers: [1, 2],
  }]);
});

Deno.test("jmdictAlternativesForCardFront uses automatic affix notation", () => {
  const selectedSuffix = oneSenseEntry("1000000", ["n-suf"]);
  const noun = oneSenseEntry("2000000", ["n"]);
  const otherSuffix = oneSenseEntry("3000000", ["suf"]);

  assertEquals(
    jmdictAlternativesForCardFront(
      { entry: selectedSuffix, senseNumbers: [1] },
      jmdictUsagesForSpelling([selectedSuffix, noun], "ヅラ"),
    ),
    [],
  );
  assertEquals(
    jmdictAlternativesForCardFront(
      { entry: selectedSuffix, senseNumbers: [1] },
      jmdictUsagesForSpelling([selectedSuffix, noun], "ヅラ"),
      { displayedAffixNotation: "none" },
    ),
    [{ entry: noun, senseNumbers: [1] }],
  );
  assertEquals(
    jmdictAlternativesForCardFront(
      { entry: selectedSuffix, senseNumbers: [1] },
      jmdictUsagesForSpelling([selectedSuffix, noun, otherSuffix], "ヅラ"),
    ),
    [{ entry: otherSuffix, senseNumbers: [1] }],
  );
});

Deno.test("jmdictAlternativesForCardFront retains another same-boundary sense", () => {
  const suffix = oneSenseEntry("1000000", ["n-suf"]);
  suffix.sense.push({
    ...structuredClone(suffix.sense[0]),
    gloss: [{ lang: "eng", gender: null, type: null, text: "another suffix usage" }],
  });

  assertEquals(
    jmdictAlternativesForCardFront(
      { entry: suffix, senseNumbers: [1] },
      [{ entry: suffix, senseNumbers: [1, 2] }],
    ),
    [{ entry: suffix, senseNumbers: [2] }],
  );
});
