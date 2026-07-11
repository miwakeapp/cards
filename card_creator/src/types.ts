/**
 * Input for creating a Miwake card.
 */
export interface CardCreationInput {
  /** HTML context containing the word usage. May include <ruby> for furigana. */
  context: string;

  /** The JMDict entry ID for the word being studied. */
  jmdictId: string;

  /**
   * The nonempty plain-text spelling being tested (e.g., "鋏" or "ハサミ"). Must not contain
   * surrounding whitespace, nonbreaking spaces, HTML markup, or HTML character references.
   */
  recognitionTarget: string;

  /** Optional source name (e.g., book title). */
  source?: string;

  /** Optional source URL. Folded into the Source HTML field if useful. */
  sourceURL?: string;
}

/**
 * A complete Miwake card with all fields populated.
 */
export interface MiwakeCard {
  /**
   * The card's primary key: spelling | JMDict ID | senses (if not all).
   * Example: "ひたと | 1430680 | 2,3" or "相性 | 1586070"
   */
  key: string;

  /** The spelling shown on the front of the card. */
  recognitionTarget: string;

  /**
   * The reading with Anki-style furigana placement.
   * Example: "大人[おとな] 買[が]い"
   * Null if the recognition target is kana-only.
   */
  reading: string | null;

  /**
   * Optional hint for disambiguation when multiple senses could apply.
   * A minimal Japanese phrase that clarifies which sense is intended.
   */
  hint: string | null;

  /** The full context sentence(s) with <mark> around the target word. */
  fullContext: string;

  /**
   * AI-trimmed minimal context, or null if no useful shorter version exists.
   */
  minimizedContext: string | null;

  /** Semantic HTML dictionary entry from jmdict_to_html. */
  dictionaryEntry: string;

  /** Source HTML, or null if no source is available. */
  source: string | null;
}

/**
 * The AI-generated portions of a Miwake card.
 * These are the fields that require LLM inference.
 */
export interface AIGeneratedFields {
  /** Which sense numbers (1-indexed) apply to this usage. Empty = all. */
  applicableSenses: number[];

  /** The correct reading for this context (kana only, no furigana formatting). */
  reading: string;

  /**
   * The plain-text exact substring from the context that corresponds to the recognition target.
   * Must follow the same plain-text invariants as the recognition target. May be a conjugated or
   * inflected form (e.g. "後ろめたさ" for target "後ろめたい").
   */
  targetInContext: string;

  /** Optional disambiguation hint. Null if not needed. */
  hint: string | null;

  /** Trimmed context sentence, or null if no useful shorter version exists. */
  minimizedContext: string | null;

  /** Cleaned source name, or null. */
  cleanedSource: string | null;

  /** Whether the source URL appears to be public/permanent. */
  sourceURLIsPublic: boolean;
}
