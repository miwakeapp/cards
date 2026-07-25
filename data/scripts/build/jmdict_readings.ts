import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { buildJMDictReadings } from "../../src/jmdict_readings.ts";
import { resourcePaths } from "../../src/resource_paths.ts";

const jmdict = JSON.parse(await Deno.readTextFile(resourcePaths.jmdict)) as JMdict;
const readings = buildJMDictReadings(jmdict.words);
await Deno.writeTextFile(
  resourcePaths.jmdictReadings,
  JSON.stringify(readings, undefined, 2) + "\n",
);

console.log(`Indexed readings for ${Object.keys(readings).length} JMDict spellings`);
