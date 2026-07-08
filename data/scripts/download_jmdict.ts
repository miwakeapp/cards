// Updates `jmdict_eng.json` to the latest jmdict-simplified release, skipping the download
// when the local copy is already current.
//
// Run with:
//   deno task download_jmdict
//   deno task download_jmdict -- --force

import { ensureLatestJMDict } from "../jmdict_download.ts";

let force = false;
for (const arg of Deno.args) {
  if (arg === "--") {
    continue;
  } else if (arg === "--force") {
    force = true;
  } else {
    console.error(`Unknown argument: ${arg}`);
    Deno.exit(1);
  }
}

await ensureLatestJMDict({ force, log: (message) => console.log(message) });
