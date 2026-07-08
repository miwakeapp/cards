import { assertEquals } from "@std/assert";
import { parseJMDictAssetName, parseJMDictHeader } from "../jmdict_download.ts";

Deno.test("parseJMDictAssetName: extracts version and dictionary date", () => {
  assertEquals(parseJMDictAssetName("jmdict-eng-3.6.2+20260706122413.json.zip"), {
    version: "3.6.2",
    dictDate: "2026-07-06",
  });
});

Deno.test("parseJMDictAssetName: rejects other assets", () => {
  assertEquals(parseJMDictAssetName("jmdict-all-3.6.2+20260706122413.json.zip"), null);
  assertEquals(parseJMDictAssetName("jmdict-eng-3.6.2.json.zip"), null);
  assertEquals(parseJMDictAssetName("checksums.txt"), null);
});

Deno.test("parseJMDictHeader: extracts the version header", () => {
  const head = `{
"version": "3.6.2",
"languages": ["eng"],
"commonOnly": false,
"dictDate": "2026-06-29",
"dictRevisions": ["1.09"],`;
  assertEquals(parseJMDictHeader(head), { version: "3.6.2", dictDate: "2026-06-29" });
});

Deno.test("parseJMDictHeader: null when fields are missing", () => {
  assertEquals(parseJMDictHeader('{"version": "3.6.2"}'), null);
  assertEquals(parseJMDictHeader(""), null);
});
