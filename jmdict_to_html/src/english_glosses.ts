import type { JMdictSense } from "@scriptin/jmdict-simplified-types";

type Gloss = JMdictSense["gloss"][number];

type SpellingFamily = readonly [
  britishStem: string,
  americanStem: string,
  suffixes: readonly string[],
];

// These fragments remain recognizable throughout their ordinary inflections and compounds. The
// exact-American-counterpart check in `filterRedundantBritishEnglishGlosses()` prevents a British
// spelling from being removed merely because it can be converted.
const BRITISH_TO_AMERICAN_FRAGMENTS: readonly (readonly [string, string])[] = [
  ["acknowledgement", "acknowledgment"],
  ["aeroplane", "airplane"],
  ["aluminium", "aluminum"],
  ["anaem", "anem"],
  ["anaesth", "anesth"],
  ["archae", "arche"],
  ["arbour", "arbor"],
  ["ardour", "ardor"],
  ["armour", "armor"],
  ["artefact", "artifact"],
  ["behaviour", "behavior"],
  ["candour", "candor"],
  ["clamour", "clamor"],
  ["colour", "color"],
  ["demeanour", "demeanor"],
  ["diarrhoe", "diarrhe"],
  ["endeavour", "endeavor"],
  ["encyclopaed", "encycloped"],
  ["enamour", "enamor"],
  ["faec", "fec"],
  ["favour", "favor"],
  ["fervour", "fervor"],
  ["flavour", "flavor"],
  ["foet", "fet"],
  ["gynaec", "gynec"],
  ["haem", "hem"],
  ["harbour", "harbor"],
  ["honour", "honor"],
  ["humour", "humor"],
  ["judgement", "judgment"],
  ["labour", "labor"],
  ["leukaem", "leukem"],
  ["mould", "mold"],
  ["neighbour", "neighbor"],
  ["odour", "odor"],
  ["oedem", "edem"],
  ["oesophag", "esophag"],
  ["oestrogen", "estrogen"],
  ["orthopaed", "orthoped"],
  ["paed", "ped"],
  ["palae", "pale"],
  ["parlour", "parlor"],
  ["plough", "plow"],
  ["rancour", "rancor"],
  ["rigour", "rigor"],
  ["rumour", "rumor"],
  ["savour", "savor"],
  ["saviour", "savior"],
  ["sceptic", "skeptic"],
  ["smoulder", "smolder"],
  ["splendour", "splendor"],
  ["succour", "succor"],
  ["sulph", "sulf"],
  ["tumour", "tumor"],
  ["valour", "valor"],
  ["vapour", "vapor"],
  ["vigour", "vigor"],
];

const BRITISH_TO_AMERICAN_FAMILIES: readonly SpellingFamily[] = [
  ["age", "ag", ["ing"]],
  ["appal", "appall", ["", "s"]],
  ["axe", "ax", [""]],
  ["catalogue", "catalog", ["", "s"]],
  ["catalogu", "catalog", ["ed", "ing"]],
  ["cheque", "check", ["", "s", "book", "books"]],
  ["cosy", "cozy", [""]],
  ["cosi", "cozi", ["er", "est", "ly", "ness"]],
  ["defenc", "defens", ["e", "es", "eless", "elessness"]],
  ["distil", "distill", ["", "s"]],
  ["draught", "draft", ["", "s", "ed", "ing"]],
  ["enrol", "enroll", ["", "s", "ment", "ments"]],
  ["enthral", "enthrall", ["", "s"]],
  ["fulfil", "fulfill", ["", "s", "ment", "ments"]],
  ["gaol", "jail", ["", "s", "er", "ers"]],
  ["grey", "gray", ["", "s", "er", "est", "ish", "ness"]],
  ["instal", "install", ["", "s", "ment", "ments"]],
  ["instil", "instill", ["", "s"]],
  ["jewellery", "jewelry", [""]],
  ["kerb", "curb", ["", "s", "side", "sides"]],
  ["licenc", "licens", ["e", "es", "ed", "ing"]],
  ["manoeuvre", "maneuver", ["", "s"]],
  ["manoeuvr", "maneuver", ["ed", "ing"]],
  ["mollusc", "mollusk", ["", "s"]],
  ["moustache", "mustache", ["", "s", "d"]],
  ["offenc", "offens", ["e", "es", "eless", "elessness"]],
  ["omelette", "omelet", ["", "s"]],
  ["practis", "practic", ["e", "es", "ed", "ing"]],
  ["pretenc", "pretens", ["e", "es"]],
  ["programme", "program", ["", "s"]],
  ["pyjama", "pajama", ["", "s"]],
  ["skilful", "skillful", ["", "ly", "ness"]],
  ["storey", "story", [""]],
  ["storeys", "stories", [""]],
  ["tyre", "tire", ["", "s"]],
  ["wilful", "willful", ["", "ly", "ness"]],
  ["woollen", "woolen", [""]],
  ["yoghurt", "yogurt", ["", "s"]],

  ["calibre", "caliber", ["", "s"]],
  ["centre", "center", ["", "s"]],
  ["centr", "center", ["ed", "ing"]],
  ["fibre", "fiber", ["", "s"]],
  ["litre", "liter", ["", "s"]],
  ["lustre", "luster", ["", "s"]],
  ["meagre", "meager", [""]],
  ["metre", "meter", ["", "s"]],
  ["ochre", "ocher", [""]],
  ["sabre", "saber", ["", "s"]],
  ["sceptre", "scepter", ["", "s"]],
  ["sombre", "somber", [""]],
  ["spectre", "specter", ["", "s"]],
  ["theatre", "theater", ["", "s"]],

  ["cancell", "cancel", ["ed", "ing"]],
  ["counsell", "counsel", ["ed", "ing", "or", "ors"]],
  ["diall", "dial", ["ed", "ing"]],
  ["fuell", "fuel", ["ed", "ing"]],
  ["jewell", "jewel", ["ed", "er", "ers", "ing"]],
  ["labell", "label", ["ed", "er", "ers", "ing"]],
  ["levell", "level", ["ed", "er", "ers", "ing"]],
  ["marvell", "marvel", ["ed", "ing", "ous"]],
  ["modell", "model", ["ed", "er", "ers", "ing"]],
  ["quarrell", "quarrel", ["ed", "ing"]],
  ["signall", "signal", ["ed", "er", "ers", "ing"]],
  ["totall", "total", ["ed", "ing"]],
  ["travell", "travel", ["ed", "er", "ers", "ing"]],
  ["worshipp", "worship", ["ed", "er", "ers", "ing"]],
];

const BRITISH_S_TO_AMERICAN_Z_ROOTS = [
  "agon",
  "apolog",
  "author",
  "bapt",
  "brutal",
  "canon",
  "capital",
  "categor",
  "central",
  "character",
  "civil",
  "colon",
  "computer",
  "conceptual",
  "contextual",
  "critic",
  "crystall",
  "custom",
  "decentral",
  "democrat",
  "destabil",
  "digit",
  "dramat",
  "econom",
  "emphas",
  "equal",
  "familiar",
  "fertil",
  "final",
  "formal",
  "fossil",
  "general",
  "harmon",
  "hospital",
  "ideal",
  "idol",
  "immobil",
  "individual",
  "industrial",
  "initial",
  "item",
  "legal",
  "liberal",
  "local",
  "material",
  "maxim",
  "mechan",
  "memor",
  "minim",
  "mobil",
  "modern",
  "natural",
  "neutral",
  "normal",
  "optim",
  "organ",
  "personal",
  "popular",
  "priorit",
  "privat",
  "public",
  "random",
  "rational",
  "real",
  "recogn",
  "regular",
  "satir",
  "social",
  "special",
  "stabil",
  "standard",
  "steril",
  "stigmat",
  "summar",
  "symbol",
  "sympath",
  "synchron",
  "systemat",
  "terror",
  "theor",
  "trivial",
  "union",
  "urban",
  "util",
  "visual",
  "vocal",
] as const;

const S_TO_Z_SUFFIXES = [
  "ation",
  "ational",
  "ationally",
  "ations",
  "e",
  "ed",
  "er",
  "ers",
  "es",
  "ing",
] as const;

const ENDING_REPLACEMENTS = [
  ...BRITISH_TO_AMERICAN_FAMILIES.flatMap(([britishStem, americanStem, suffixes]) =>
    suffixes.map((suffix) => [britishStem + suffix, americanStem + suffix] as const)
  ),
  ...BRITISH_S_TO_AMERICAN_Z_ROOTS.flatMap((root) =>
    S_TO_Z_SUFFIXES.map((suffix) => [`${root}is${suffix}`, `${root}iz${suffix}`] as const)
  ),
  ...["analyse", "analysed", "analyses", "analysing"].map((british) =>
    [british, british.replace("analys", "analyz")] as const
  ),
  ...["catalyse", "catalysed", "catalyses", "catalysing"].map((british) =>
    [british, british.replace("catalys", "catalyz")] as const
  ),
  ...["paralyse", "paralysed", "paralyses", "paralysing"].map((british) =>
    [british, british.replace("paralys", "paralyz")] as const
  ),
].sort(([left], [right]) => right.length - left.length);

/** Removes British-spelled English glosses only when the same sense has an American equivalent. */
export function filterRedundantBritishEnglishGlosses(glosses: Gloss[]): Gloss[] {
  const americanized = glosses.map((gloss) =>
    gloss.lang === "eng" ? americanizeBritishSpelling(gloss.text) : undefined
  );
  const unchangedEnglishGlosses = new Set(
    glosses.flatMap((gloss, index) => {
      const result = americanized[index];
      return gloss.lang === "eng" && result?.changed === false ? [result.text] : [];
    }),
  );

  return glosses.filter((gloss, index) => {
    if (gloss.lang !== "eng") {
      return true;
    }
    const result = americanized[index]!;
    return !result.changed || !unchangedEnglishGlosses.has(result.text);
  });
}

function americanizeBritishSpelling(text: string): { text: string; changed: boolean } {
  let changed = false;
  const americanized = text.replace(/[A-Za-z]+/gu, (word) => {
    const replacement = americanizeBritishWord(word.toLowerCase());
    if (replacement === word.toLowerCase()) {
      return word;
    }
    changed = true;
    return matchCapitalization(word, replacement);
  });
  return { text: americanized, changed };
}

function americanizeBritishWord(word: string): string {
  let result = word;
  for (const [british, american] of BRITISH_TO_AMERICAN_FRAGMENTS) {
    result = result.replaceAll(british, american);
  }
  for (const [british, american] of ENDING_REPLACEMENTS) {
    if (result.endsWith(british)) {
      return result.slice(0, -british.length) + american;
    }
  }
  return result;
}

function matchCapitalization(source: string, replacement: string): string {
  if (source === source.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
