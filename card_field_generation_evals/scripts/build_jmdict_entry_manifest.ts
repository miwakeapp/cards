/** Regenerates the JMDict-entry manifest consumed by the shared data fixture builder. */

import * as path from "@std/path";
import { jmdictEntryIdsForEvalFixtures, loadEvalFixtures } from "../src/fixtures.ts";

const packageDirectory = path.resolve(import.meta.dirname!, "..");
const outputPath = path.join(
  packageDirectory,
  "../data/resources/jmdict/card_field_generation_eval_entry_ids.json",
);
const ids = jmdictEntryIdsForEvalFixtures(await loadEvalFixtures());

await Deno.mkdir(path.dirname(outputPath), { recursive: true });
await Deno.writeTextFile(outputPath, `${JSON.stringify(ids, undefined, 2)}\n`);
console.log(`Wrote ${ids.length} JMDict entry IDs to ${outputPath}`);
