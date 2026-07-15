import { assertEquals } from "@std/assert";
import { type ACInvoke, applyNoteUpdate } from "../src/anki.ts";

function fakeAnki(noteFields: Record<string, string> | null) {
  const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  const invoke: ACInvoke = (action, params = {}) => {
    calls.push({ action, params });
    if (action === "notesInfo") {
      if (noteFields === null) {
        return Promise.resolve([{}] as never);
      }
      const fields = Object.fromEntries(
        Object.entries(noteFields).map(([name, value], order) => [name, { value, order }]),
      );
      return Promise.resolve(
        [{ noteId: 42, tags: [], cards: [], modelName: "Miwake Card", fields }] as never,
      );
    }
    if (action === "updateNoteFields") {
      return Promise.resolve(null as never);
    }
    throw new Error(`Unexpected action ${action}`);
  };
  return { invoke, calls };
}

const CURRENT_FIELDS = {
  "Key": "掬う | 1226200 | 1",
  "Recognition target": "掬う",
  "Hint": "",
  "Dictionary entry": '<ol class="senses"><li>old</li></ol>',
  "Full context": "",
  "Minimized context": "",
  "Reading": "",
  "Source": "",
};

Deno.test("applyNoteUpdate: writes only changed fields when the snapshot still matches", async () => {
  const { invoke, calls } = fakeAnki(CURRENT_FIELDS);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200 | 1",
      dictionaryEntry: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: {
      key: "掬う | 1226200 | 1", // unchanged → not written
      dictionaryEntry: '<ol class="senses"><li>new</li></ol>',
      hint: "", // unchanged → not written
    },
  }, invoke);

  assertEquals(result.ok, true);
  assertEquals(result.wroteFields, ["Dictionary entry"]);
  assertEquals(result.before, {
    key: "掬う | 1226200 | 1",
    dictionaryEntry: '<ol class="senses"><li>old</li></ol>',
    hint: "",
  });
  assertEquals(result.after, {
    key: "掬う | 1226200 | 1",
    dictionaryEntry: '<ol class="senses"><li>new</li></ol>',
    hint: "",
  });
  const update = calls.find((call) => call.action === "updateNoteFields")!;
  assertEquals(update.params, {
    note: { id: 42, fields: { "Dictionary entry": '<ol class="senses"><li>new</li></ol>' } },
  });
});

Deno.test("applyNoteUpdate: refuses when the note changed since analysis", async () => {
  const { invoke, calls } = fakeAnki({
    ...CURRENT_FIELDS,
    "Dictionary entry": '<ol class="senses"><li>edited in Anki meanwhile</li></ol>',
  });
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200 | 1",
      dictionaryEntry: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: { dictionaryEntry: '<ol class="senses"><li>new</li></ol>' },
  }, invoke);

  assertEquals(result.ok, false);
  assertEquals(result.error?.includes("Dictionary entry"), true);
  assertEquals(calls.some((call) => call.action === "updateNoteFields"), false);
});

Deno.test("applyNoteUpdate: refuses when the note no longer exists", async () => {
  const { invoke } = fakeAnki(null);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: { key: "x | 1", dictionaryEntry: "", hint: "" },
    set: { dictionaryEntry: "y" },
  }, invoke);

  assertEquals(result.ok, false);
  assertEquals(result.error, "Note no longer exists.");
});

Deno.test("applyNoteUpdate: key and hint changes are written together", async () => {
  const { invoke, calls } = fakeAnki(CURRENT_FIELDS);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200 | 1",
      dictionaryEntry: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: {
      key: "掬う | 1226200 | 2",
      dictionaryEntry: '<ol class="senses"><li>new</li></ol>',
      hint: "網で掬う",
    },
  }, invoke);

  assertEquals(result.ok, true);
  assertEquals(result.wroteFields.sort(), ["Dictionary entry", "Hint", "Key"]);
  const update = calls.find((call) => call.action === "updateNoteFields")!;
  const fields = (update.params.note as { fields: Record<string, string> }).fields;
  assertEquals(fields["Key"], "掬う | 1226200 | 2");
  assertEquals(fields["Hint"], "網で掬う");
});
