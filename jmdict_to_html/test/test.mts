import * as path from "@std/path";
import { assertSnapshot } from "@std/testing/snapshot";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";

import { renderEntry } from "../src/mod.mts";

for await (const dirEntry of Deno.readDir(path.resolve(import.meta.dirname!, "inputs"))) {
  const json = await Deno.readTextFile(path.resolve(import.meta.dirname!, "inputs", dirEntry.name));
  const word = JSON.parse(json) as JMdictWord;

  Deno.test(word.id, async (t) => {
    const html = renderEntry(word);
    await assertSnapshot(t, html);
  });
}
