import * as path from "@std/path";

const input = path.resolve(import.meta.dirname!, "../src/jmdict_eng.json");
const output = path.resolve(import.meta.dirname!, "../src/jmdict_tags.json");

const text = await Deno.readTextFile(input);
const json = JSON.parse(text) as { tags: Record<string, string> };

await Deno.writeTextFile(output, JSON.stringify(json.tags, undefined, 2) + "\n");

console.log(`Wrote ${Object.keys(json.tags).length} tags to ${output}`);
