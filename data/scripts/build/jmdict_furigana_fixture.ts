import * as path from "@std/path";
import type { FuriganaData } from "../../src/furigana_import.ts";
import { resourcePaths } from "../../src/resource_paths.ts";

const dataDirectory = path.resolve(import.meta.dirname!, "../..");
const entriesDirectory = resourcePaths.preextractedJMDictEntries;
const fixturePath = path.join(dataDirectory, "test", "fixtures", "jmdict_furigana.json");

// Keep one known-good upstream record out of the fixture so `card_creator` can test how it handles
// genuinely unavailable placement data without depending on an accidental upstream omission.
const OMITTED_KEYS = new Set([
  "1205330|恰好悪い|かっこわるい",
]);

const entryIds = new Set<string>();
for await (const entry of Deno.readDir(entriesDirectory)) {
  if (entry.isFile && entry.name.endsWith(".json")) {
    entryIds.add(path.basename(entry.name, ".json"));
  }
}
if (entryIds.size === 0) throw new Error("No pre-extracted JMDict entries found");

const furigana = JSON.parse(
  await Deno.readTextFile(resourcePaths.jmdictFurigana),
) as FuriganaData;
for (const key of OMITTED_KEYS) {
  if (!(key in furigana)) {
    throw new Error(
      `Furigana record deliberately omitted from the test fixture is unavailable: ${key}`,
    );
  }
}
const fixtureFurigana = Object.fromEntries(
  Object.entries(furigana).filter(([key]) =>
    entryIds.has(key.slice(0, key.indexOf("|"))) && !OMITTED_KEYS.has(key)
  ),
);

await Deno.writeTextFile(fixturePath, JSON.stringify(fixtureFurigana, undefined, 2) + "\n");

console.log(
  `Extracted ${Object.keys(fixtureFurigana).length} furigana records for the test fixture`,
);
