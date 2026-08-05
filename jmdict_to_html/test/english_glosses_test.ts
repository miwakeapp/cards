import { assertEquals, assertStringIncludes } from "@std/assert";
import { preextractedJMDictEntry } from "data";

import { filterRedundantBritishEnglishGlosses } from "../src/english_glosses.ts";
import { renderEntry } from "../src/mod.ts";

type Gloss = Parameters<typeof filterRedundantBritishEnglishGlosses>[0][number];

const SPELLING_PAIRS = [
  ["favourite colour", "favorite color"],
  ["behaviour", "behavior"],
  ["TV programme", "TV program"],
  ["centre", "center"],
  ["unskilful", "unskillful"],
  ["to organise", "to organize"],
  ["analysed", "analyzed"],
  ["travelling", "traveling"],
  ["manoeuvring", "maneuvering"],
  ["paediatric anaesthesia", "pediatric anesthesia"],
  ["driving licence", "driving license"],
  ["three storeys", "three stories"],
] as const;

Deno.test("filterRedundantBritishEnglishGlosses prefers American spelling", () => {
  const glosses = SPELLING_PAIRS.flatMap((
    [british, american],
  ) => [gloss(british), gloss(american)]);

  assertEquals(
    filterRedundantBritishEnglishGlosses(glosses).map(({ text }) => text),
    SPELLING_PAIRS.map(([, american]) => american),
  );
});

Deno.test("filterRedundantBritishEnglishGlosses requires an exact same-language counterpart", () => {
  const glosses = [
    gloss("colour"),
    gloss("a color"),
    gloss("behaviour", "ger"),
    gloss("behavior"),
  ];

  assertEquals(filterRedundantBritishEnglishGlosses(glosses), glosses);
});

Deno.test("renderEntry compares British and American spellings within each sense", () => {
  const word = {
    id: "9999999",
    kanji: [],
    kana: [],
    sense: [sense(["color", "colour"]), sense(["behavior"]), sense(["behaviour"])],
  } as Parameters<typeof renderEntry>[0];

  const html = renderEntry(word);
  assertEquals(html.match(/<li>color<\/li>/gu)?.length, 1);
  assertEquals(html.match(/<li>colour<\/li>/gu), null);
  assertEquals(html.match(/<li>behavior<\/li>/gu)?.length, 1);
  assertEquals(html.match(/<li>behaviour<\/li>/gu)?.length, 1);
});

const CORPUS_CASES = [
  ["1080510", "TV programme", "TV program"],
  ["1375040", "vigour", "vigor"],
  ["1424660", "centre", "center"],
  ["1485470", "aeroplane", "airplane"],
  ["1495000", "unsavoury", "unsavory"],
  ["1495000", "unskilful", "unskillful"],
  ["1495000", "unfavourable", "unfavorable"],
  ["1496680", "gynaecology", "gynecology"],
  ["1533460", "honour", "honor"],
] as const;

Deno.test("renderEntry removes redundant British spellings found in the checked-in corpus", async () => {
  const renderedEntries = new Map<string, string>();
  for (const [id] of CORPUS_CASES) {
    if (!renderedEntries.has(id)) {
      renderedEntries.set(id, renderEntry(await preextractedJMDictEntry(id)));
    }
  }

  for (const [id, british, american] of CORPUS_CASES) {
    const html = renderedEntries.get(id)!;
    assertEquals(html.includes(`<li>${british}</li>`), false);
    assertStringIncludes(html, `<li>${american}</li>`);
  }
});

Deno.test("renderEntry keeps corpus glosses that differ beyond British spelling", async () => {
  const html = renderEntry(await preextractedJMDictEntry("1584090"));

  assertStringIncludes(html, "<li>to harbour (suspicion, doubt, etc.)</li>");
  assertStringIncludes(html, "<li>to harbor</li>");
});

function gloss(text: string, lang = "eng"): Gloss {
  return { lang, gender: null, type: null, text };
}

function sense(glosses: string[]) {
  return {
    partOfSpeech: [],
    appliesToKanji: ["*"],
    appliesToKana: ["*"],
    related: [],
    antonym: [],
    field: [],
    dialect: [],
    misc: [],
    info: [],
    languageSource: [],
    gloss: glosses.map((text) => gloss(text)),
  };
}
