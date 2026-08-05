import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import { readingSelectionMessages, validateReadingSelection } from "../src/reading_selection.ts";

Deno.test("readingSelectionMessages presents comparable lexicographic and corpus evidence", async () => {
  const messages = await readingSelectionMessages({
    context: "アメリカが日本に対して間接<mark>統治</mark>というかたちで占領する。",
    recognitionTarget: "統治",
    jmdictEntry: await preextractedJMDictEntry("1449790"),
    senseNumbers: [1],
    encountered: { kanaReading: "とうち", bccwjFrequencyPerMillion: 3.1329379 },
    alternatives: [{ kanaReading: "とうじ", bccwjFrequencyPerMillion: null }],
  });

  assertEquals(messages.length, 1);
  const message = messages[0];
  if (message.role !== "user" || typeof message.content !== "string") {
    throw new TypeError("Expected the reading-selection message to contain text");
  }
  assertEquals(message.content.includes("<mark>"), false);
  assertEquals(message.content.includes("⟪target:0⟫統治⟪/target:0⟫"), true);
  assertEquals(
    message.content.includes(
      '"kanaReading": "とうち",\n  "bccwjFrequencyPerMillion": 3.1329379,\n  "common": true',
    ),
    true,
  );
  assertEquals(
    message.content.includes(
      '"kanaReading": "とうじ",\n    "bccwjFrequencyPerMillion": null,\n    "common": false',
    ),
    true,
  );
});

Deno.test("readingSelectionMessages expands JMDict reading tags", async () => {
  const messages = await readingSelectionMessages({
    context: "国家がそれを<mark>打破</mark>しようとする。",
    recognitionTarget: "打破",
    jmdictEntry: await preextractedJMDictEntry("1408950"),
    senseNumbers: [1],
    encountered: { kanaReading: "だは", bccwjFrequencyPerMillion: 0.5761725 },
    alternatives: [{ kanaReading: "たは", bccwjFrequencyPerMillion: null }],
  });

  const message = messages[0];
  if (message.role !== "user" || typeof message.content !== "string") {
    throw new TypeError("Expected the reading-selection message to contain text");
  }
  assertEquals(
    message.content.includes('"tags": [\n      "out-dated or obsolete kana usage"'),
    true,
  );
});

Deno.test("validateReadingSelection preserves ordered auditable decisions", async () => {
  assertEquals(
    validateReadingSelection(
      {
        context: "<mark>明日</mark>も来るよ。",
        recognitionTarget: "明日",
        jmdictEntry: await preextractedJMDictEntry("1584660"),
        senseNumbers: [1],
        encountered: { kanaReading: "あした", bccwjFrequencyPerMillion: 82.1 },
        alternatives: [
          { kanaReading: "あす", bccwjFrequencyPerMillion: 64.2 },
          { kanaReading: "みょうにち", bccwjFrequencyPerMillion: 2.1 },
        ],
      },
      {
        decisions: [
          {
            kanaReading: "あす",
            decision: "include",
            rationale: "A common everyday alternative.",
          },
          {
            kanaReading: "みょうにち",
            decision: "omit",
            rationale: "Strongly formal relative to this casual encounter.",
          },
        ],
      },
    ),
    {
      decisions: [
        {
          kanaReading: "あす",
          decision: "include",
          rationale: "A common everyday alternative.",
        },
        {
          kanaReading: "みょうにち",
          decision: "omit",
          rationale: "Strongly formal relative to this casual encounter.",
        },
      ],
    },
  );
});

Deno.test("reading selection rejects inconsistent deterministic inputs", async (t) => {
  await t.step("an alternative must be an exact JMDict reading", async () => {
    await assertRejects(
      async () =>
        readingSelectionMessages({
          context: "<mark>統治</mark>する。",
          recognitionTarget: "統治",
          jmdictEntry: await preextractedJMDictEntry("1449790"),
          senseNumbers: [1],
          encountered: { kanaReading: "とうち", bccwjFrequencyPerMillion: 3.1329379 },
          alternatives: [{ kanaReading: "とうぢ", bccwjFrequencyPerMillion: null }],
        }),
      Error,
      'alternatives[0].kanaReading "とうぢ" is not one of the exact jmdictEntry.kana readings in jmdictEntry with id "1449790"',
    );
  });

  await t.step(
    "an alternative cannot use a script variant absent from JMDict",
    async () => {
      await assertRejects(
        async () =>
          readingSelectionMessages({
            context: "<mark>日本</mark>へ行く。",
            recognitionTarget: "日本",
            jmdictEntry: await preextractedJMDictEntry("1582710"),
            senseNumbers: [1],
            encountered: { kanaReading: "にほん", bccwjFrequencyPerMillion: null },
            alternatives: [{ kanaReading: "ニホン", bccwjFrequencyPerMillion: null }],
          }),
        Error,
        'alternatives[0].kanaReading "ニホン" is not one of the exact jmdictEntry.kana readings',
      );
    },
  );

  await t.step("corpus evidence must be positive when present", async () => {
    await assertRejects(
      async () =>
        readingSelectionMessages({
          context: "<mark>刻々</mark>と近づく。",
          recognitionTarget: "刻々",
          jmdictEntry: await preextractedJMDictEntry("1285830"),
          senseNumbers: [1],
          encountered: { kanaReading: "こっこく", bccwjFrequencyPerMillion: 3.1809523 },
          alternatives: [{ kanaReading: "こくこく", bccwjFrequencyPerMillion: 0 }],
        }),
      RangeError,
      "alternatives[0].bccwjFrequencyPerMillion must be null or a positive finite number",
    );
  });
});

Deno.test("validateReadingSelection rejects incomplete or unauditable output", async (t) => {
  const input = {
    context: "<mark>明日</mark>も来るよ。",
    recognitionTarget: "明日",
    jmdictEntry: await preextractedJMDictEntry("1584660"),
    senseNumbers: [1],
    encountered: { kanaReading: "あした", bccwjFrequencyPerMillion: 82.1 },
    alternatives: [
      { kanaReading: "あす", bccwjFrequencyPerMillion: 64.2 },
      { kanaReading: "みょうにち", bccwjFrequencyPerMillion: 2.1 },
    ],
  };

  await t.step("missing decision", () => {
    assertThrows(
      () =>
        validateReadingSelection(input, {
          decisions: [{ kanaReading: "あす", decision: "include", rationale: "Common." }],
        }),
      Error,
      'expected exactly one decision for each supplied alternative, in order ["あす","みょうにち"]',
    );
  });

  await t.step("empty rationale", () => {
    assertThrows(
      () =>
        validateReadingSelection(input, {
          decisions: [
            { kanaReading: "あす", decision: "include", rationale: "Common." },
            { kanaReading: "みょうにち", decision: "omit", rationale: "  " },
          ],
        }),
      Error,
      'empty rationale for alternatives[1].kanaReading "みょうにち"',
    );
  });
});
