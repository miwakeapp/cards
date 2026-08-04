import type { JMDictWord } from "data";

/** Human-readable provenance to store in the Miwake Card's `Source` field. */
export type CardSource =
  & {
    /**
     * A language tag accepted and canonicalized by `Intl.getCanonicalLocales()`, such as `ja` or
     * `en`.
     *
     * This is explicit rather than inferred from characters: a title's language cannot be reliably
     * determined from its script alone. The tag is canonicalized before being written to HTML.
     */
    lang: string;

    /**
     * A URL for the source, normalized with the platform `URL` parser.
     *
     * Any absolute scheme is allowed, including application deep links. The acquisition pipeline
     * decides whether a URL is suitable for the card. Its presence changes the Source field from a
     * `<span>` to an `<a>`.
     */
    url?: string;
  }
  & (
    | {
      /**
       * The exact final display label as plain text, without HTML.
       *
       * The caller chooses any title punctuation because only the acquisition pipeline knows what
       * kind of source this is. For example, pass `『虐殺器官』` for a Japanese book, `「記事名」` for
       * a Japanese article, or `Tatoeba` for an unquoted project name. `createCard()` preserves the
       * supplied label and escapes it for HTML.
       */
      text: string;

      /** Unavailable when `text` supplies the label. */
      html?: never;
    }
    | {
      /**
       * The exact final display label as trusted HTML.
       *
       * `createCard()` inserts this string verbatim, without parsing, escaping, validating, or
       * sanitizing it. Callers must never populate it with untrusted content. Use it only when the
       * label needs markup, such as `<span lang="ja">てごらん</span> (JLPT N3) | Bunpro`; prefer
       * `text` otherwise.
       */
      html: string;

      /** Unavailable when `html` supplies the label. */
      text?: never;
    }
  );

/**
 * Fully decided semantic content from which `createCard()` deterministically renders a Miwake
 * Card.
 *
 * This type deliberately contains no AI provider, raw page title, oversized source passage, or
 * other unresolved evidence. Different acquisition pipelines may use deterministic analysis, AI,
 * user input, or any combination of them, but they must settle those questions before calling
 * `createCard()`.
 */
export interface CreateCardInput {
  /**
   * The complete JMDict entry selected for this usage.
   *
   * Its `id` is used in the card key, its senses validate `applicableSenseNumbers`, and its forms
   * and readings validate source ruby and the requested `kanaReading`.
   */
  jmdictEntry: JMDictWord;

  /**
   * The nonempty, undecorated JMDict spelling selected for this card.
   *
   * It must exactly equal one of `jmdictEntry`'s kanji or kana spellings. It preserves the spelling
   * encountered in the source while remaining a dictionary form: source `匂いをかぎ` produces
   * `かぐ`, whereas source `匂いを嗅ぎ` produces `嗅ぐ`.
   *
   * Do not include `～` notation. When every selected sense is unambiguously a prefix or suffix,
   * `createCard()` adds the appropriate full-width marker to the rendered Recognition target and
   * Reading fields. The key always uses this undecorated spelling.
   */
  recognitionTarget: string;

  /**
   * The single JMDict-style kana reading selected for this usage.
   *
   * This is the unannotated pronunciation, such as `だいしょう`, not the Anki furigana stored in
   * the card's `Reading` field. `createCard()` validates it against `jmdictEntry` and source ruby,
   * then renders `MiwakeCard.reading` as precisely placed Anki furigana such as
   * `大[だい] 小[しょう]`.
   *
   * It is required when `recognitionTarget` selects one of `jmdictEntry.kanji`'s spellings,
   * including spellings that happen not to contain Han characters. It must exactly equal an
   * applicable `jmdictEntry.kana` spelling; search-only readings are valid. Omit it when
   * `recognitionTarget` itself selects a kana spelling. Source ruby may use the
   * hiragana/katakana-equivalent pronunciation and is validated separately.
   */
  kanaReading?: string;

  /**
   * The 1-indexed JMDict senses applicable to this usage.
   *
   * Omit this when every sense compatible with the selected spelling and reading applies. When
   * present, values must be unique compatible senses within the selected entry; ordering does not
   * affect the generated key. JMDict spelling and reading restrictions are always reflected in the
   * generated key, even when this is omitted.
   */
  applicableSenseNumbers?: readonly number[];

  /**
   * A minimal Japanese disambiguation hint.
   *
   * Omit this when the recognition target is sufficiently unambiguous. Card creation preserves
   * the supplied display text while escaping it for HTML; deciding whether a hint is
   * pedagogically necessary belongs to the acquisition pipeline.
   */
  hint?: string;

  /**
   * The authoritative, sanitized HTML stored in the `Full context` field.
   *
   * Callers are responsible for selecting complete, useful context, removing unsafe source
   * markup, and wrapping every intended target occurrence in an unadorned `<mark>`. At least one
   * mark is required. A mark may contain sanitized inline markup, including source `<ruby>`.
   * `createCard()` normalizes nonbreaking spaces and source ruby, redistributes whole-target ruby
   * to the precise JMDict-derived placement, and adds the spacing required by Anki's bracket-ruby
   * syntax.
   */
  fullContext: string;

  /**
   * A shorter, self-contained context for quick review.
   *
   * Omit this when the full context is already concise. The caller is responsible for ensuring
   * that a supplied context is meaningfully shorter than `fullContext`.
   */
  minimizedContext?: string;

  /** Final source metadata, or omitted when no reliable source is available. */
  source?: CardSource;
}

/**
 * A complete set of final, HTML-ready Anki field values for a Miwake Card.
 *
 * Plain-text input fields are HTML-escaped, while contexts and dictionary entries contain the
 * documented semantic markup. Callers should write these values directly to Anki without escaping
 * them again.
 */
export interface MiwakeCard {
  /**
   * The card's primary key: spelling, JMDict ID, and—when not all apply—sense numbers.
   *
   * Examples: `ひたと | 1430680 | 2,3` and `相性 | 1586070`.
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
   * Example: `大人[おとな] 買[が]い`. This is `null` when the recognition target selects a JMDict
   * kana form; JMDict `kanji` forms receive a Reading even when they contain no Han characters.
   */
  reading: string | null;

  /** The supplied disambiguation hint, or `null` when none was supplied. */
  hint: string | null;

  /** The full context with its supplied marks preserved and source ruby normalized. */
  fullContext: string;

  /** The processed minimized context, or `null` when none was supplied. */
  minimizedContext: string | null;

  /** Semantic HTML rendered from the complete selected JMDict entry. */
  dictionaryEntry: string;

  /** Rendered source HTML, or `null` when no source was supplied. */
  source: string | null;
}
