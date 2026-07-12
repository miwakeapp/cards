import * as path from "@std/path";
import type { JMDictWord } from "data";
import { renderEntry } from "jmdict_to_html";

const entriesDirectory = path.resolve(
  import.meta.dirname!,
  "../../data/preextracted_jmdict_entries",
);
const dataDir = path.resolve(import.meta.dirname!, "../src/data");
const outputFile = path.resolve(dataDir, "entries.json");

const entryFilenames: string[] = [];
for await (const entry of Deno.readDir(entriesDirectory)) {
  if (entry.isFile && entry.name.endsWith(".json")) entryFilenames.push(entry.name);
}
const words = await Promise.all(entryFilenames.map(async (filename) => {
  const json = await Deno.readTextFile(path.join(entriesDirectory, filename));
  return JSON.parse(json) as JMDictWord;
}));
words.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b), "ja"));

const entries = words.map((word) => ({
  id: word.id,
  primaryTerm: getSortKey(word),
  html: renderEntry(word),
}));

await Deno.mkdir(dataDir, { recursive: true });
await Deno.writeTextFile(outputFile, JSON.stringify(entries, undefined, 2) + "\n");

console.log(`Wrote ${entries.length} preview entries to ${path.relative(Deno.cwd(), outputFile)}`);

function getSortKey(word: JMDictWord): string {
  if (word.kanji.length > 0) {
    return word.kanji[0].text;
  }
  if (word.kana.length > 0) {
    return word.kana[0].text;
  }
  return word.id;
}
