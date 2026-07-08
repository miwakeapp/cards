/** Shared fixtures: minimal JMdictWord builders and Miwake note snapshots for tests. */

import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import type { MiwakeNoteFields, MiwakeNoteSnapshot } from "../src/anki.ts";

export function makeWord(options: {
  id?: string;
  kanji?: string[];
  kana?: string[];
  senses: Array<{ glosses: string[]; partOfSpeech?: string[]; misc?: string[]; info?: string[] }>;
}): JMdictWord {
  return {
    id: options.id ?? "1000000",
    kanji: (options.kanji ?? ["言葉"]).map((text) => ({ common: true, text, tags: [] })),
    kana: (options.kana ?? ["ことば"]).map((text) => ({
      common: true,
      text,
      tags: [],
      appliesToKanji: ["*"],
    })),
    sense: options.senses.map((sense) => ({
      partOfSpeech: sense.partOfSpeech ?? ["n"],
      appliesToKanji: ["*"],
      appliesToKana: ["*"],
      related: [],
      antonym: [],
      field: [],
      dialect: [],
      misc: sense.misc ?? [],
      info: sense.info ?? [],
      languageSource: [],
      gloss: sense.glosses.map((text) => ({ lang: "eng", gender: null, type: null, text })),
    })),
  } as JMdictWord;
}

export function makeNote(
  fields: Partial<MiwakeNoteFields> & Pick<MiwakeNoteFields, "key" | "dictionaryEntry">,
): MiwakeNoteSnapshot {
  return {
    noteId: 1601969325935,
    tags: [],
    cards: [1601969325940],
    fields: {
      recognitionTarget: fields.key.split("|")[0].trim(),
      reading: "",
      hint: "",
      fullContext: "これは<mark>言葉</mark>のテストです。",
      minimizedContext: "",
      source: "",
      ...fields,
    },
  };
}
