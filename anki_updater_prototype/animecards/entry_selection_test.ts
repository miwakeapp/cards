import { assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import type { GeneratedSenseAndHint } from "card_field_generation";
import {
  entrySelectionInputFingerprint,
  selectJMDictEntry,
  type UnresolvedJMDictEntry,
} from "./entry_selection.ts";

function entry(id: string, glosses: string[]): JMdictWord {
  return {
    id,
    kanji: [{ common: true, text: "業", tags: [] }],
    kana: [{
      common: true,
      text: id === "1111111" ? "ごう" : "わざ",
      tags: [],
      appliesToKanji: ["*"],
    }],
    sense: glosses.map((text) => ({
      partOfSpeech: ["n"],
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: [],
      info: [],
      languageSource: [],
      gloss: [{ lang: "eng", gender: null, type: null, text }],
    })),
  } as JMdictWord;
}

function request(
  {
    allowedJMDictIds = ["1111111", "2222222"],
    kanaReading = "ごう",
    kanaReadingEvidence = "animecard",
    candidateEntries = [
      entry("2222222", ["work", "performance"]),
      entry("1111111", ["karma"]),
    ],
  }: {
    allowedJMDictIds?: string[];
    kanaReading?: string;
    kanaReadingEvidence?: UnresolvedJMDictEntry["kanaReadingEvidence"];
    candidateEntries?: JMdictWord[];
  } = {},
): UnresolvedJMDictEntry {
  return {
    context: "それは前世の業だ。",
    recognitionTarget: "業",
    kanaReading,
    kanaReadingEvidence,
    // Deliberately reversed: combined sense numbering must be stable by entry ID.
    candidateEntries,
    allowedJMDictIds,
  };
}

Deno.test("selectJMDictEntry maps combined senses back to one entry", async () => {
  const result = await selectJMDictEntry(
    request(),
    "gemini-3.6-flash",
    (input): Promise<GeneratedSenseAndHint> => {
      assertEquals(input.jmdictEntry.id, "entry-selection:1111111,2222222");
      assertEquals(input.jmdictEntry.sense.length, 3);
      assertEquals(input.compatibleSenseNumbers, [1, 2, 3]);
      // Combined sense 1 is entry 1111111 sense 1.
      return Promise.resolve({ applicableSenses: [1], hint: "前世の業" });
    },
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    model: "gemini-3.6-flash",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111", "2222222"],
  });
});

Deno.test("selectJMDictEntry reports no semantic match", async () => {
  const result = await selectJMDictEntry(
    request(),
    "gemini-3.6-flash",
    () => Promise.resolve({ applicableSenses: null, hint: null }),
  );
  assertEquals(result, { status: "no-match" });
});

Deno.test("selectJMDictEntry defers senses spanning several entries", async () => {
  const second = entry("2222222", ["work", "performance"]);
  second.kana[0].text = "ごう";
  const result = await selectJMDictEntry(
    request({
      candidateEntries: [second, entry("1111111", ["karma"])],
    }),
    "gemini-3.6-flash",
    () => Promise.resolve({ applicableSenses: [], hint: null }),
  );
  assertEquals(result, {
    status: "ambiguous",
    selectedJMDictIds: ["1111111", "2222222"],
  });
});

Deno.test("selectJMDictEntry does not override a same-reading unlinked choice", async () => {
  let calls = 0;
  const unlinked = entry("1111111", ["karma"]);
  unlinked.kana[0].text = "わざ";
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["2222222"],
      kanaReading: "わざ",
      candidateEntries: [
        entry("2222222", ["work", "performance"]),
        unlinked,
      ],
    }),
    "gemini-3.6-flash",
    (input) => {
      ++calls;
      if (calls === 1) {
        // Both entries have the same reading, but the broad comparison still overcalls the
        // semantically related unlinked entry.
        return Promise.resolve({ applicableSenses: [1], hint: "前世の業" });
      }
      throw new Error(`Unexpected retry with ${input.jmdictEntry.id}`);
    },
  );
  assertEquals(result, {
    status: "disallowed",
    selectedJMDictId: "1111111",
  });
  assertEquals(calls, 1);
});

Deno.test("selectJMDictEntry rejects a selected entry incompatible with the Animecard reading", async () => {
  const result = await selectJMDictEntry(
    request({ allowedJMDictIds: ["2222222"] }),
    "gemini-3.6-flash",
    () => Promise.resolve({ applicableSenses: [2, 3], hint: "職人の業" }),
  );
  assertEquals(result, {
    status: "reading-conflict",
    selectedJMDictId: "2222222",
    compatibleReadings: ["わざ"],
  });
});

Deno.test("selectJMDictEntry rechecks a linked entry after a reading-incompatible choice", async () => {
  let calls = 0;
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["2222222"],
      kanaReading: "わざ",
    }),
    "gemini-3.6-flash",
    (input) => {
      ++calls;
      if (calls === 1) {
        // Combined sense 1 belongs to the unlinked entry with reading ごう.
        return Promise.resolve({ applicableSenses: [1], hint: "前世の業" });
      }
      assertEquals(input.jmdictEntry.id, "entry-selection:2222222");
      return Promise.resolve({ applicableSenses: [1], hint: "職人の業" });
    },
  );
  assertEquals(result, {
    status: "selected",
    jmdictId: "2222222",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "職人の業",
    model: "gemini-3.6-flash",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["2222222"],
  });
});

Deno.test("selectJMDictEntry applies source ruby before semantic selection", async () => {
  const selectedEntry = entry("1111111", ["karma", "fate"]);
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [
        entry("2222222", ["work", "performance"]),
        selectedEntry,
      ],
    }),
    "gemini-3.6-flash",
    (input) => {
      assertEquals(input.jmdictEntry.id, "entry-selection:1111111");
      assertEquals(input.jmdictEntry.sense.length, 2);
      return Promise.resolve({ applicableSenses: [1], hint: "前世の業" });
    },
  );
  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    model: "gemini-3.6-flash",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
  });
});

Deno.test("selectJMDictEntry defers a source-ruby distinction with no useful hint", async () => {
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
    }),
    "gemini-3.6-flash",
    () => Promise.resolve({ applicableSenses: [], hint: null }),
    () => Promise.resolve(null),
  );
  assertEquals(result, {
    status: "hint-unavailable",
    selectedJMDictId: "1111111",
  });
});

Deno.test("selectJMDictEntry asks for a contrastive hint after reading selects the entry", async () => {
  const selectedEntry = entry("1111111", ["karma"]);
  const contrastingEntry = entry("2222222", ["work"]);
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [contrastingEntry, selectedEntry],
    }),
    "gemini-3.6-flash",
    () => Promise.resolve({ applicableSenses: [], hint: null }),
    (input) => {
      assertEquals(input.selectedEntry, selectedEntry);
      assertEquals(input.applicableSenseNumbers, [1]);
      assertEquals(input.contrastingEntries, [contrastingEntry]);
      return Promise.resolve("前世の業");
    },
  );

  assertEquals(result, {
    status: "selected",
    jmdictId: "1111111",
    recognitionTarget: "業",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    model: "gemini-3.6-flash",
    generatedAt: result.status === "selected" ? result.generatedAt : "",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
  });
});

Deno.test("selectJMDictEntry does not invent a hint for entries with overlapping glosses", async () => {
  const result = await selectJMDictEntry(
    request({
      allowedJMDictIds: ["1111111"],
      kanaReadingEvidence: "source-ruby",
      candidateEntries: [
        entry("2222222", ["karma", "destiny"]),
        entry("1111111", ["karma", "fate"]),
      ],
    }),
    "gemini-3.6-flash",
    () => Promise.resolve({ applicableSenses: [], hint: null }),
    () => {
      throw new Error("Contrastive generation should not run for overlapping glosses.");
    },
  );

  assertEquals(result, {
    status: "hint-unavailable",
    selectedJMDictId: "1111111",
  });
});

Deno.test("entrySelectionInputFingerprint is insensitive to candidate entry order", async () => {
  const first = request();
  const second = { ...first, candidateEntries: [...first.candidateEntries].reverse() };
  assertEquals(
    await entrySelectionInputFingerprint(first, "gemini-3.6-flash"),
    await entrySelectionInputFingerprint(second, "gemini-3.6-flash"),
  );
});

Deno.test("entrySelectionInputFingerprint distinguishes source ruby from Animecard metadata", async () => {
  assertEquals(
    await entrySelectionInputFingerprint(request(), "gemini-3.6-flash") ===
      await entrySelectionInputFingerprint(
        request({ kanaReadingEvidence: "source-ruby" }),
        "gemini-3.6-flash",
      ),
    false,
  );
});
