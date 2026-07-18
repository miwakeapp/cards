import * as path from "@std/path";
import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { resourcePaths } from "../../src/resource_paths.ts";
import { importFurigana } from "./furigana_import.ts";

const furiganaURL = "https://jisho.hlorenzi.com/furigana.txt";
const outputFilename = resourcePaths.jmdictFurigana;
const temporaryFilename = `${outputFilename}.download`;

console.log(`Downloading from: ${furiganaURL}`);

const response = await fetch(furiganaURL);
if (!response.ok) {
  throw new Error(`Failed to download: ${response.statusText}`);
}

// Stream the response to handle large file
let text = "";
let charactersRead = 0;

let lastLogTime = Date.now();
for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
  charactersRead += chunk.length;
  text += chunk;
  if (Date.now() - lastLogTime > 1000) {
    lastLogTime = Date.now();
    console.log(`Downloaded ${charactersRead} characters...`);
  }
}

console.log(`Downloaded ${charactersRead} characters. Processing...`);

const jmdict = JSON.parse(await Deno.readTextFile(resourcePaths.jmdict)) as JMdict;
const { data: furiganaData, stats } = importFurigana(text, jmdict.words);
console.log(
  `Imported ${stats.sourceRows} source rows and derived ` +
    `${stats.derivedSearchOnlyKanjiRows} search-only kanji rows; ` +
    `${stats.unresolvedSearchOnlyKanjiRows} could not be transferred safely.`,
);
if (stats.sourceRows < 500_000) {
  throw new Error(`Implausible furigana data: imported only ${stats.sourceRows} source rows`);
}

const json = JSON.stringify(furiganaData);
await Deno.mkdir(path.dirname(outputFilename), { recursive: true });
await Deno.writeTextFile(temporaryFilename, json);
await Deno.rename(temporaryFilename, outputFilename);

console.log(`Saved to ${outputFilename} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
