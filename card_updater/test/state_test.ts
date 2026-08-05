import "../../data/test/use_jmdict_fixtures.ts";

import { assertNotEquals } from "@std/assert";
import { renderDictionaryField } from "card_model/dictionary";
import { analyzeCard } from "../src/analyze.ts";
import { cardFingerprint } from "../src/state.ts";
import { entriesById, makeNote, makeWord } from "./fixtures.ts";

Deno.test("cardFingerprint changes with the user-editable Recognition target", async () => {
  const word = makeWord({
    senses: [{ glosses: ["word"] }],
  });
  const dictionary = renderDictionaryField([word]);
  const plain = await analyzeCard(
    makeNote({
      key: "言葉 | 1000000",
      recognitionTarget: "言葉",
      dictionary,
    }),
    entriesById(word),
  );
  const edited = await analyzeCard(
    makeNote({
      key: "言葉 | 1000000",
      recognitionTarget: "～言葉",
      dictionary,
    }),
    entriesById(word),
  );

  assertNotEquals(await cardFingerprint(plain), await cardFingerprint(edited));
});
