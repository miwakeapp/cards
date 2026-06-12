/**
 * Sets up (or refreshes) the Miwake note type via AnkiConnect.
 *
 * - Fields (in order, with Key first for sorting/browsing):
 *   Key, Recognition target, Reading, Hint, Full context, Minimized context,
 *   Dictionary entry, Source, Source URL
 * - Templates match the current Anki model (furigana:Reading fallback).
 * - CSS = card chrome + current minimal.css (night-mode aware).
 *
 * Run with: deno task setup-miwake-model
 */

import { ac } from "../anki_connect.ts";

const MODEL_NAME = "Miwake";
const FIELDS = [
  "Key",
  "Recognition target",
  "Reading",
  "Hint",
  "Full context",
  "Minimized context",
  "Dictionary entry",
  "Source",
  "Source URL",
];
const FIELD_FONT_TARGETS = [
  "Key",
  "Recognition target",
  "Reading",
  "Hint",
  "Full context",
  "Minimized context",
  "Dictionary entry",
  "Source",
];
const FIELD_FONT_FAMILY = "Noto Serif JP";

const frontPath = new URL("./front.html", import.meta.url);
const backPath = new URL("./back.html", import.meta.url);
const stylesPrefixPath = new URL("./styles_prefix.css", import.meta.url);

const [front, back, stylesPrefix] = await Promise.all([
  Deno.readTextFile(frontPath),
  Deno.readTextFile(backPath),
  Deno.readTextFile(stylesPrefixPath),
]);

// Card-level styling: prefix for card chrome, then append shared minimal.css from disk.
const minimalCSSPath = new URL(
  "../../../html_dictionary_previewer/src/styles/minimal.css",
  import.meta.url,
);
const minimalCSS = await Deno.readTextFile(minimalCSSPath);

const combinedCSS = `${stylesPrefix}\n${minimalCSS}`;

const models: string[] = await ac("modelNames");
const exists = models.includes(MODEL_NAME);

if (exists) {
  throw new Error(
    `Model ${MODEL_NAME} already exists. Delete or rename it before running this script.`,
  );
}

console.log(`Creating model ${MODEL_NAME}...`);
await ac("createModel", {
  modelName: MODEL_NAME,
  inOrderFields: FIELDS,
  css: combinedCSS,
  cardTemplates: [
    {
      Name: "Miwake Card",
      Front: front,
      Back: back,
    },
  ],
});

// Ensure browser/editor font is set for core fields.
for (const field of FIELD_FONT_TARGETS) {
  await ac("modelFieldSetFont", {
    modelName: MODEL_NAME,
    fieldName: field,
    font: FIELD_FONT_FAMILY,
  });
}

console.log("Done.");
