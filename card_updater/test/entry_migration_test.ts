import "../../data/test/use_jmdict_fixtures.ts";
import { assertEquals, assertNotEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { renderDictionaryField } from "card_model/dictionary";
import { analyzeCard } from "../src/analyze.ts";
import { flagDuplicateRecognitionUnits } from "../src/duplicate_keys.ts";
import { suggestedKey } from "../src/suggest.ts";
import { impliedDecision, resolveApply, validateResultingReading } from "../src/server.ts";
import { type ACInvoke, applyNoteUpdate } from "../src/anki.ts";
import { fieldNames, noteTypeName } from "card_model";
import { cardFingerprint } from "../src/state.ts";
import { entriesById, makeNote } from "./fixtures.ts";
import fixture from "./fixtures/ikisatsu-split.json" with { type: "json" };

function entries(): JMdictWord[] {
  return structuredClone(fixture.entries) as unknown as JMdictWord[];
}

Deno.test("entry migration proposes the actual いきさつ split for explicit review", async () => {
  const current = entriesById(...entries());
  const note = makeNote(fixture.note);
  const before = structuredClone(note);
  const card = await analyzeCard(note, current);
  assertEquals(card.reason, "entry-migration");
  assertEquals(card.verdict, "retarget");
  assertEquals(card.needsAI, true);
  assertEquals(card.proposedKey, "いきさつ | 2873066");
  assertEquals(card.parsedKey?.usages[0].jmdictId, "1251120");
  assertEquals(card.latestWord?.id, "2873066");
  assertEquals(card.targetSenseNumbers, [1]);
  assertEquals(card.mappedTargetSenses, [1]);
  assertEquals(card.acceptedKanaReadings, ["いきさつ"]);
  assertEquals(card.proposedReading, null);
  assertEquals(card.note, before);
  assertEquals(impliedDecision(card), "none");
  assertEquals(suggestedKey(card, []), "いきさつ | 2873066");
  assertEquals(await validateResultingReading(card, suggestedKey(card, []), "", current), {
    reading: "",
  });
});

Deno.test("entry migration rejects missing, ambiguous, or semantically unrelated successors", async () => {
  const [old, successor] = entries();
  const note = makeNote(fixture.note);
  assertEquals((await analyzeCard(note, entriesById(old))).reason, "spelling-removed");
  const duplicate = structuredClone(successor);
  duplicate.id = "9999999";
  assertEquals(
    (await analyzeCard(note, entriesById(old, successor, duplicate))).reason,
    "spelling-removed",
  );
  successor.sense[0].gloss = [{ lang: "eng", gender: null, type: null, text: "warp and weft" }];
  assertEquals((await analyzeCard(note, entriesById(old, successor))).reason, "spelling-removed");
});

Deno.test("entry migration retains a removed reading without losing other accepted readings", async () => {
  const current = entriesById(...entries());
  const card = await analyzeCard(
    makeNote({
      key: "経緯 | 1251120:1",
      recognitionTarget: "経緯",
      reading: "経緯[いきさつ]",
      dictionary: fixture.note.dictionary,
      fullContext: "細かい<mark>経緯[いきさつ]</mark>はわかりませんが。",
    }),
    current,
  );
  assertEquals(card.reason, "entry-migration");
  assertEquals(card.proposedKey, "経緯 | 2873066");
  assertEquals(card.acceptedKanaReadings, ["いきさつ"]);
  assertEquals(card.proposedReading, null);

  const multipleReadings = await analyzeCard(
    makeNote({
      key: "経緯 | 1251120:1",
      recognitionTarget: "経緯",
      reading: "<ul><li>経緯[いきさつ]</li><li>経[けい] 緯[い]</li></ul>",
      dictionary: fixture.note.dictionary,
    }),
    current,
  );
  assertEquals(multipleReadings.reason, "invalid-reading");

  const unsupportedReading = await analyzeCard(
    makeNote({
      key: "経緯 | 1251120:1",
      recognitionTarget: "経緯",
      reading: "経緯[でたらめ]",
      dictionary: fixture.note.dictionary,
    }),
    current,
  );
  assertEquals(unsupportedReading.reason, "invalid-reading");
});

Deno.test("entry migration requires every old target to have a unique successor sense", async () => {
  const [old, successor] = entries();
  const allSenses = makeNote({ ...fixture.note, key: "いきさつ | 1251120" });
  assertEquals(
    (await analyzeCard(allSenses, entriesById(old, successor))).reason,
    "spelling-removed",
  );
  successor.sense.push(structuredClone(successor.sense[0]));
  assertEquals(
    (await analyzeCard(makeNote(fixture.note), entriesById(old, successor))).reason,
    "spelling-removed",
  );
});

Deno.test("entry migration does not repair an originally invalid or multi-entry card", async () => {
  const [old, successor] = entries();
  const current = entriesById(old, successor);
  const invalid = makeNote({
    key: "いきさつ | 1251120:1",
    dictionary: renderDictionaryField([old]),
  });
  assertEquals((await analyzeCard(invalid, current)).reason, "spelling-not-in-entry");
  const multi = makeNote({
    ...fixture.note,
    key: "いきさつ | 1251120:1;2873066",
    dictionary: fixture.note.dictionary + "\n" + renderDictionaryField([successor]),
  });
  assertEquals((await analyzeCard(multi, current)).verdict, "exception");
  const malformedReading = makeNote({ ...fixture.note, reading: "いきさつ" });
  assertEquals((await analyzeCard(malformedReading, current)).reason, "spelling-removed");
});

Deno.test("entry migration detects destination conflicts without flagging the existing card", async () => {
  const [old, successor] = entries();
  const current = entriesById(old, successor);
  const migration = await analyzeCard(makeNote(fixture.note), current);
  const existingNote = makeNote({
    key: "いきさつ | 2873066",
    dictionary: renderDictionaryField([successor]),
  });
  existingNote.noteId = 42;
  const existing = await analyzeCard(existingNote, current);
  const checked = flagDuplicateRecognitionUnits([migration, existing], current);
  assertEquals(checked[0].reason, "migration-conflict");
  assertEquals(checked[0].needsAI, false);
  assertEquals(checked[1].verdict, "unchanged");
});

Deno.test("entry migration decisions are invalidated when only the destination ID changes", async () => {
  const [old, successor] = entries();
  const first = await analyzeCard(makeNote(fixture.note), entriesById(old, successor));
  successor.id = "9999999";
  const second = await analyzeCard(makeNote(fixture.note), entriesById(old, successor));
  assertEquals(first.latestEntryHTML, second.latestEntryHTML);
  assertNotEquals(await cardFingerprint(first), await cardFingerprint(second));
});

Deno.test("entry migration applies only the reviewed key and dictionary, preserving the note", async () => {
  const card = await analyzeCard(makeNote(fixture.note), entriesById(...entries()));
  assertEquals(resolveApply(card, null), { error: "Not accepted (undecided)." });
  const decision = {
    decision: "accept" as const,
    senses: [],
    hint: "",
    resolvedBy: "human" as const,
    fingerprint: await cardFingerprint(card),
    decidedAt: "2026-10-04T00:00:00Z",
  };
  assertEquals(resolveApply(card, { ...decision, senses: null }), {
    error: "Re-target cards need an explicit reviewed decision.",
  });
  const resolution = resolveApply(card, decision);
  if (!("set" in resolution)) throw new Error(resolution.error);
  assertEquals(resolution.set, {
    key: "いきさつ | 2873066",
    dictionary: card.latestEntryHTML!,
    hint: "",
  });

  const writes: unknown[] = [];
  const invoke: ACInvoke = (action, params) => {
    if (action === "notesInfo") {
      return Promise.resolve([{
        noteId: card.note.noteId,
        modelName: noteTypeName,
        cards: card.note.cards,
        tags: card.note.tags,
        fields: Object.fromEntries(
          Object.entries(fieldNames).map(([key, name], order) => [
            name,
            { value: card.note.fields[key as keyof typeof card.note.fields], order },
          ]),
        ),
      }] as never);
    }
    if (action === "updateNoteFields") {
      writes.push(params);
      return Promise.resolve(null as never);
    }
    throw new Error(`Unexpected Anki operation: ${action}`);
  };
  const result = await applyNoteUpdate({
    noteId: card.note.noteId,
    expect: card.note.fields,
    set: resolution.set,
  }, invoke);
  assertEquals(result.ok, true);
  assertEquals(writes, [{
    note: {
      id: card.note.noteId,
      fields: { Key: "いきさつ | 2873066", Dictionary: card.latestEntryHTML },
    },
  }]);
});
