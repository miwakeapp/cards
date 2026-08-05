import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals } from "@std/assert";
import { renderDictionaryField, splitDictionaryField } from "card_model/dictionary";
import { parseKey } from "card_model/keys";
import { preextractedJMDictEntry } from "data";
import { renderEntry } from "jmdict_to_html";

Deno.test("dictionary field composition round-trips multiple entries", async () => {
  const primary = await preextractedJMDictEntry("1645430");
  const equivalent = await preextractedJMDictEntry("2863046");
  const parsedKey = parseKey("生業 | 1645430;2863046")!;
  const html = renderDictionaryField([primary, equivalent]);
  const parts = splitDictionaryField(html, parsedKey)!;

  assertEquals([...parts.keys()], [primary.id, equivalent.id]);
  assertEquals(parts.get(primary.id)?.includes("なりわい"), true);
  assertEquals(parts.get(equivalent.id)?.includes("すぎわい"), true);
});

Deno.test("dictionary field composition wraps single entries", async () => {
  const primary = await preextractedJMDictEntry("1645430");
  const parsedKey = parseKey("生業 | 1645430")!;
  const html = renderDictionaryField([primary]);

  assertEquals(splitDictionaryField(html, parsedKey)?.get(primary.id), renderEntry(primary));
});

Deno.test("dictionary field splitting rejects an incomplete multi-entry field", async () => {
  const primary = await preextractedJMDictEntry("1645430");
  const parsedKey = parseKey("生業 | 1645430;2863046")!;
  assertEquals(splitDictionaryField(renderDictionaryField([primary]), parsedKey), null);
});

Deno.test("dictionary field splitting requires a canonical Key", () => {
  assertEquals(parseKey("生業 | 2863046;1645430"), null);
});
