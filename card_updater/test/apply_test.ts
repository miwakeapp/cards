import { assertEquals } from "@std/assert";
import { noteTypeName } from "card_model";
import { type ACInvoke, ankiKeyText, applyNoteUpdate } from "../src/anki.ts";

Deno.test("ankiKeyText preserves noncanonical whitespace and markup", () => {
  assertEquals(ankiKeyText(" 後々&nbsp;| <b>1578610</b> "), " 後々 | <b>1578610</b> ");
});

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
        [{ noteId: 42, tags: [], cards: [], modelName: noteTypeName, fields }] as never,
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
  "Key": "掬う | 1226200:1",
  "Recognition target": "掬う",
  "Hint": "",
  "Dictionary": '<ol class="senses"><li>old</li></ol>',
  "Full context": "",
  "Minimized context": "",
  "Reading": "掬[すく]う",
  "Source": "",
};

const READING_UPDATE_FIELDS = {
  ...CURRENT_FIELDS,
  "Key": "食べる | 1358280",
  "Recognition target": "食べる",
  "Reading": "食[た]べる",
};

Deno.test("applyNoteUpdate: writes only changed fields when the snapshot still matches", async () => {
  const { invoke, calls } = fakeAnki(CURRENT_FIELDS);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200:1",
      recognitionTarget: "掬う",
      reading: "掬[すく]う",
      dictionary: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: {
      key: "掬う | 1226200:1", // unchanged → not written
      dictionary: '<ol class="senses"><li>new</li></ol>',
      hint: "", // unchanged → not written
    },
  }, invoke);

  assertEquals(result.ok, true);
  assertEquals(result.wroteFields, ["Dictionary"]);
  assertEquals(result.before, {
    key: "掬う | 1226200:1",
    reading: "掬[すく]う",
    dictionary: '<ol class="senses"><li>old</li></ol>',
    hint: "",
  });
  assertEquals(result.after, {
    key: "掬う | 1226200:1",
    reading: "掬[すく]う",
    dictionary: '<ol class="senses"><li>new</li></ol>',
    hint: "",
  });
  const update = calls.find((call) => call.action === "updateNoteFields")!;
  assertEquals(update.params, {
    note: { id: 42, fields: { "Dictionary": '<ol class="senses"><li>new</li></ol>' } },
  });
});

Deno.test("applyNoteUpdate: refuses when the note changed since analysis", async () => {
  const { invoke, calls } = fakeAnki({
    ...CURRENT_FIELDS,
    "Dictionary": '<ol class="senses"><li>edited in Anki meanwhile</li></ol>',
  });
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200:1",
      recognitionTarget: "掬う",
      reading: "掬[すく]う",
      dictionary: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: { dictionary: '<ol class="senses"><li>new</li></ol>' },
  }, invoke);

  assertEquals(result.ok, false);
  assertEquals(result.error?.includes("Dictionary"), true);
  assertEquals(calls.some((call) => call.action === "updateNoteFields"), false);
});

Deno.test("applyNoteUpdate: refuses when the note no longer exists", async () => {
  const { invoke } = fakeAnki(null);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200:1",
      recognitionTarget: "掬う",
      reading: "掬[すく]う",
      dictionary: "",
      hint: "",
    },
    set: { dictionary: "y" },
  }, invoke);

  assertEquals(result.ok, false);
  assertEquals(result.error, "Note no longer exists.");
});

Deno.test("applyNoteUpdate: key and hint changes are written together", async () => {
  const { invoke, calls } = fakeAnki(CURRENT_FIELDS);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200:1",
      recognitionTarget: "掬う",
      reading: "掬[すく]う",
      dictionary: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: {
      key: "掬う | 1226200:2",
      dictionary: '<ol class="senses"><li>new</li></ol>',
      hint: "網で掬う",
    },
  }, invoke);

  assertEquals(result.ok, true);
  assertEquals(result.wroteFields.sort(), ["Dictionary", "Hint", "Key"]);
  const update = calls.find((call) => call.action === "updateNoteFields")!;
  const fields = (update.params.note as { fields: Record<string, string> }).fields;
  assertEquals(fields["Key"], "掬う | 1226200:2");
  assertEquals(fields["Hint"], "網で掬う");
});

Deno.test("applyNoteUpdate: guards and records Reading changes", async () => {
  const { invoke, calls } = fakeAnki(READING_UPDATE_FIELDS);
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "食べる | 1358280",
      recognitionTarget: "食べる",
      reading: "食[た]べる",
      dictionary: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: { reading: "食べ[たべ]る" },
  }, invoke);

  assertEquals(result.ok, true);
  assertEquals(result.wroteFields, ["Reading"]);
  assertEquals(result.before?.reading, "食[た]べる");
  assertEquals(result.after?.reading, "食べ[たべ]る");
  const update = calls.find((call) => call.action === "updateNoteFields")!;
  assertEquals(update.params, { note: { id: 42, fields: { Reading: "食べ[たべ]る" } } });
});

Deno.test("applyNoteUpdate: refuses a Reading edited after analysis", async () => {
  const { invoke, calls } = fakeAnki({
    ...READING_UPDATE_FIELDS,
    "Reading": "食べる[たべる]",
  });
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "食べる | 1358280",
      recognitionTarget: "食べる",
      reading: "食[た]べる",
      dictionary: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: { reading: "食べ[たべ]る" },
  }, invoke);

  assertEquals(result.ok, false);
  assertEquals(result.error?.includes("Reading"), true);
  assertEquals(calls.some((call) => call.action === "updateNoteFields"), false);
});

Deno.test("applyNoteUpdate: refuses a Recognition target edited after analysis", async () => {
  const { invoke, calls } = fakeAnki({
    ...CURRENT_FIELDS,
    "Recognition target": "～掬う",
  });
  const result = await applyNoteUpdate({
    noteId: 42,
    expect: {
      key: "掬う | 1226200:1",
      recognitionTarget: "掬う",
      reading: "掬[すく]う",
      dictionary: '<ol class="senses"><li>old</li></ol>',
      hint: "",
    },
    set: { dictionary: '<ol class="senses"><li>new</li></ol>' },
  }, invoke);

  assertEquals(result.ok, false);
  assertEquals(result.error?.includes("Recognition target"), true);
  assertEquals(calls.some((call) => call.action === "updateNoteFields"), false);
});
