import { assertNotEquals } from "@std/assert";
import { renderEntry } from "jmdict_to_html";
import { analyzeCard } from "../src/analyze.ts";
import { cardFingerprint } from "../src/state.ts";
import { makeNote, makeWord } from "./fixtures.ts";

Deno.test("cardFingerprint changes with the user-editable Recognition target", async () => {
  const word = makeWord({
    senses: [{ glosses: ["word"] }],
  });
  const dictionaryEntry = renderEntry(word);
  const plain = await analyzeCard(
    makeNote({
      key: "言葉 | 1000000",
      recognitionTarget: "言葉",
      dictionaryEntry,
    }),
    word,
  );
  const edited = await analyzeCard(
    makeNote({
      key: "言葉 | 1000000",
      recognitionTarget: "～言葉",
      dictionaryEntry,
    }),
    word,
  );

  assertNotEquals(await cardFingerprint(plain), await cardFingerprint(edited));
});
