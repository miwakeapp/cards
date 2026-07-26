import * as path from "@std/path";
import type { JMDictWord } from "data";
import { renderEntry } from "jmdict_to_html";
import { fixtureDefinitions, type PreviewFixture } from "../src/fixtures.ts";

const entriesDirectory = path.resolve(
  import.meta.dirname!,
  "../../data/resources/jmdict/entries",
);
const dataDirectory = path.resolve(import.meta.dirname!, "../build/data");
const outputFile = path.resolve(dataDirectory, "fixtures.json");

const fixtures: PreviewFixture[] = await Promise.all(
  fixtureDefinitions.map(async (fixture) => {
    const entryFilename = path.join(entriesDirectory, `${fixture.id}.json`);
    const json = await Deno.readTextFile(entryFilename);
    const word = JSON.parse(json) as JMDictWord;

    return {
      ...fixture,
      primaryTerm: getPrimaryTerm(word),
      fields: {
        ...fixture.fields,
        "Dictionary entry": renderEntry(word),
      },
    };
  }),
);

await Deno.mkdir(dataDirectory, { recursive: true });
await Deno.writeTextFile(outputFile, JSON.stringify(fixtures, undefined, 2) + "\n");

console.log(
  `Wrote ${fixtures.length} shared preview fixtures to ${path.relative(Deno.cwd(), outputFile)}`,
);

function getPrimaryTerm(word: JMDictWord): string {
  if (word.kanji.length > 0) {
    return word.kanji[0].text;
  }
  if (word.kana.length > 0) {
    return word.kana[0].text;
  }
  return word.id;
}
