const SMALL_HIRAGANA_BY_FULL_SIZE_HIRAGANA = new Map([
  ["あ", "ぁ"],
  ["い", "ぃ"],
  ["う", "ぅ"],
  ["え", "ぇ"],
  ["お", "ぉ"],
  ["や", "ゃ"],
  ["ゆ", "ゅ"],
  ["よ", "ょ"],
  ["つ", "っ"],
  ["わ", "ゎ"],
  ["か", "ゕ"],
  ["け", "ゖ"],
]);

/**
 * Converts ordinary katakana to hiragana for kana-script-insensitive comparisons.
 *
 * This is a comparison key, not a canonical spelling: callers should retain the original text
 * for display and storage.
 */
export function toHiragana(text: string): string {
  return [...text].map((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint >= 0x30A1 && codePoint <= 0x30F6
      ? String.fromCodePoint(codePoint - 0x60)
      : character;
  }).join("");
}

/** Whether `text` contains at least one Han-script character. */
export function containsKanji(text: string): boolean {
  return /\p{Script=Han}/v.test(text);
}

/** Whether `text` consists of exactly one Han-script character. */
export function isKanji(text: string): boolean {
  return /^\p{Script=Han}$/v.test(text);
}

/**
 * Returns the ordinary small-kana counterpart of one full-size kana character.
 *
 * The result preserves hiragana versus katakana. This is the inverse of the common
 * `text-transform: full-size-kana` mappings used to make small ruby annotations more legible.
 * Returns `undefined` for a character with no ordinary small-kana counterpart.
 *
 * @throws {RangeError} If `character` does not contain exactly one Unicode code point.
 */
export function smallKanaForFullSizeKana(character: string): string | undefined {
  if ([...character].length !== 1) {
    throw new RangeError("character must contain exactly one Unicode code point");
  }

  const hiragana = toHiragana(character);
  const smallHiragana = SMALL_HIRAGANA_BY_FULL_SIZE_HIRAGANA.get(hiragana);
  if (smallHiragana === undefined) return undefined;

  const codePoint = character.codePointAt(0)!;
  return codePoint >= 0x30A1 && codePoint <= 0x30F6
    ? String.fromCodePoint(smallHiragana.codePointAt(0)! + 0x60)
    : smallHiragana;
}

/** Surface text and complete pronunciation parsed from plain Anki bracket-based furigana. */
export interface ParsedAnkiFurigana {
  /** Visible text after removing bracket annotations and their control spaces. */
  surface: string;
  /** Complete pronunciation after replacing annotated bases with their readings. */
  reading: string;
  /** Literal and annotated parts, with Anki's control spaces removed. */
  parts: readonly AnkiFuriganaPart[];
}

/** One literal or annotated part of plain Anki bracket-based furigana. */
export type AnkiFuriganaPart =
  | {
    /** Identifies literal text. */
    type: "plain";
    /** Literal surface text, which is also its pronunciation. */
    text: string;
  }
  | {
    /** Identifies an annotated ruby base. */
    type: "ruby";
    /** Visible ruby base. This can be empty for zero-surface annotations. */
    base: string;
    /** Pronunciation annotating the base. */
    reading: string;
  };

function parseAnkiFuriganaChunk(chunk: string): AnkiFuriganaPart[] | null {
  const open = chunk.indexOf("[");
  if (open === -1) {
    return chunk.includes("]") ? null : [{ type: "plain", text: chunk }];
  }
  const close = chunk.indexOf("]", open + 1);
  if (
    close === -1 || close === open + 1 ||
    chunk.indexOf("[", open + 1) !== -1 || chunk.indexOf("]", close + 1) !== -1
  ) return null;

  const base = chunk.slice(0, open);
  const annotation = chunk.slice(open + 1, close);
  const suffix = chunk.slice(close + 1);
  if (base === "") {
    return suffix === "" ? [{ type: "ruby", base: "", reading: annotation }] : null;
  }
  return [
    { type: "ruby", base, reading: annotation },
    ...(suffix === "" ? [] : [{ type: "plain" as const, text: suffix }]),
  ];
}

function parseAnkiFuriganaParts(text: string): AnkiFuriganaPart[] | null {
  const parts: AnkiFuriganaPart[] = [];
  for (const chunk of text.split(" ")) {
    if (chunk === "") return null;
    const parsed = parseAnkiFuriganaChunk(chunk);
    if (parsed === null) return null;
    parts.push(...parsed);
  }
  return parts;
}

/** Parses one plain Anki bracket-based furigana string. */
export function parseAnkiFurigana(text: string): ParsedAnkiFurigana | null {
  const parts = parseAnkiFuriganaParts(text);
  if (parts === null) return null;
  return {
    surface: parts.map((part) => part.type === "plain" ? part.text : part.base).join(""),
    reading: parts.map((part) => part.type === "plain" ? part.text : part.reading).join(""),
    parts,
  };
}
