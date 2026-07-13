import { resourcePaths } from "../../src/resource_paths.ts";

const input = resourcePaths.jmdict;
const output = resourcePaths.jmdictTags;

const text = await Deno.readTextFile(input);
const json = JSON.parse(text) as { tags: Record<string, string> };

await Deno.writeTextFile(output, JSON.stringify(json.tags, undefined, 2) + "\n");

console.log(`Wrote ${Object.keys(json.tags).length} tags to ${output}`);
