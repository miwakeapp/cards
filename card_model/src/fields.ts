/**
 * A complete set of final, HTML-ready Anki field values for a Miwake Card.
 *
 * Plain-text input fields are HTML-escaped, while contexts and dictionary entries contain their
 * documented semantic markup. Consumers should write these values directly to Anki without
 * escaping them again.
 */
export interface CardFields {
  /**
   * The card's semantic key: spelling and one or more equivalent JMDict entry/sense usages.
   *
   * Entry IDs and sense numbers are sorted, so equivalent usage sets have one representation.
   * Examples: `ひたと | 1430680:2,3` and `後々 | 1578610;2841372`.
   */
  key: string;

  /**
   * The dictionary-form spelling shown on the front of the card.
   *
   * This can contain automatically derived leading or trailing `～` notation. Users may edit the
   * field afterward to add more specific notation without changing the card key.
   */
  recognitionTarget: string;

  /**
   * The recognition target with precisely placed Anki-style bracket ruby.
   *
   * Example: `大人[おとな] 買[が]い`. Several accepted readings repeat the spelling as direct
   * `<li>` children of a `<ul>`, while a single reading remains plain text. This is `null` when the
   * recognition target selects a JMDict kana form; JMDict `kanji` forms receive a Reading even
   * when they contain no Han characters.
   */
  reading: string | null;

  /** The supplied disambiguation hint, or `null` when none was supplied. */
  hint: string | null;

  /** The full context with its supplied marks preserved and source ruby normalized. */
  fullContext: string;

  /** The processed minimized context, or `null` when none was supplied. */
  minimizedContext: string | null;

  /** Wrapped semantic HTML for every distinct JMDict entry encoded in the Key. */
  dictionary: string;

  /** Rendered source HTML, or `null` when no source was supplied. */
  source: string | null;
}

/** Canonical Anki field names keyed by their programmatic field names. */
export const fieldNames = {
  key: "Key",
  recognitionTarget: "Recognition target",
  reading: "Reading",
  hint: "Hint",
  fullContext: "Full context",
  minimizedContext: "Minimized context",
  dictionary: "Dictionary",
  source: "Source",
} as const satisfies Record<keyof CardFields, string>;

/** One canonical Anki field name in the Miwake note model. */
export type FieldName = (typeof fieldNames)[keyof typeof fieldNames];

/** Canonical Anki field names in model order. */
export const fieldOrder: readonly FieldName[] = Object.values(fieldNames);
