import { assertEquals, assertRejects } from "@std/assert";
import type { ACInvoke } from "../shared/anki_connect.ts";
import { fetchNoteInfos } from "./anki.ts";
import type { AnkiNoteInfo } from "./types.ts";

function note(noteId: number): AnkiNoteInfo {
  return {
    noteId,
    modelName: "Animecards",
    tags: [],
    fields: {},
    cards: [],
  };
}

Deno.test("fetchNoteInfos retries a failed read-only batch", async () => {
  let calls = 0;
  const retries: number[] = [];
  const invoke: ACInvoke = <T>() => {
    ++calls;
    if (calls === 1) return Promise.reject(new Error("transient timeout"));
    return Promise.resolve([note(1), note(2)] as T);
  };
  const notes = await fetchNoteInfos([1, 2], invoke, {
    retryDelayMilliseconds: 0,
    onRetry: (_error, attempt) => retries.push(attempt),
  });

  assertEquals(notes.map(({ noteId }) => noteId), [1, 2]);
  assertEquals(calls, 2);
  assertEquals(retries, [1]);
});

Deno.test("fetchNoteInfos stops after the configured number of attempts", async () => {
  let calls = 0;
  const invoke: ACInvoke = () => {
    ++calls;
    return Promise.reject(new Error("persistent timeout"));
  };
  await assertRejects(
    () => fetchNoteInfos([1], invoke, { maxAttempts: 2, retryDelayMilliseconds: 0 }),
    Error,
    "persistent timeout",
  );
  assertEquals(calls, 2);
});
