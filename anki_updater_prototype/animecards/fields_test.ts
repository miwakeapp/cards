import { assertEquals, assertThrows } from "@std/assert";
import { resolveSourceFields } from "./fields.ts";

Deno.test("resolveSourceFields recognizes standard and alternate Animecards fields", () => {
  assertEquals(
    resolveSourceFields([
      "Expression",
      "Context",
      "Definition",
      "Reading",
      "Source",
      "Source URL",
    ]),
    {
      word: "Expression",
      sentence: "Context",
      glossary: "Definition",
      reading: "Reading",
      source: "Source",
      sourceURL: "Source URL",
    },
  );
});

Deno.test("resolveSourceFields recognizes the live Recognition target field", () => {
  assertEquals(
    resolveSourceFields(["Recognition target", "Sentence"]),
    {
      word: "Recognition target",
      sentence: "Sentence",
      glossary: null,
      reading: null,
      source: null,
      sourceURL: null,
    },
  );
});

Deno.test("resolveSourceFields validates explicit field overrides", () => {
  assertThrows(
    () => resolveSourceFields(["Word", "Sentence"], { glossary: "Missing" }),
    Error,
    'The glossary field "Missing" does not exist',
  );
});
