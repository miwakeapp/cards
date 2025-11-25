import * as path from "@std/path";
import type { JMdictWord } from "../../jmdict_to_html/src/mod.ts";

const packageRoot = path.resolve(import.meta.dirname!, "../../jmdict_to_html");
const inputsDir = path.resolve(packageRoot, "test/inputs");
const dataDir = path.resolve(import.meta.dirname!, "../src/data");
const outputFile = path.resolve(dataDir, "entries.json");

const entries: JMdictWord[] = [];

for await (const entry of Deno.readDir(inputsDir)) {
  if (!entry.isFile || !entry.name.endsWith(".json")) {
    continue;
  }

  const json = await Deno.readTextFile(path.resolve(inputsDir, entry.name));
  entries.push(JSON.parse(json));
}

entries.sort((a, b) => getSortKey(a).localeCompare(getSortKey(b), "ja"));

await Deno.mkdir(dataDir, { recursive: true });
await Deno.writeTextFile(outputFile, JSON.stringify(entries, null, 2) + "\n");

console.log(`Wrote ${entries.length} preview entries to ${path.relative(Deno.cwd(), outputFile)}`);

function getSortKey(word: JMdictWord): string {
  if (word.kanji.length > 0) {
    return word.kanji[0].text;
  }
  if (word.kana.length > 0) {
    return word.kana[0].text;
  }
  return word.id;
}
