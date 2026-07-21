// Updates the generated furigana lookup only when the mutable upstream resource changes.
//
// Run with:
//   deno task download:furigana
//   deno task download:furigana --force
//   deno task download:furigana --accept-large-change

import { parseArgs } from "@std/cli/parse-args";
import { ensureLatestFurigana } from "../../src/furigana_download.ts";

const args = parseArgs(Deno.args, {
  boolean: ["force", "accept-large-change"],
});

const result = await ensureLatestFurigana({
  force: args.force,
  acceptLargeChange: args["accept-large-change"],
});
console.log(`Furigana ${result.action} (${result.current.entryCount} records).`);
