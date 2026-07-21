// Updates `jmdict_eng.json` to the latest jmdict-simplified release, skipping the download
// when the local copy is already current.
//
// Run with:
//   deno task download:jmdict
//   deno task download:jmdict --force

import { parseArgs } from "@std/cli/parse-args";
import { ensureLatestJMDict } from "../../src/jmdict_download.ts";

const args = parseArgs(Deno.args, {
  boolean: ["force"],
});

const result = await ensureLatestJMDict({ force: args.force });
console.log(`JMDict ${result.action} (${result.current.version}, ${result.current.dictDate}).`);
