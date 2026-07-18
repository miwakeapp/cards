import "../../data/test/use_furigana_fixture.ts";

import { assert, assertEquals } from "@std/assert";
import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { preextractedJMDictEntry } from "data";
import { buildSpellingIndex } from "../shared/jmdict_resolution/recognition_target_lookup.ts";
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

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Key"], "たべる | 1234567");
  assertEquals(result.candidate.target.fields["Recognition target"], "たべる");
  assertEquals(result.candidate.target.fields["Reading"], "");
  assertEquals(result.candidate.target.fields["Full context"], "<mark>たべて</mark>いる。");
  assertEquals(result.candidate.target.fields["Hint"], "");
  assertEquals(result.candidate.target.fields["Minimized context"], "");
  assertEquals(result.candidate.target.fields["Source"], '<cite lang="en">Test Book</cite>');
  assertEquals(result.candidate.original.cards, [99]);
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
  assertEquals(result.candidate.senseResolution, { status: "pending" });
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
  const selected = makeWord({ id: "1111111", kanji: ["業"], kana: ["ごう"] });
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
    },
  );

  assertEquals(result.skipped, {
    noteId: 42,
    word: "業",
    reason: "ambiguous-jmdict-spelling",
    detail: "1111111, 2222222",
  });
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
  const entry = makeWord({ kanji: ["ダメ元"], kana: ["だめもと", "ダメモト"] });
  const entries = new Map([[entry.id, entry]]);
  const result = await convertAnimecardsNote(
    makeNote({ Word: "ダメ元", Sentence: "ダメ元で頼む。", Reading: "ダメもと" }),
    {
      sourceModel: "Animecards",
      targetModel: "Miwake",
      sourceFields: SOURCE_FIELDS,
      entries,
      spellingIndex: buildSpellingIndex(entries.values()),
    },
  );

  assert(result.candidate);
  assertEquals(result.candidate.target.fields["Full context"], "<mark>ダメ元</mark>で頼む。");
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

Deno.test("convertAnimecardsNote falls back to a deterministic godan kana stem", async () => {
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
  assertEquals(result.candidate.target.fields["Full context"], "匂いを<mark>かぎ</mark>");
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
  assertEquals(result.candidate.target.fields.Source, '<cite lang="ja">舟を編む</cite>');
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
  assertEquals(result.candidate.target.fields.Source, '<cite lang="ja">テスト小説</cite>');
  assertEquals(result.candidate.sourceResolution.method, "epub");
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
