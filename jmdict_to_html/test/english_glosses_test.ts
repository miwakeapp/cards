import { assertEquals, assertStringIncludes } from "@std/assert";
import type { JMdictGloss } from "@scriptin/jmdict-simplified-types";
import { preextractedJMDictEntry } from "data";

import { filterRedundantBritishEnglishGlosses } from "../src/english_glosses.ts";
import { renderEntry } from "../src/mod.ts";

const SPELLING_PAIRS = [
  ["favourite colour", "favorite color"],
  ["accessorised", "accessorized"],
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

Deno.test("filterRedundantBritishEnglishGlosses removes adjacent parenthetical spelling aliases", () => {
  const cases = [
    ["laborer (labourer)", "laborer"],
    ["casual laborer (labourer)", "casual laborer"],
    ["inner center (centre)", "inner center"],
    ["imprisonment with hard labor (hard labour)", "imprisonment with hard labor"],
    ["to grow dull in color (colour)", "to grow dull in color"],
    ["to apologize (apologise) to someone", "to apologize to someone"],
    ["color (colour), flavor (flavour)", "color, flavor"],
    ["color (colour) (colour)", "color"],
    ["paint (a bright color (colour))", "paint (a bright color)"],
  ];
  const input = cases.map(([before]) => gloss(before));
  const snapshot = structuredClone(input);
  const result = filterRedundantBritishEnglishGlosses(input);
  assertEquals(result.map(({ text }) => text), cases.map(([, after]) => after));
  assertEquals(input, snapshot);
  assertEquals(filterRedundantBritishEnglishGlosses(result), result);
});

Deno.test("filterRedundantBritishEnglishGlosses preserves explanations and nonadjacent variants", () => {
  const input = [
    "bright (colour)",
    "to harbor (suspicion, doubt, etc.)",
    "color (colour of the sea)",
    "orange (colour, color of the peel)",
    "to lower one's center of gravity (centre)",
    "discolor (colour)",
    "watercolor (colour)",
    "color (colour)ful",
    "colour (colour)",
    "colour (color)",
    "color (color)",
  ].map((text) => gloss(text));
  input.push({ ...gloss("laborer (labourer)", "ger"), type: "literal" });
  for (const candidate of input) {
    assertEquals(filterRedundantBritishEnglishGlosses([candidate]), [candidate]);
  }
});

Deno.test("filterRedundantBritishEnglishGlosses removes exact duplicates in parenthetical lists", () => {
  const cases = [
    ["orange (color, colour)", "orange (color)"],
    ["orange (colour, color)", "orange (color)"],
    ["orange (color,colour)", "orange (color)"],
    ["orange(color,colour)", "orange(color)"],
    ["(color, colour) gradation", "(color) gradation"],
    [
      "to become confused (disconcerted, disorganized, disorganised)",
      "to become confused (disconcerted, disorganized)",
    ],
    ["paint (color, colour, flavor, flavour)", "paint (color, flavor)"],
    ["paint (color, colour, etc.)", "paint (color, etc.)"],
    ["paint (bright colour, bright color)", "paint (bright color)"],
    ["shade (of colour, color)", "shade (of colour, color)"],
    ["program (e.g. theatre, theater)", "program (e.g. theatre, theater)"],
    ["colour (color, color)", "colour (color, color)"],
  ];
  for (const [before, after] of cases) {
    const input = [gloss(before)];
    const output = filterRedundantBritishEnglishGlosses(input);
    assertEquals(output, [gloss(after)]);
    assertEquals(filterRedundantBritishEnglishGlosses(output), output);
    assertEquals(input, [gloss(before)]);
    const nonEnglish = [gloss(before, "ger")];
    assertEquals(filterRedundantBritishEnglishGlosses(nonEnglish), nonEnglish);
  }
});

Deno.test("filterRedundantBritishEnglishGlosses compares separate glosses after parentheses", () => {
  const input: JMdictGloss[] = [
    gloss("casual labourer"),
    { ...gloss("casual laborer (labourer)"), type: "literal" },
  ];
  assertEquals(filterRedundantBritishEnglishGlosses(input), [{
    ...input[1],
    text: "casual laborer",
  }]);
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

function gloss(text: string, lang = "eng"): JMdictGloss {
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
