import { assert, assertEquals, assertMatch } from "@std/assert";
import * as path from "@std/path";
import type { JMDictWord } from "../mod.ts";

const dataDirectory = path.resolve(import.meta.dirname!, "..");
const entriesDirectory = path.join(dataDirectory, "preextracted_jmdict_entries");

Deno.test("pre-extracted JMDict entries are internally consistent and cover consumers", async () => {
  const ids = new Set<string>();
  for await (const entry of Deno.readDir(entriesDirectory)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const filenameId = path.basename(entry.name, ".json");
    const word = JSON.parse(
      await Deno.readTextFile(path.join(entriesDirectory, entry.name)),
    ) as JMDictWord;
    assertEquals(word.id, filenameId);
    ids.add(word.id);
  }

  for await (
    const entry of Deno.readDir(path.resolve(dataDirectory, "../card_creator_evals/inputs"))
  ) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const input = JSON.parse(
      await Deno.readTextFile(
        path.resolve(dataDirectory, "../card_creator_evals/inputs", entry.name),
      ),
    ) as { jmdictId: string };
    assert(ids.has(input.jmdictId), `${entry.name} needs missing JMDict entry ${input.jmdictId}`);
  }

  const furigana = JSON.parse(
    await Deno.readTextFile(path.join(dataDirectory, "test/fixtures/jmdict_furigana.json")),
  ) as Record<string, string>;
  for (const key of Object.keys(furigana)) {
    const [id] = key.split("|", 1);
    assert(ids.has(id), `Furigana fixture needs missing JMDict entry ${id}`);
  }

  const snapshot = JSON.parse(
    await Deno.readTextFile(path.join(dataDirectory, "jmdict_snapshot.json")),
  ) as { source: string; version: string; dictDate: string };
  assertEquals(snapshot.source, "https://github.com/scriptin/jmdict-simplified");
  assertMatch(snapshot.version, /^\d+\.\d+\.\d+$/);
  assertMatch(snapshot.dictDate, /^\d{4}-\d{2}-\d{2}$/);
});
