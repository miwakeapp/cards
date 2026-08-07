import "../../data/test/use_jmdict_fixtures.ts";

import { assertEquals, assertMatch } from "@std/assert";
import { renderDictionaryField } from "card_model/dictionary";
import { preextractedJMDictEntry } from "data";
import { analyzeCard } from "../src/analyze.ts";
import { flagDuplicateRecognitionUnits } from "../src/duplicate_keys.ts";
import {
  duplicateExceptionContext,
  invalidReadingExceptionContext,
  validateResultingReading,
} from "../src/server.ts";
import { entriesById, makeNote, makeWord } from "./fixtures.ts";

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

Deno.test("invalidReadingExceptionContext distinguishes missing and restricted readings", async () => {
  const missingWord = makeWord({
    kanji: ["円盾"],
    kana: ["えんじゅん"],
    senses: [{ glosses: ["round shield"] }],
  });
  const missingCard = await analyzeCard(
    makeNote({
      key: "円盾 | 1000000",
      reading: "円盾[バックラー]",
      dictionary: renderDictionaryField([missingWord]),
    }),
    entriesById(missingWord),
  );
  assertEquals(invalidReadingExceptionContext(missingCard, entriesById(missingWord)), {
    kind: "reading-no-match",
    reading: "円盾[バックラー]",
    kanaReading: "バックラー",
  });

  const restrictedWord = makeWord({
    kanji: ["糞"],
    kana: ["ふん", "フン"],
    senses: [{ glosses: ["dung"] }],
  });
  restrictedWord.kana[1].appliesToKanji = [];
  const restrictedCard = await analyzeCard(
    makeNote({
      key: "糞 | 1000000",
      reading: "糞[フン]",
      dictionary: renderDictionaryField([restrictedWord]),
    }),
    entriesById(restrictedWord),
  );
  assertEquals(invalidReadingExceptionContext(restrictedCard, entriesById(restrictedWord)), {
    kind: "reading-not-applicable",
    kanaReading: "フン",
    recognitionTarget: "糞",
    jmdictId: "1000000",
  });
});

Deno.test("duplicateExceptionContext expands each related note's sense selection", async () => {
  const word = makeWord({
    kanji: ["言葉", "語"],
    kana: ["ことば"],
    senses: [
      { glosses: ["word"] },
      { glosses: ["language"] },
      { glosses: ["expression"] },
    ],
  });
  const firstNote = makeNote({
    key: "言葉 | 1000000:1",
    dictionary: renderDictionaryField([word]),
  });
  firstNote.noteId = 1;
  const secondNote = makeNote({
    key: "言葉 | 1000000:1,2",
    dictionary: renderDictionaryField([word]),
  });
  secondNote.noteId = 2;
  const otherTargetNote = makeNote({
    key: "語 | 1000000",
    dictionary: renderDictionaryField([word]),
  });
  otherTargetNote.noteId = 3;
  const entries = entriesById(word);
  const cards = flagDuplicateRecognitionUnits(
    await Promise.all(
      [firstNote, secondNote, otherTargetNote].map((note) => analyzeCard(note, entries)),
    ),
    entries,
  );
  const cardsByNoteId = new Map(cards.map((card) => [card.note.noteId, card]));

  assertEquals(duplicateExceptionContext(cards[0], [2], cardsByNoteId, entries), {
    kind: "duplicate-recognition-unit",
    notes: [
      { noteId: 1, usages: [{ jmdictId: "1000000", senseNumbers: [1] }] },
      { noteId: 2, usages: [{ jmdictId: "1000000", senseNumbers: [1, 2] }] },
    ],
    entries: [{
      jmdictId: "1000000",
      senseCount: 3,
      otherCards: [{ noteId: 3, recognitionTarget: "語", senseNumbers: [1, 2, 3] }],
    }],
  });
});
