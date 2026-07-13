import * as path from "@std/path";
import type { JMDictFurigana } from "../../src/mod.ts";
import { resourcePaths } from "../../src/resource_paths.ts";

const dataDirectory = path.resolve(import.meta.dirname!, "../..");
const entriesDirectory = resourcePaths.preextractedJMDictEntries;
const fixturePath = path.join(dataDirectory, "test", "fixtures", "jmdict_furigana.json");

const entryIds = new Set<string>();
for await (const entry of Deno.readDir(entriesDirectory)) {
  if (entry.isFile && entry.name.endsWith(".json")) {
    entryIds.add(path.basename(entry.name, ".json"));
  }
}
if (entryIds.size === 0) throw new Error("No pre-extracted JMDict entries found");

const furigana = JSON.parse(
  await Deno.readTextFile(resourcePaths.jmdictFurigana),
) as JMDictFurigana;
const fixtureFurigana = Object.fromEntries(
  Object.entries(furigana).filter(([key]) => entryIds.has(key.slice(0, key.indexOf("|")))),
);

await Deno.writeTextFile(fixturePath, JSON.stringify(fixtureFurigana, undefined, 2) + "\n");

console.log(
  `Extracted ${Object.keys(fixtureFurigana).length} furigana records for the test fixture`,
);
