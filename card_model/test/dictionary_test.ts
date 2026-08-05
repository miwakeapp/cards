import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertThrows } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { renderEntry } from "jmdict_to_html";
import { renderDictionaryField } from "card_model/dictionary";

Deno.test("renderDictionaryField wraps a single entry", async () => {
  const entry = await preextractedJMDictEntry("1645430");
  assertEquals(
    renderDictionaryField([entry]),
    `<div class="miwake-dictionary-entry">\n${
      renderEntry(entry).split("\n").map((line) => `  ${line}`).join("\n")
    }\n</div>`,
  );
});

Deno.test("renderDictionaryField orders each entry in a multi-entry card", async () => {
  const lowerId = await preextractedJMDictEntry("1645430");
  const higherId = await preextractedJMDictEntry("2863046");
  const html = renderDictionaryField([higherId, lowerId]);

  assertEquals(html.match(/class="miwake-dictionary-entry"/g)?.length, 2);
  assertEquals(html.indexOf("なりわい") < html.indexOf("すぎわい"), true);
});

Deno.test("renderDictionaryField rejects missing or repeated entries", async () => {
  const entry = await preextractedJMDictEntry("1645430");
  assertThrows(() => renderDictionaryField([]), Error, "at least one");
  assertThrows(() => renderDictionaryField([entry, entry]), Error, "repeat");
});
