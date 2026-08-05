/**
 * Creates the Miwake note type via AnkiConnect.
 *
 * - Fields (in order, with Key first for sorting/browsing):
 *   Key, Recognition target, Reading, Hint, Full context, Minimized context, Dictionary,
 *   Source
 * - Templates match the current Anki model (furigana:Reading fallback).
 * - CSS = card chrome + current minimal.css (night-mode aware).
 *
 * Run with: deno task --cwd card_model setup
 */

import * as path from "@std/path";
import { fieldOrder } from "card_model";
import { YankiConnect } from "yanki-connect";

const MODEL_NAME = "Miwake";
const FIELD_FONT_FAMILY = "Noto Serif JP";
const client = new YankiConnect();

const assetsDirectory = path.resolve(import.meta.dirname!, "../assets");
const frontPath = path.resolve(assetsDirectory, "front.html");
const backPath = path.resolve(assetsDirectory, "back.html");
const stylesPrefixPath = path.resolve(assetsDirectory, "styles_prefix.css");
const minimalCSSPath = path.resolve(assetsDirectory, "minimal.css");

const [front, back, stylesPrefix, minimalCSS] = await Promise.all([
  Deno.readTextFile(frontPath),
  Deno.readTextFile(backPath),
  Deno.readTextFile(stylesPrefixPath),
  Deno.readTextFile(minimalCSSPath),
]);

const combinedCSS = `${stylesPrefix}\n${minimalCSS}`;

const models = await client.model.modelNames();
const exists = models.includes(MODEL_NAME);

if (exists) {
  throw new Error(
    `Model ${MODEL_NAME} already exists. Delete or rename it before running this script.`,
  );
}

console.log(`Creating model ${MODEL_NAME}...`);
await client.model.createModel({
  modelName: MODEL_NAME,
  inOrderFields: [...fieldOrder],
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
for (const field of fieldOrder) {
  await client.model.modelFieldSetFont({
    modelName: MODEL_NAME,
    fieldName: field,
    font: FIELD_FONT_FAMILY,
  });
}

console.log("Done.");
