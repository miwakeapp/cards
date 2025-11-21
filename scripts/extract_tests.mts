import * as path from "@std/path";
import type { JMdict } from "@scriptin/jmdict-simplified-types";

const jmdictFilename = path.resolve(import.meta.dirname!, "../src/jmdict_eng.json");
const testInputsDir = path.resolve(import.meta.dirname!, "../test/inputs");

const testIds = new Set([
  "2030540", // 狂喜乱舞, simple entry
  "1414110", // 大小, one reading, multiple senses, per-sense tags
  "1590470", // 画期的, multiple readings, one sense
]);

const jmdictText = await Deno.readTextFile(jmdictFilename);
const jmdict = JSON.parse(jmdictText) as JMdict;

const promises: Promise<void>[] = [];
const foundIds = new Set<string>();
for (const word of jmdict.words) {
  if (testIds.has(word.id)) {
    const filename = path.resolve(testInputsDir, `${word.id}.json`);
    const contents = JSON.stringify(word, undefined, 2) + "\n";
    promises.push(Deno.writeTextFile(filename, contents));
    foundIds.add(word.id);
  }
}

if (promises.length !== testIds.size) {
  throw new Error(
    "Some test IDs were not found in the downloaded JMdict:" +
      [...testIds.difference(foundIds)].join(", "),
  );
}
await Promise.all(promises);

console.log(`Extracted ${promises.length} test entries to ${testInputsDir}`);
