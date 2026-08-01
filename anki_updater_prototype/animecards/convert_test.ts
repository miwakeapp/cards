import "../../data/test/use_jmdict_fixtures.ts";

import { assert, assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { preextractedJMDictEntry } from "data";
import { buildSpellingIndex } from "card_resolution";
import { convertAnimecardsNote } from "./convert.ts";
import type { AnkiNoteInfo, SourceFieldMapping } from "./types.ts";

const SOURCE_FIELDS: SourceFieldMapping = {
  word: "Word",
  sentence: "Sentence",
  glossary: "Glossary",
  reading: "Reading",
  source: "Source",
  sourceURL: "Source URL",
};

function makeWord(options: {
  id?: string;
  kanji?: string[];
  kana: string[];
  senses?: number;
  partOfSpeech?: string[];
}): JMdictWord {
  const sense = {
    partOfSpeech: options.partOfSpeech ?? ["v1"],
    appliesToKanji: ["*"],
    appliesToKana: ["*"],
    related: [],
    antonym: [],
    field: [],
    dialect: [],
    misc: [],
    info: [],
    languageSource: [],
    gloss: [{ lang: "eng", gender: null, type: null, text: "test gloss" }],
  };
  return {
    id: options.id ?? "1234567",
    kanji: (options.kanji ?? []).map((text) => ({ text, common: true, tags: [] })),
    kana: options.kana.map((text) => ({
      text,
      common: true,
      tags: [],
      appliesToKanji: ["*"],
    })),
    sense: Array.from({ length: options.senses ?? 1 }, () => ({ ...sense })),
  } as JMdictWord;
}

function makeNote(fields: Partial<Record<string, string>> = {}): AnkiNoteInfo {
  const values = {
    Word: "たべる",
    Sentence: "たべている。",
    Glossary: '<a href="https://jitendex.org/?q=1234567">definition</a>',
    Reading: "たべる",
    Source: "Test Book",
    "Source URL": "",
    ...fields,
  };
  return {
    noteId: 42,
    modelName: "Animecards",
    tags: ["mining"],
    cards: [99],
    fields: Object.fromEntries(
      Object.entries(values).map(([name, value], order) => [name, { value, order }]),
    ),
  };
}

Deno.test("convertAnimecardsNote deterministically converts and highlights an inflected target", async () => {
  const entry = makeWord({ kana: ["たべる"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(makeNote(), {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
  });

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(result.candidate.target.fields["Key"], "たべる | 1234567");
  assertEquals(result.candidate.target.fields["Recognition target"], "たべる");
  assertEquals(result.candidate.target.fields["Reading"], "");
  assertEquals(result.candidate.target.fields["Full context"], "<mark>たべて</mark>いる。");
  assertEquals(result.candidate.target.fields["Hint"], "");
  assertEquals(result.candidate.target.fields["Minimized context"], "");
  assertEquals(result.candidate.target.fields["Source"], '<span lang="en">Test Book</span>');
  assertEquals(result.candidate.original.cards, [99]);
  assertEquals(result.candidate.targetInContextResolution, {
    method: "deterministic",
    surface: "たべて",
  });
  assertEquals(result.candidate.senseSelectionContext, "たべている。");
});

Deno.test("convertAnimecardsNote marks only the resolved lexical occurrence in HTML", async () => {
  const entry = makeWord({ kana: ["なる"], partOfSpeech: ["v5r"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "なる",
      Reading: "なる",
      Sentence: "<p>彼の考えとは<ruby>異<rt>こと</rt></ruby>なるが、</p><p>結果はこうなる。</p>",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(
    result.candidate.target.fields["Full context"],
    "<p>彼の考えとは 異[こと]なるが、</p><p>結果はこう<mark>なる</mark>。</p>",
  );
});

Deno.test("convertAnimecardsNote declines a verb stem embedded in another lexical item", async () => {
  const entry = await preextractedJMDictEntry("1565480");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "嗅ぐ",
      Reading: "かぐ",
      Sentence: "嗅ぎ煙草を買った。",
      Glossary: '<a href="https://jitendex.org/?q=1565480">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "嗅ぐ",
    reason: "target-not-found-in-sentence",
    detail: "嗅ぐ",
  });
});

Deno.test("convertAnimecardsNote highlights every inflection of the target", async () => {
  const entry = await preextractedJMDictEntry("1597200");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "頼る",
      Reading: "たよる",
      Sentence: "同じように、頼ったり頼られたりすればいいと思うよ。",
      Glossary: '<a href="https://jitendex.org/?q=1597200">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(
    result.candidate.target.fields["Full context"],
    "同じように、<mark>頼ったり</mark><mark>頼られたり</mark>すればいいと思うよ。",
  );
  assertEquals(result.candidate.targetInContextResolution, {
    method: "deterministic",
    surface: "頼ったり",
    additionalSurfaces: ["頼られたり"],
  });
});

Deno.test("convertAnimecardsNote handles embedded whitespace in target surfaces", async () => {
  const entry = await preextractedJMDictEntry("1597200");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "頼る",
      Reading: "たよる",
      Sentence: "同じように、頼っ たり頼られたりすればいい。",
      Glossary: '<a href="https://jitendex.org/?q=1597200">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(
    result.candidate.target.fields["Full context"],
    "同じように、<mark>頼っ たり</mark><mark>頼られたり</mark>すればいい。",
  );
});

Deno.test("convertAnimecardsNote accepts an audited AI target override at every occurrence", async () => {
  const entry = await preextractedJMDictEntry("2548280");
  const entries = new Map([[entry.id, entry]]);
  const note = makeNote({
    Word: "のしのしと歩く",
    Reading: "のしのしとあるく",
    Sentence: "のっしのっしと歩いていった。また、のっしのっしと歩いていった。",
    Glossary: '<a href="https://jitendex.org/?q=2548280">definition</a>',
  });
  const options = {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
  };

  const unresolved = await convertAnimecardsNote(note, options);
  assertEquals(unresolved.skipped?.reason, "target-not-found-in-sentence");
  assert("unresolvedTargetInContext" in unresolved && unresolved.unresolvedTargetInContext);

  const result = await convertAnimecardsNote(note, {
    ...options,
    targetInContextOverride: {
      surface: "のっしのっしと歩いていった",
      model: "test-model",
      generatedAt: "2026-07-22T00:00:00.000Z",
    },
  });
  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(
    result.candidate.target.fields["Full context"],
    "<mark>のっしのっしと歩いていった</mark>。また、" +
      "<mark>のっしのっしと歩いていった</mark>。",
  );
  assertEquals(result.candidate.targetInContextResolution, {
    method: "ai",
    surface: "のっしのっしと歩いていった",
    model: "test-model",
    generatedAt: "2026-07-22T00:00:00.000Z",
  });
});

Deno.test("convertAnimecardsNote declines entries with multiple senses", async () => {
  const entry = await preextractedJMDictEntry("1414110");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "大小",
      Sentence: "この箱の大小によって値段が変わる。",
      Glossary: '<a href="https://jitendex.org/?q=1414110">definition</a>',
      Reading: "大小[だいしょう]",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "大小",
    reason: "multiple-jmdict-senses",
    detail: "6",
  });
});

Deno.test("convertAnimecardsNote retains opt-in multi-sense enrichment machinery", async () => {
  const entry = await preextractedJMDictEntry("1414110");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "大小",
      Sentence: "この箱の大小によって値段が変わる。",
      Glossary: '<a href="https://jitendex.org/?q=1414110">definition</a>',
      Reading: "大小[だいしょう]",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      includeMultipleSenses: true,
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.senseResolution, {
    status: "pending",
    compatibleSenses: [1, 2, 3, 4, 5, 6],
  });
});

Deno.test("convertAnimecardsNote keeps neighboring EPUB evidence separate from card context", async () => {
  const entry = makeWord({ kana: ["やがて"], senses: 3, partOfSpeech: ["adv"] });
  const entries = new Map([[entry.id, entry]]);
  const paragraphs = [
    {
      html: "長い時間が過ぎた。",
      plainText: "長い時間が過ぎた。",
      document: "chapter.xhtml",
      index: 0,
    },
    {
      html: "やがて必然となる。",
      plainText: "やがて必然となる。",
      document: "chapter.xhtml",
      index: 1,
    },
    {
      html: "物語はそこで終わる。",
      plainText: "物語はそこで終わる。",
      document: "chapter.xhtml",
      index: 2,
    },
  ];
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "やがて",
      Sentence: "やがて必然となる。",
      Glossary: '<a href="https://jitendex.org/?q=1234567">definition</a>',
      Reading: "やがて",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      includeMultipleSenses: true,
      epubSourceCorpus: {
        sources: [{
          name: "Test Book",
          documents: ["長い時間が過ぎた。やがて必然となる。物語はそこで終わる。"],
          paragraphs,
        }],
      },
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Full context"], "<mark>やがて</mark>必然となる。");
  assertEquals(
    result.candidate.senseSelectionContext,
    "長い時間が過ぎた。\n\nやがて必然となる。\n\n物語はそこで終わる。",
  );
});

Deno.test("convertAnimecardsNote accepts deterministically elided long dialogue", async () => {
  const entry = makeWord({ kana: ["たべる"] });
  const entries = new Map([[entry.id, entry]]);
  const targetParagraph =
    "ここには状況が十分にわかる説明があり、彼はゆっくりたべている。だからこの段落だけで意味が通じる。";
  const paragraphs = [
    {
      html: "「ずっと前から続いている長い話の冒頭。",
      plainText: "「ずっと前から続いている長い話の冒頭。",
      document: "chapter.xhtml",
      index: 0,
    },
    {
      html: targetParagraph,
      plainText: targetParagraph,
      document: "chapter.xhtml",
      index: 1,
    },
    {
      html: "さらに話は続く。",
      plainText: "さらに話は続く。",
      document: "chapter.xhtml",
      index: 2,
    },
    {
      html: "ようやく話が終わる。」",
      plainText: "ようやく話が終わる。」",
      document: "chapter.xhtml",
      index: 3,
    },
  ];
  const result = await convertAnimecardsNote(
    makeNote({ Sentence: "彼はゆっくりたべている。" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      epubSourceCorpus: {
        sources: [{
          name: "Test Book",
          documents: [paragraphs.map((paragraph) => paragraph.plainText).join("")],
          paragraphs,
        }],
      },
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.fullContextResolution, {
    status: "restored",
    method: "deterministic",
  });
  assertEquals(
    result.candidate.target.fields["Full context"],
    "「……ここには状況が十分にわかる説明があり、彼はゆっくり<mark>たべて</mark>いる。だからこの段落だけで意味が通じる。……」",
  );
});

Deno.test("convertAnimecardsNote resolves a multi-sense entry from JMDict restrictions", async () => {
  const entry = await preextractedJMDictEntry("1158110");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "異名",
      Sentence: "その異名を知っている。",
      Glossary: '<a href="https://jitendex.org/?q=1158110">definition</a>',
      Reading: "異名[いみょう]",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      includeMultipleSenses: true,
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields.Key, "異名 | 1158110 | 1");
  assertEquals(result.candidate.senseResolution, {
    status: "determined",
    applicableSenses: [1],
  });
});

Deno.test("convertAnimecardsNote uses an explicit override for multiple glossary entries", async () => {
  const first = makeWord({ id: "1111111", kana: ["のむ"] });
  const selected = makeWord({ id: "2222222", kana: ["たべる"] });
  const entries = new Map([[first.id, first], [selected.id, selected]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Glossary:
        '<a href="https://jitendex.org/?q=1111111">one</a><a href="https://jitendex.org/?q=2222222">two</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      jmdictIdOverride: selected.id,
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.jmdictId, "2222222");
  assertEquals(result.candidate.target.fields.Key, "たべる | 2222222");
});

Deno.test("convertAnimecardsNote declines a spelling shared by multiple JMDict entries", async () => {
  const selected = makeWord({ id: "1111111", kanji: ["業"], kana: ["ごう"], senses: 2 });
  const other = makeWord({ id: "2222222", kanji: ["業"], kana: ["わざ"] });
  const entries = new Map([[selected.id, selected], [other.id, other]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "業[ごう]",
      Sentence: "前世の業だ。",
      Glossary: '<a href="https://jitendex.org/?q=1111111">definition</a>',
      Reading: "ごう",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      resolveAmbiguousEntries: true,
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "業",
    reason: "ambiguous-jmdict-spelling",
    detail: "1111111, 2222222",
  });
  assert(result.unresolvedJMDictEntry);
  assertEquals(
    result.unresolvedJMDictEntry.candidateEntries.map(({ id }) => id),
    ["1111111", "2222222"],
  );
  assertEquals(result.unresolvedJMDictEntry.allowedJMDictIds, ["1111111"]);

  const resolved = await convertAnimecardsNote(
    makeNote({
      Word: "業[ごう]",
      Sentence: "前世の業だ。",
      Glossary: '<a href="https://jitendex.org/?q=1111111">definition</a>',
      Reading: "ごう",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      jmdictEntrySelectionOverride: {
        jmdictId: "1111111",
        recognitionTarget: "業",
        applicableSenseNumbers: [1],
        hint: "前世の業",
        model: "gemini-3.6-flash",
        generatedAt: "2026-07-27T00:00:00.000Z",
        candidateJMDictIds: ["1111111", "2222222"],
        allowedJMDictIds: ["1111111"],
      },
    },
  );
  assert(resolved.candidate);
  assertEquals(resolved.candidate.target.fields.Key, "業 | 1111111 | 1");
  assertEquals(resolved.candidate.target.fields.Hint, "前世の業");
  assertEquals(resolved.candidate.senseResolution, {
    status: "generated",
    model: "gemini-3.6-flash",
    generatedAt: "2026-07-27T00:00:00.000Z",
    compatibleSenses: [1, 2],
    applicableSenses: [1],
  });
  assertEquals(resolved.candidate.jmdictEntryResolution, {
    model: "gemini-3.6-flash",
    generatedAt: "2026-07-27T00:00:00.000Z",
    applicableSenseNumbers: [1],
    hint: "前世の業",
    candidateJMDictIds: ["1111111", "2222222"],
    allowedJMDictIds: ["1111111"],
  });
});

Deno.test("convertAnimecardsNote finds same-spelling entries across JMDict form categories", async () => {
  const nonKanaForm = makeWord({
    id: "1111111",
    kanji: ["かな"],
    kana: ["カナ"],
    partOfSpeech: ["n"],
  });
  const kanaForm = makeWord({
    id: "2222222",
    kana: ["かな"],
    partOfSpeech: ["n"],
  });
  const entries = new Map([[nonKanaForm.id, nonKanaForm], [kanaForm.id, kanaForm]]);

  const result = await convertAnimecardsNote(
    makeNote({
      Word: "かな",
      Sentence: "かなを比べる。",
      Glossary: "",
      Reading: "かな",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "かな",
    reason: "ambiguous-jmdict-match",
    detail: "1111111, 2222222",
  });
  assert(result.unresolvedJMDictEntry);
  assertEquals(
    result.unresolvedJMDictEntry.candidateEntries.map(({ id }) => id),
    ["1111111", "2222222"],
  );
});

Deno.test("convertAnimecardsNote lets a reviewed entry override replace a wrong glossary ID", async () => {
  const selected = makeWord({ id: "1111111", kanji: ["業"], kana: ["ごう"], senses: 2 });
  const wrong = makeWord({ id: "2222222", kanji: ["業"], kana: ["わざ"] });
  const entries = new Map([[selected.id, selected], [wrong.id, wrong]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "業[ごう]",
      Sentence: "前世の業だ。",
      Glossary: '<a href="https://jitendex.org/?q=2222222">wrong definition</a>',
      Reading: "ごう",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      jmdictIdOverride: selected.id,
      jmdictEntrySelectionOverride: {
        jmdictId: selected.id,
        recognitionTarget: "業",
        applicableSenseNumbers: [1],
        hint: "前世の業",
        model: "gemini-3.6-flash",
        generatedAt: "2026-07-28T00:00:00.000Z",
        candidateJMDictIds: [selected.id, wrong.id],
        allowedJMDictIds: [selected.id],
      },
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.jmdictId, selected.id);
  assertEquals(result.candidate.target.fields.Key, "業 | 1111111 | 1");
  assertEquals(result.candidate.target.fields.Hint, "前世の業");
});

Deno.test("convertAnimecardsNote exposes Jitendex-merged glossary entries for selection", async () => {
  const first = makeWord({ id: "1111111", kana: ["チャック"], partOfSpeech: ["n"] });
  const second = makeWord({ id: "2222222", kana: ["チャック"], partOfSpeech: ["n"] });
  const entries = new Map([[first.id, first], [second.id, second]]);
  const note = makeNote({
    Word: "チャック",
    Sentence: "チャックを閉めた。",
    Glossary: '<a href="https://jitendex.org/?q=1111111">zipper</a>' +
      '<a href="https://jitendex.org/?q=2222222">lathe chuck</a>',
    Reading: "チャック",
  });
  const options = {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
  };

  const unresolved = await convertAnimecardsNote(note, options);
  assertEquals(unresolved.skipped, {
    noteId: 42,
    word: "チャック",
    reason: "multiple-jmdict-ids",
    detail: "1111111, 2222222",
  });
  assert(unresolved.unresolvedJMDictEntry);
  assertEquals(unresolved.unresolvedJMDictEntry.recognitionTarget, "チャック");
  assertEquals(unresolved.unresolvedJMDictEntry.kanaReading, "チャック");
  assertEquals(unresolved.unresolvedJMDictEntry.allowedJMDictIds, ["1111111", "2222222"]);

  const resolved = await convertAnimecardsNote(note, {
    ...options,
    jmdictEntrySelectionOverride: {
      jmdictId: "1111111",
      recognitionTarget: "チャック",
      applicableSenseNumbers: [1],
      hint: "服のチャック",
      model: "gemini-3.6-flash" as const,
      generatedAt: "2026-07-27T00:00:00.000Z",
      candidateJMDictIds: ["1111111", "2222222"],
      allowedJMDictIds: ["1111111", "2222222"],
    },
  });
  assert(resolved.candidate);
  assertEquals(resolved.candidate.target.fields.Key, "チャック | 1111111");
  assertEquals(resolved.candidate.target.fields.Hint, "服のチャック");
  assertEquals(
    resolved.candidate.target.fields["Full context"],
    "<mark>チャック</mark>を閉めた。",
  );
});

Deno.test("convertAnimecardsNote omits an entry-selection hint for an affix target", async () => {
  const suffix = makeWord({
    id: "1111111",
    kana: ["ヅラ"],
    partOfSpeech: ["n-suf"],
  });
  const noun = makeWord({
    id: "2222222",
    kana: ["ヅラ"],
    partOfSpeech: ["n"],
  });
  const entries = new Map([[suffix.id, suffix], [noun.id, noun]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "~ヅラ",
      Sentence: "野武士ヅラが似合っている。",
      Glossary: '<a href="https://jitendex.org/?q=1111111">suffix</a>' +
        '<a href="https://jitendex.org/?q=2222222">noun</a>',
      Reading: "ヅラ",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      jmdictEntrySelectionOverride: {
        jmdictId: suffix.id,
        recognitionTarget: "ヅラ",
        applicableSenseNumbers: [1],
        hint: "野武士ヅラ",
        model: "gemini-3.6-flash",
        generatedAt: "2026-07-28T00:00:00.000Z",
        candidateJMDictIds: [suffix.id, noun.id],
        allowedJMDictIds: [suffix.id, noun.id],
      },
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Recognition target"], "～ヅラ");
  assertEquals(result.candidate.target.fields.Hint, "");
  assertEquals(result.candidate.jmdictEntryResolution?.hint, null);
});

Deno.test("convertAnimecardsNote retains a hint when another entry has the same affix pattern", async () => {
  const selected = makeWord({
    id: "1111111",
    kana: ["ヅラ"],
    partOfSpeech: ["n-suf"],
  });
  const otherSuffix = makeWord({
    id: "2222222",
    kana: ["ヅラ"],
    partOfSpeech: ["n-suf"],
  });
  const entries = new Map([[selected.id, selected], [otherSuffix.id, otherSuffix]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "~ヅラ",
      Sentence: "野武士ヅラが似合っている。",
      Glossary: '<a href="https://jitendex.org/?q=1111111">first suffix</a>' +
        '<a href="https://jitendex.org/?q=2222222">second suffix</a>',
      Reading: "ヅラ",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      jmdictEntrySelectionOverride: {
        jmdictId: selected.id,
        recognitionTarget: "ヅラ",
        applicableSenseNumbers: [1],
        hint: "野武士ヅラ",
        model: "gemini-3.6-flash",
        generatedAt: "2026-07-28T00:00:00.000Z",
        candidateJMDictIds: [selected.id, otherSuffix.id],
        allowedJMDictIds: [selected.id, otherSuffix.id],
      },
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Recognition target"], "～ヅラ");
  assertEquals(result.candidate.target.fields.Hint, "野武士ヅラ");
  assertEquals(result.candidate.jmdictEntryResolution?.hint, "野武士ヅラ");
});

Deno.test("convertAnimecardsNote declines a bracketed recognition-target hint", async () => {
  const entry = makeWord({ kanji: ["懐"], kana: ["ふところ"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "懐 [懐に飛び込んでくる]",
      Sentence: "相手の懐に飛び込んでくる。",
      Reading: "ふところ",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "懐",
    reason: "recognition-target-hint",
    detail: "懐 [懐に飛び込んでくる]",
  });
});

Deno.test("convertAnimecardsNote declines unresolved multiple readings", async () => {
  const entry = makeWord({ kanji: ["生"], kana: ["せい", "しょう"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "生", Sentence: "生の情報", Reading: "" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped?.reason, "ambiguous-reading");
});

Deno.test("convertAnimecardsNote lets marked source ruby select the JMDict reading", async () => {
  const entry = makeWord({ kanji: ["生"], kana: ["せい", "しょう"], partOfSpeech: ["n"] });
  const entries = new Map([[entry.id, entry]]);
  const options = {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
  };

  for (const Reading of ["", "せい"]) {
    const result = await convertAnimecardsNote(
      makeNote({
        Word: "生",
        Sentence: "<ruby>生<rt>しょう</rt></ruby>の情報",
        Reading,
      }),
      options,
    );

    assert(result.candidate);
    assertEquals(result.candidate.readingKana, "しょう");
    assertEquals(result.candidate.target.fields.Reading, "生[しょう]");
    assertEquals(
      result.candidate.target.fields["Full context"],
      "<mark>生[しょう]</mark>の情報",
    );
  }
});

Deno.test("convertAnimecardsNote uses an exact existing reading among script variants", async () => {
  const entry = makeWord({ kana: ["ニヤニヤ", "にやにや"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "にやにや", Sentence: "にやにやしている。", Reading: "にやにや" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Full context"], "<mark>にやにや</mark>している。");
});

Deno.test("convertAnimecardsNote prefers an exact kana target among script variants", async () => {
  const entry = makeWord({ kana: ["まぐれ", "マグレ"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "まぐれ", Sentence: "まぐれだった。", Reading: "" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Full context"], "<mark>まぐれ</mark>だった。");
});

Deno.test("convertAnimecardsNote accepts equivalent JMDict readings in different kana scripts", async () => {
  const entry = await preextractedJMDictEntry("1049180");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "珈琲",
      Sentence: "珈琲を飲む。",
      Reading: "こーひー",
      Glossary: '<a href="https://jitendex.org/?q=1049180">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.readingKana, "コーヒー");
  assertEquals(result.candidate.target.fields["Reading"], "珈[コー] 琲[ヒー]");
  assertEquals(result.candidate.target.fields["Full context"], "<mark>珈琲</mark>を飲む。");
});

Deno.test("convertAnimecardsNote prefers a canonical reading over a search-only script variant", async () => {
  const entry = await preextractedJMDictEntry("2195830");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "ドン引き",
      Sentence: "全員がドン引きした。",
      Reading: "ドンびき",
      Glossary: '<a href="https://jitendex.org/?q=2195830">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      includeMultipleSenses: true,
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.readingKana, "どんびき");
  assertEquals(result.candidate.target.fields["Reading"], "ドン 引[び]き");
  assertEquals(result.candidate.target.fields["Full context"], "全員が<mark>ドン引き</mark>した。");
});

Deno.test("convertAnimecardsNote keys a kana-script swap with the source spelling", async () => {
  const entry = makeWord({ kana: ["いざこざ", "イザコザ"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "イザコザ",
      Sentence: "そんないざこざがあった。",
      Reading: "イザコザ",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.recognitionTarget, "いざこざ");
  assertEquals(result.candidate.keyRecognitionTarget, "いざこざ");
  assertEquals(result.candidate.target.fields.Key, "いざこざ | 1234567");
  assertEquals(
    result.candidate.target.fields["Full context"],
    "そんな<mark>いざこざ</mark>があった。",
  );
});

Deno.test("convertAnimecardsNote checks ambiguity after adopting the source spelling", async () => {
  const selected = makeWord({ id: "1111111", kana: ["いざこざ", "イザコザ"] });
  const other = makeWord({ id: "2222222", kana: ["いざこざ"] });
  const entries = new Map([[selected.id, selected], [other.id, other]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "イザコザ",
      Sentence: "そんないざこざがあった。",
      Glossary: '<a href="https://jitendex.org/?q=1111111">definition</a>',
      Reading: "イザコザ",
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "イザコザ",
    reason: "ambiguous-jmdict-spelling",
    detail: "1111111, 2222222",
  });
});

Deno.test("convertAnimecardsNote adopts a kana dictionary spelling from an inflected source", async () => {
  const entry = makeWord({
    kanji: ["嗅ぐ"],
    kana: ["かぐ"],
    partOfSpeech: ["v5g", "vt"],
  });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "嗅ぐ", Sentence: "匂いをかぎ", Reading: "かぐ" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.recognitionTarget, "かぐ");
  assertEquals(result.candidate.keyRecognitionTarget, "かぐ");
  assertEquals(result.candidate.target.fields["Key"], "かぐ | 1234567");
  assertEquals(result.candidate.target.fields["Recognition target"], "かぐ");
  assertEquals(result.candidate.target.fields["Reading"], "");
  assertEquals(result.candidate.target.fields["Full context"], "匂いを<mark>かぎ</mark>");
});

Deno.test("convertAnimecardsNote restores and highlights repeated targets in one sentence", async () => {
  const entry = makeWord({
    kanji: ["嗅ぐ"],
    kana: ["かぐ"],
    partOfSpeech: ["v5g", "vt"],
  });
  const entries = new Map([[entry.id, entry]]);
  const paragraph = {
    html: "前文。男は匂いをかぎ、それからもう一度匂いをかぎ、首をかしげた。後文。",
    plainText: "前文。男は匂いをかぎ、それからもう一度匂いをかぎ、首をかしげた。後文。",
    document: "test.xhtml",
    index: 0,
  };
  const result = await convertAnimecardsNote(
    makeNote({ Word: "嗅ぐ", Sentence: "匂いをかぎ", Reading: "かぐ" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      epubSourceCorpus: {
        sources: [{
          name: "Test Book",
          documents: [paragraph.plainText],
          paragraphs: [paragraph],
        }],
      },
    },
  );

  assert(result.candidate);
  assertEquals(
    result.candidate.target.fields["Full context"],
    "男は匂いを<mark>かぎ</mark>、それからもう一度匂いを<mark>かぎ</mark>、首をかしげた。",
  );
  assertEquals(result.candidate.fullContextResolution, {
    status: "pending",
    source: "Test Book",
    requiredContextHTML: "男は匂いをかぎ、それからもう一度匂いをかぎ、首をかしげた。",
  });
});

Deno.test("convertAnimecardsNote retains a kanji dictionary spelling used by the source", async () => {
  const entry = await preextractedJMDictEntry("1565480");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "嗅ぐ",
      Sentence: "匂いを嗅ぎ",
      Reading: "かぐ",
      Glossary: '<a href="https://jitendex.org/?q=1565480">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(result.candidate.recognitionTarget, "嗅ぐ");
  assertEquals(result.candidate.keyRecognitionTarget, "嗅ぐ");
  assertEquals(result.candidate.target.fields["Key"], "嗅ぐ | 1565480");
  assertEquals(result.candidate.target.fields["Recognition target"], "嗅ぐ");
  assertEquals(result.candidate.target.fields["Full context"], "匂いを<mark>嗅ぎ</mark>");
});

Deno.test("convertAnimecardsNote rejects source spellings missing from JMDict", async () => {
  const entry = makeWord({
    kana: ["グズる"],
    partOfSpeech: ["v5r"],
  });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "グズる", Sentence: "いつまでもぐずっている。", Reading: "グズる" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "グズる",
    reason: "jmdict-target-mismatch",
    detail:
      'recognitionTarget "ぐずる" is not among the jmdictEntry.kanji spellings or jmdictEntry.kana readings in jmdictEntry with id "1234567"',
  });
});

Deno.test("convertAnimecardsNote cleans reader sources and records private URLs", async () => {
  const entry = makeWord({ kana: ["たべる"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Source: "舟を編む | Miwake Reader",
      "Source URL":
        '<a href="https://reader.miwake.app/b?id&#x3D;15">https://reader.miwake.app/b?id=15</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.approved, false);
  assertEquals(result.candidate.fullContextResolution, { status: "source-unavailable" });
  assertEquals(result.candidate.target.fields.Source, '<span lang="ja">『舟を編む』</span>');
  assertEquals(result.candidate.sourceResolution, {
    name: "舟を編む",
    method: "source-field",
    url: "https://reader.miwake.app/b?id=15",
    urlIsPublic: false,
  });
});

Deno.test("convertAnimecardsNote recovers a missing source from the EPUB corpus", async () => {
  const entry = makeWord({ kana: ["たべる"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(makeNote({ Source: "" }), {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
    epubSourceCorpus: {
      sources: [
        {
          name: "テスト小説",
          documents: ["彼はたべている。それから眠った。"],
          paragraphs: [{
            html: "彼はたべている。それから眠った。",
            plainText: "彼はたべている。それから眠った。",
            document: "test.xhtml",
            index: 0,
          }],
        },
        { name: "別の本", documents: ["関係のない文章。"] },
      ],
    },
  });

  assert(result.candidate);
  assertEquals(result.candidate.approved, true);
  assertEquals(result.candidate.target.fields.Source, '<span lang="ja">『テスト小説』</span>');
  assertEquals(result.candidate.sourceResolution.method, "epub");
  assertEquals(result.candidate.fullContextResolution, {
    status: "pending",
    source: "テスト小説",
    requiredContextHTML: "彼はたべている。",
  });
});

Deno.test("convertAnimecardsNote preserves semantic EPUB paragraph boundaries", async () => {
  const entry = await preextractedJMDictEntry("1313600");
  const entries = new Map([[entry.id, entry]]);
  const paragraphs = [
    {
      html: "「婚活ですよ」",
      plainText: "「婚活ですよ」",
      document: "test.xhtml",
      index: 0,
    },
    {
      html: "と事もなげに答えた。",
      plainText: "と事もなげに答えた。",
      document: "test.xhtml",
      index: 1,
    },
  ];
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "事もなげに",
      Reading: "こともなげに",
      Sentence: "「婚活ですよ」<br><br>と事もなげに答えた。",
      Glossary: '<a href="https://jitendex.org/?q=1313600">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      epubSourceCorpus: {
        sources: [{
          name: "Test Book",
          documents: ["「婚活ですよ」と事もなげに答えた。"],
          paragraphs,
        }],
      },
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(
    result.candidate.target.fields["Full context"],
    [
      "<p>「婚活ですよ」</p>",
      "",
      "<p>と<mark>事もなげに</mark>答えた。</p>",
    ].join("\n"),
  );
});

Deno.test("convertAnimecardsNote expands a truncated EPUB excerpt to reach its target", async () => {
  const entry = await preextractedJMDictEntry("2188630");
  const entries = new Map([[entry.id, entry]]);
  const paragraph = {
    html:
      "前文。だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか見当もつかないが）使用されることは、お勧めしかねる。後文。",
    plainText:
      "前文。だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか見当もつかないが）使用されることは、お勧めしかねる。後文。",
    document: "test.xhtml",
    index: 0,
  };
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "見当もつかない",
      Reading: "けんとうもつかない",
      Sentence: "だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、",
      Glossary: '<a href="https://jitendex.org/?q=2188630">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      epubSourceCorpus: {
        sources: [{ name: "Test Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
      },
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(result.candidate.fullContextResolution, {
    status: "pending",
    source: "Test Book",
    requiredContextHTML:
      "だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか見当もつかないが）使用されることは、お勧めしかねる。",
  });
  assertEquals(
    result.candidate.target.fields["Full context"],
    "だから読者諸氏が、ここに述べられたことを裁判の証拠品みたいなかたちで、（それがどのような商取引なのか<mark>見当もつかない</mark>が）使用されることは、お勧めしかねる。",
  );
});

Deno.test("convertAnimecardsNote recovers a one-kanji target from the adjacent EPUB sentence", async () => {
  const entry = makeWord({ kanji: ["釘"], kana: ["くぎ"], partOfSpeech: ["n"] });
  const entries = new Map([[entry.id, entry]]);
  const paragraph = {
    html:
      "前文。その間、俺は文字通り一睡もしなかった。<ruby><rb>鉄</rb><rt>てつ</rt><rb>釘</rb><rt>くぎ</rt></ruby>を打たれるような頭痛に襲われた。後文。",
    plainText:
      "前文。その間、俺は文字通り一睡もしなかった。鉄釘を打たれるような頭痛に襲われた。後文。",
    document: "test.xhtml",
    index: 0,
  };
  const result = await convertAnimecardsNote(
    makeNote({ Word: "釘", Reading: "くぎ", Sentence: "その間、俺は文字通り一睡もしなかった。" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      epubSourceCorpus: {
        sources: [{ name: "Test Book", documents: [paragraph.plainText], paragraphs: [paragraph] }],
      },
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.fullContextResolution, {
    status: "pending",
    source: "Test Book",
    requiredContextHTML:
      "その間、俺は文字通り一睡もしなかった。<ruby><rb>鉄</rb><rt>てつ</rt><rb>釘</rb><rt>くぎ</rt></ruby>を打たれるような頭痛に襲われた。",
  });
  assertEquals(
    result.candidate.target.fields["Full context"],
    "その間、俺は文字通り一睡もしなかった。 鉄[てつ]<mark>釘[くぎ]</mark>を打たれるような頭痛に襲われた。",
  );
});

Deno.test("convertAnimecardsNote normalizes and preserves a leading JMDict notation marker", async () => {
  const entry = makeWord({ kana: ["まがい"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "~まがい", Sentence: "ストーカーまがいのこと", Reading: "まがい" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.recognitionTarget, "～まがい");
  assertEquals(result.candidate.recognitionTarget.codePointAt(0), 0xFF5E);
  assertEquals(result.candidate.target.fields["Recognition target"].codePointAt(0), 0xFF5E);
  assertEquals(result.candidate.target.fields.Key, "まがい | 1234567");
  assertEquals(
    result.candidate.target.fields["Full context"],
    "ストーカー<mark>まがい</mark>のこと",
  );
});

Deno.test("convertAnimecardsNote normalizes and preserves a trailing JMDict notation marker", async () => {
  const entry = makeWord({ kanji: ["曽"], kana: ["そう"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "曽〜", Sentence: "曽じいさんの形見", Reading: "そう" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.recognitionTarget, "曽～");
  assertEquals(result.candidate.target.fields.Key, "曽 | 1234567");
  assertEquals(result.candidate.target.fields.Reading, "曽[そう]～");
  assertEquals(result.candidate.target.fields["Full context"], "<mark>曽</mark>じいさんの形見");
});

Deno.test("convertAnimecardsNote ignores notation markers in the legacy reading field", async () => {
  const entry = await preextractedJMDictEntry("1414110");
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({
      Word: "大小～",
      Sentence: "大小を見る。",
      Reading: "だいしょう～",
      Glossary: '<a href="https://jitendex.org/?q=1414110">definition</a>',
    }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
      includeMultipleSenses: true,
    },
  );

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(result.candidate.readingKana, "だいしょう");
  assertEquals(result.candidate.recognitionTarget, "大小～");
  assertEquals(result.candidate.target.fields.Key, "大小 | 1414110");
});

Deno.test("convertAnimecardsNote leaves notes without a source for a later pass", async () => {
  const entry = makeWord({ kana: ["たべる"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(makeNote({ Source: "" }), {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
  });

  assertEquals(result.skipped?.reason, "no-source");
});

Deno.test("convertAnimecardsNote explicitly accepts a source-less note's original context", async () => {
  const entry = makeWord({ kana: ["たべる"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(makeNote({ Source: "" }), {
    sourceModel: "Animecards",
    targetModel: "Miwake",
    sourceFields: SOURCE_FIELDS,
    entries,
    spellingIndex: buildSpellingIndex(entries.values()),
    includeSourceless: true,
  });

  assert(result.candidate, JSON.stringify(result.skipped));
  assertEquals(result.candidate.approved, true);
  assertEquals(result.candidate.sourceResolution, {
    name: null,
    method: "none",
    url: null,
    urlIsPublic: false,
  });
  assertEquals(result.candidate.fullContextResolution, {
    status: "restored",
    method: "original",
  });
  assertEquals(result.candidate.target.fields["Full context"], "<mark>たべて</mark>いる。");
  assertEquals(result.candidate.target.fields["Minimized context"], "");
  assertEquals(result.candidate.target.fields.Source, "");
});
