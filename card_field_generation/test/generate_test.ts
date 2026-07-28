import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import type { JMDictWord } from "data";
import {
  buildSenseAndHintFewShotMessages,
  type SenseAndHintGenerationInput,
  validateGeneratedMinimizedContext,
  validateGeneratedSenseAndHint,
  validateGeneratedTargetInContext,
} from "../src/generate.ts";
import type { FewShotExample } from "../src/examples.ts";

function entry(): JMDictWord {
  return {
    id: "1234567",
    kanji: [],
    kana: [],
    sense: [{}, {}, {}],
  } as unknown as JMDictWord;
}

function input(): SenseAndHintGenerationInput {
  return {
    context: "その異名を知っている。",
    recognitionTarget: "異名",
    jmdictEntry: entry(),
    kanaReading: "いみょう",
    compatibleSenseNumbers: [1, 3],
  };
}

Deno.test("validateGeneratedSenseAndHint accepts and canonicalizes valid results", () => {
  assertEquals(
    validateGeneratedSenseAndHint(input(), {
      applicableSenses: null,
      hint: null,
    }),
    {
      applicableSenses: null,
      hint: null,
    },
  );
  assertEquals(
    validateGeneratedSenseAndHint(input(), {
      applicableSenses: [],
      hint: null,
    }),
    {
      applicableSenses: [],
      hint: null,
    },
  );
  assertEquals(
    validateGeneratedSenseAndHint(input(), {
      applicableSenses: [3, 1],
      hint: null,
    }),
    {
      applicableSenses: [],
      hint: null,
    },
  );
  assertEquals(
    validateGeneratedSenseAndHint(input(), {
      applicableSenses: [3],
      hint: "由来異名",
    }),
    {
      applicableSenses: [3],
      hint: "由来異名",
    },
  );
});

Deno.test("validateGeneratedSenseAndHint rejects invalid sense selections", () => {
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [2],
        hint: "由来異名",
      }),
    Error,
    "expected unique integers from compatibleSenseNumbers [1,3]",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [3, 3],
        hint: "由来異名",
      }),
    Error,
    "expected unique integers from compatibleSenseNumbers [1,3]",
  );
});

Deno.test("validateGeneratedSenseAndHint rejects invalid compatible sense evidence", () => {
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(
        {
          ...input(),
          compatibleSenseNumbers: [],
        },
        {
          applicableSenses: [],
          hint: null,
        },
      ),
    RangeError,
    "compatibleSenseNumbers must contain one or more unique integers between 1 and 3",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(
        {
          ...input(),
          compatibleSenseNumbers: [1, 1],
        },
        {
          applicableSenses: [],
          hint: null,
        },
      ),
    RangeError,
    "compatibleSenseNumbers must contain one or more unique integers between 1 and 3",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(
        {
          ...input(),
          compatibleSenseNumbers: [4],
        },
        {
          applicableSenses: [],
          hint: null,
        },
      ),
    RangeError,
    "compatibleSenseNumbers must contain one or more unique integers between 1 and 3",
  );
});

Deno.test("validateGeneratedSenseAndHint enforces the hint contract", () => {
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: null,
        hint: "由来異名",
      }),
    Error,
    "returned no applicable sense",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [],
        hint: "由来異名",
      }),
    Error,
    "selected every compatible sense",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [3],
        hint: null,
      }),
    Error,
    "returned no disambiguating hint",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [3],
        hint: "別名",
      }),
    Error,
    'does not contain recognitionTarget "異名" exactly',
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [3],
        hint: "異名",
      }),
    Error,
    "repeats recognitionTarget without disambiguating it",
  );
  assertThrows(
    () =>
      validateGeneratedSenseAndHint(input(), {
        applicableSenses: [3],
        hint: "異名あいうえおかき",
      }),
    Error,
    "at most 6 additional characters are allowed",
  );
  assertEquals(
    validateGeneratedSenseAndHint(input(), {
      applicableSenses: [3],
      hint: "異名あいうえおか",
    }),
    {
      applicableSenses: [3],
      hint: "異名あいうえおか",
    },
  );
});

Deno.test("narrow generation validators reject unusable model output", () => {
  assertEquals(
    validateGeneratedMinimizedContext(
      {
        fullContext: "長い<mark>文脈</mark>です。",
        recognitionTarget: "文脈",
      },
      "<mark>文脈</mark>です。",
    ),
    "<mark>文脈</mark>です。",
  );
  assertEquals(
    validateGeneratedMinimizedContext(
      {
        fullContext: "長い<mark>文脈</mark>です。",
        recognitionTarget: "文脈",
      },
      null,
    ),
    null,
  );
  assertThrows(
    () =>
      validateGeneratedMinimizedContext(
        {
          fullContext: "長い<mark>文脈</mark>です。",
          recognitionTarget: "文脈",
        },
        "文脈です。",
      ),
    Error,
    'recognitionTarget "文脈" does not contain a <mark> element',
  );

  assertEquals(
    validateGeneratedTargetInContext({ context: "我が身を曝した。" }, "曝し"),
    "曝し",
  );
  assertThrows(
    () => validateGeneratedTargetInContext({ context: "我が身をさらした。" }, "曝し"),
    Error,
    '"曝し" is not a nonempty literal substring',
  );
});

Deno.test("sense-and-hint few-shots demonstrate deterministic constraints", () => {
  const jmdictEntry = entry();
  const example: FewShotExample = {
    input: {
      context: "その異名を知っている。",
      recognitionTarget: "異名",
      jmdictEntry,
    },
    senseConstraints: {
      kanaReading: "いみょう",
      compatibleSenseNumbers: [1, 3],
    },
    output: {
      applicableSenses: [3],
      hint: "由来異名",
      reading: "いみょう",
      targetInContext: "異名",
      minimizedContext: null,
      cleanedSource: null,
      sourceURLIsPublic: false,
    },
  };
  const actualInput: SenseAndHintGenerationInput = {
    context: "実際の文。",
    recognitionTarget: "対象",
    jmdictEntry,
    kanaReading: "たいしょう",
    compatibleSenseNumbers: [2],
  };

  const messages = buildSenseAndHintFewShotMessages(actualInput, [example]);

  assertEquals(messages.length, 3);
  assertStringIncludes(messages[0].content, "Selected kana reading: いみょう");
  assertStringIncludes(
    messages[0].content,
    "Compatible sense numbers after JMDict spelling/reading restrictions: 1, 3",
  );
  assertEquals(messages[1].content, '{"applicableSenses":[3],"hint":"由来異名"}');
});
