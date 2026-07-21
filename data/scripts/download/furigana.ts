// Updates the generated furigana lookup only when the mutable upstream resource changes.
//
// Run with:
//   deno task download:furigana
//   deno task download:furigana --force
//   deno task download:furigana --accept-large-change

import { ensureLatestFurigana } from "../../src/furigana_download.ts";

let force = false;
let acceptLargeChange = false;
for (const arg of Deno.args) {
  if (arg === "--force") {
    force = true;
  } else if (arg === "--accept-large-change") {
    acceptLargeChange = true;
  } else {
    console.error(`Unknown argument: ${arg}`);
    Deno.exit(1);
  }
}

const result = await ensureLatestFurigana({
  force,
  acceptLargeChange,
});
console.log(`Furigana ${result.action} (${result.current.entryCount} records).`);
