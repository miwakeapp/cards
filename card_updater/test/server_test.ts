import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertMatch } from "@std/assert";
import { renderDictionaryField } from "card_model/dictionary";
import { preextractedJMDictEntry } from "data";
import { analyzeCard } from "../src/analyze.ts";
import { validateResultingReading } from "../src/server.ts";
import { entriesById, makeNote } from "./fixtures.ts";

async function alternateNameCard() {
  const entry = await preextractedJMDictEntry("1158110");
  const card = await analyzeCard(
    makeNote({
      key: "異名 | 1158110:1",
      reading: "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
      dictionary: renderDictionaryField([entry]),
    }),
    entriesById(entry),
  );
  return { card, entries: new Map([[entry.id, entry]]) };
}

Deno.test("validateResultingReading canonicalizes accepted reading order", async () => {
  const { card, entries } = await alternateNameCard();
  const result = await validateResultingReading(
    card,
    "異名 | 1158110:1",
    "<ul><li>異[い] 名[めい]</li><li>異[い] 名[みょう]</li></ul>",
    entries,
  );

  assertEquals(result, {
    reading: "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
  });
});

Deno.test("validateResultingReading rejects readings invalidated by a retarget", async () => {
  const { card, entries } = await alternateNameCard();
  const result = await validateResultingReading(
    card,
    "異名 | 1158110:2",
    "<ul><li>異[い] 名[みょう]</li><li>異[い] 名[めい]</li></ul>",
    entries,
  );

  if (!("error" in result)) throw new Error("Expected validation failure");
  assertMatch(result.error, /いみょう/u);
});

Deno.test("validateResultingReading rejects an invalid custom Recognition target reading", async () => {
  const entry = await preextractedJMDictEntry("1158110");
  const reading = "その 異[い] 名[みょう]";
  const card = await analyzeCard(
    makeNote({
      key: "異名 | 1158110:1",
      recognitionTarget: "その異名",
      reading,
      dictionary: renderDictionaryField([entry]),
    }),
    entriesById(entry),
  );
  const result = await validateResultingReading(
    card,
    "異名 | 1158110:2",
    reading,
    new Map([[entry.id, entry]]),
  );

  if (!("error" in result)) throw new Error("Expected validation failure");
  assertMatch(result.error, /いみょう/u);
});
