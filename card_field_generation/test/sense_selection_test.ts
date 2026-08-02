import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { preextractedJMDictEntry } from "data";
import {
  SENSE_SELECTION_STABLE_MESSAGE_COUNT,
  senseSelectionMessages,
  senseSelectionOutputSchema,
  validateSenseSelection,
} from "../src/sense_selection.ts";

Deno.test("senseSelectionMessages identifies the marked source occurrence without HTML", async () => {
  const messages = await senseSelectionMessages({
    context:
      "<p>別の年輪について話した。</p><p><ruby>木<rt>き</rt></ruby>には<mark>年輪</mark>ができる。</p>",
    recognitionTarget: "年輪",
    jmdictEntry: await preextractedJMDictEntry("1469260"),
    compatibleSenseNumbers: [1, 2],
  });
  const variablePrompt = messages.at(-1);
  if (variablePrompt?.role !== "user" || typeof variablePrompt.content !== "string") {
    throw new TypeError("Expected final sense-selection message to contain text");
  }
  assertEquals(variablePrompt.content.includes("<mark>"), false);
  assertEquals(variablePrompt.content.includes("<ruby>"), false);
  assertEquals(variablePrompt.content.includes("Quoted source context (JSON string)"), true);
  assertEquals(
    variablePrompt.content.includes(
      JSON.stringify("別の年輪について話した。\n\n木には⟪target:0⟫年輪⟪/target:0⟫ができる。"),
    ),
    true,
  );
});

Deno.test("senseSelectionMessages preserves an already-resolved marked inflection", async () => {
  const messages = await senseSelectionMessages({
    context: "彼は最後まで<mark>頑張って</mark>くれた。",
    recognitionTarget: "頑張る",
    jmdictEntry: await preextractedJMDictEntry("1217700"),
    compatibleSenseNumbers: [1, 2],
  });
  const variablePrompt = messages.at(-1);
  if (variablePrompt?.role !== "user" || typeof variablePrompt.content !== "string") {
    throw new TypeError("Expected final sense-selection message to contain text");
  }
  assertEquals(
    variablePrompt.content.includes("最後まで⟪target:0⟫頑張って⟪/target:0⟫くれた"),
    true,
  );
});

Deno.test("senseSelectionMessages preserves already-resolved lexical morphology", async () => {
  const messages = await senseSelectionMessages({
    context: "<mark>頑張らん</mark>ばかりの勢いだ。",
    recognitionTarget: "頑張る",
    jmdictEntry: await preextractedJMDictEntry("1217700"),
    compatibleSenseNumbers: [1, 2],
  });
  const variablePrompt = messages.at(-1);
  if (variablePrompt?.role !== "user" || typeof variablePrompt.content !== "string") {
    throw new TypeError("Expected final sense-selection message to contain text");
  }
  assertEquals(
    variablePrompt.content.includes("⟪target:0⟫頑張らん⟪/target:0⟫ばかり"),
    true,
  );
});

Deno.test("senseSelectionMessages preserves an already-resolved literary adjective form", async () => {
  const messages = await senseSelectionMessages({
    context: "<mark>麗しの</mark>友よ、私にとってあなたは永遠に若いのだ。",
    recognitionTarget: "麗しい",
    jmdictEntry: await preextractedJMDictEntry("1557920"),
    compatibleSenseNumbers: [1, 2],
  });
  const variablePrompt = messages.at(-1);
  if (variablePrompt?.role !== "user" || typeof variablePrompt.content !== "string") {
    throw new TypeError("Expected final sense-selection message to contain text");
  }
  assertEquals(
    variablePrompt.content.includes("⟪target:0⟫麗しの⟪/target:0⟫友よ"),
    true,
  );
});

Deno.test("senseSelectionMessages strips Anki furigana from an already-resolved context", async () => {
  const messages = await senseSelectionMessages({
    context: "音[おと]の 中[なか]を<mark>揺蕩[たゆた]いながら</mark>、私は歩いた。",
    recognitionTarget: "揺蕩う",
    jmdictEntry: await preextractedJMDictEntry("2067460"),
    compatibleSenseNumbers: [1, 2],
  });
  const variablePrompt = messages.at(-1);
  if (variablePrompt?.role !== "user" || typeof variablePrompt.content !== "string") {
    throw new TypeError("Expected final sense-selection message to contain text");
  }
  assertEquals(
    variablePrompt.content.includes("⟪target:0⟫揺蕩いながら⟪/target:0⟫"),
    true,
  );
  assertEquals(variablePrompt.content.includes("たゆた"), false);
  assertEquals(variablePrompt.content.includes("おと"), false);
  assertEquals(variablePrompt.content.includes("なか"), false);
});

Deno.test("senseSelectionMessages preserves appearance そう inside the resolved target", async () => {
  const messages = await senseSelectionMessages({
    context: "ちょっと<mark>とろそうな</mark>人だ。",
    recognitionTarget: "とろい",
    jmdictEntry: await preextractedJMDictEntry("1922480"),
    compatibleSenseNumbers: [1, 2],
  });
  const variablePrompt = messages.at(-1);
  if (variablePrompt?.role !== "user" || typeof variablePrompt.content !== "string") {
    throw new TypeError("Expected final sense-selection message to contain text");
  }
  assertEquals(
    variablePrompt.content.includes("⟪target:0⟫とろそうな⟪/target:0⟫人"),
    true,
  );
});

Deno.test("sense-selection few-shots classify every supplied sense independently", async () => {
  const messages = await senseSelectionMessages({
    context: "木には<mark>年輪</mark>ができる。",
    recognitionTarget: "年輪",
    jmdictEntry: await preextractedJMDictEntry("1469260"),
    compatibleSenseNumbers: [1, 2],
  });
  assertEquals(SENSE_SELECTION_STABLE_MESSAGE_COUNT, messages.length - 1);

  for (let index = 1; index < SENSE_SELECTION_STABLE_MESSAGE_COUNT; index += 2) {
    const assistantMessage = messages[index];
    if (assistantMessage.role !== "assistant" || typeof assistantMessage.content !== "string") {
      throw new TypeError(`Expected message ${index} to contain an assistant JSON response`);
    }
    senseSelectionOutputSchema.parse(JSON.parse(assistantMessage.content));
  }

  const ambiguousPromptIndex = messages.findIndex((message) =>
    message.role === "user" &&
    typeof message.content === "string" &&
    message.content.startsWith("Recognition target: 義姉\n")
  );
  const ambiguousResponse = messages[ambiguousPromptIndex + 1];
  if (ambiguousResponse?.role !== "assistant" || typeof ambiguousResponse.content !== "string") {
    throw new TypeError("Expected the 義姉 few-shot to have an assistant JSON response");
  }
  assertEquals(JSON.parse(ambiguousResponse.content), {
    senseApplicability: [
      { senseNumber: 1, classification: "unclear" },
      { senseNumber: 2, classification: "unclear" },
    ],
  });
});

Deno.test("senseSelectionMessages rejects inconsistent deterministic inputs", async (t) => {
  const entry = await preextractedJMDictEntry("1469260");

  await t.step("recognitionTarget is absent from jmdictEntry", async () => {
    await assertRejects(
      () =>
        senseSelectionMessages({
          context: "木には<mark>年齢</mark>が現れる。",
          recognitionTarget: "年齢",
          jmdictEntry: entry,
          compatibleSenseNumbers: [1, 2],
        }),
      Error,
      'recognitionTarget "年齢" is not one of the exact spellings in jmdictEntry with id "1469260"',
    );
  });

  await t.step("compatibleSenseNumbers contains duplicates", async () => {
    await assertRejects(
      () =>
        senseSelectionMessages({
          context: "木には<mark>年輪</mark>ができる。",
          recognitionTarget: "年輪",
          jmdictEntry: entry,
          compatibleSenseNumbers: [1, 1],
        }),
      RangeError,
      'compatibleSenseNumbers must contain one or more unique integers between 1 and 2, inclusive, for jmdictEntry with id "1469260"; received [1,1]',
    );
  });
});

Deno.test("validateSenseSelection canonicalizes complete per-sense decisions", async (t) => {
  const input = {
    context: "木には<mark>年輪</mark>ができる。",
    recognitionTarget: "年輪",
    jmdictEntry: await preextractedJMDictEntry("1469260"),
    compatibleSenseNumbers: [1, 2],
  };

  await t.step("no sense matches", () => {
    assertEquals(
      validateSenseSelection(input, {
        senseApplicability: [
          { senseNumber: 1, classification: "no" },
          { senseNumber: 2, classification: "no" },
        ],
      }),
      { outcome: "no-match" },
    );
  });

  await t.step("every sense applies", () => {
    assertEquals(
      validateSenseSelection(input, {
        senseApplicability: [
          { senseNumber: 1, classification: "yes" },
          { senseNumber: 2, classification: "yes" },
        ],
      }),
      { outcome: "selected", senseNumbers: [1, 2] },
    );
  });

  await t.step("a proper subset applies", () => {
    assertEquals(
      validateSenseSelection(input, {
        senseApplicability: [
          { senseNumber: 1, classification: "no" },
          { senseNumber: 2, classification: "yes" },
        ],
      }),
      { outcome: "selected", senseNumbers: [2] },
    );
  });

  await t.step("an unresolved sense makes the result ambiguous", () => {
    assertEquals(
      validateSenseSelection(input, {
        senseApplicability: [
          { senseNumber: 1, classification: "yes" },
          { senseNumber: 2, classification: "unclear" },
        ],
      }),
      { outcome: "ambiguous", possibleSenseNumbers: [1, 2] },
    );
  });

  for (
    const [name, senseApplicability] of [
      ["missing", [{ senseNumber: 1, classification: "yes" }]],
      [
        "reordered",
        [
          { senseNumber: 2, classification: "yes" },
          { senseNumber: 1, classification: "no" },
        ],
      ],
      [
        "duplicate",
        [
          { senseNumber: 1, classification: "yes" },
          { senseNumber: 1, classification: "no" },
        ],
      ],
      [
        "out-of-range",
        [
          { senseNumber: 1, classification: "yes" },
          { senseNumber: 3, classification: "no" },
        ],
      ],
    ] as const
  ) {
    await t.step(`rejects ${name} decisions`, () => {
      assertThrows(
        () => validateSenseSelection(input, { senseApplicability: [...senseApplicability] }),
        Error,
        "expected exactly one decision for each compatibleSenseNumbers value in order [1,2]",
      );
    });
  }
});
