# Browser Extension Brainstorming

This document sketches how a future browser extension could turn a user encounter on a web page into the fully decided `CreateCardInput` accepted by `card_creator`. It is exploratory rather than a committed extension architecture.

## Boundary with `card_creator`

The extension should own acquisition and resolution. `card_creator` should remain deterministic and unaware of browser APIs, model providers, prompts, confidence scores, or raw page metadata.

The extension's job ends when it can supply:

- One selected JMDict entry.
- A source-faithful dictionary-form recognition target.
- One selected `kanaReading`, unless the recognition target selects a JMDict kana form.
- Applicable senses, or the fact that all senses apply.
- Final full context HTML.
- Optional final minimized context HTML.
- An optional hint.
- Final `CardSource` metadata with a language tag accepted by `Intl.getCanonicalLocales()`.

The initial implementation deliberately supports one reading from one JMDict entry. Equivalent entries and cards that accept several readings are deferred.

## Raw browser evidence

The dumbest useful capture stage could produce something like:

```ts
interface BrowserMiningEvidence {
  /**
   * Exact page text covered by the lookup. This is source evidence, not yet the
   * card's recognition target: it may be inflected or part of a larger expression.
   */
  encounteredText: string;

  /**
   * An unambiguous anchor for the clicked occurrence inside `surroundingHTML`.
   * Text offsets into a companion plain-text representation or inert sentinel
   * elements are preferable to searching for `encounteredText`, which may repeat.
   */
  occurrence: ContextOccurrence;

  /**
   * The exact JMDict entry chosen in the popup. Choosing an entry is trusted user
   * intent, although its spelling, reading, and applicable senses remain unresolved.
   */
  selectedEntry: JMDictWord;

  /**
   * A bounded, sanitized DOM excerpt around the occurrence. It can contain roughly
   * a page of prose and source `<ruby>`, but no scripts, event handlers, navigation,
   * advertisements, or unrelated page furniture.
   */
  surroundingHTML: string;

  /** The verbatim `document.title`, before source cleanup. */
  pageTitle: string;

  /** The page's resolved URL at the time of capture. */
  pageURL: string;
}
```

The occurrence anchor matters even though the eventual card marks every occurrence derived from the target. It identifies the encounter that controls context selection when the same surface appears in several distant places on the page.

The popup may eventually provide more evidence, such as the exact headword spelling or sense that the user clicked. Such evidence should be recorded explicitly rather than reconstructed from rendered popup HTML.

## Deterministic work before AI

The extension should narrow the problem before spending model tokens:

- Sanitize and normalize the captured DOM while preserving meaningful paragraphs and ruby.
- Map the occurrence into the normalized text.
- Search the selected entry's spellings and expressions against the clicked text.
- Deinflect and derive candidate dictionary forms.
- Preserve source orthography when selecting the recognition target.
- Extract and validate source ruby.
- Apply JMDict spelling, reading, and sense restrictions.
- Find every context surface supported by the selected recognition target.
- Classify obviously permanent public URLs and obviously private or temporary URLs.
- Apply cheap title-cleanup rules for known sites and reader suffixes.

This stage should produce explicit candidates and evidence, not silently guess when several materially different interpretations survive.

## AI responsibilities

AI is most useful after deterministic narrowing.

### Full-context selection

The model receives the sanitized surrounding passage, the anchored occurrence, the selected entry, and the deterministic target candidates. It selects the smallest contiguous source-faithful excerpt that is complete and clear.

The result must:

- Retain the anchored occurrence verbatim.
- Contain at least one complete sentence or natural complete utterance.
- Preserve source paragraph boundaries and ruby.
- Add adjacent sentences only when needed for references, short dialogue, or interpretation.
- Avoid unrelated prose merely because it shares a quotation or paragraph.

The model should identify the selected span, not rewrite it. Deterministic code then extracts the exact full-context HTML from the captured passage.

### Minimized context

When the full context is long, a second operation may produce a shorter self-contained sentence. Unlike full-context selection, this can rewrite grammar and remove clauses, so its output needs stronger validation.

The result must preserve the intended usage and include explicit target markers. The wrapper validates those markers and passes the marked HTML to `card_creator`; `card_creator` does not search serialized HTML to rediscover target occurrences.

### Sense, reading, and hint

JMDict restrictions and source ruby should run first. AI is needed only when multiple valid readings or senses remain after deterministic filtering.

For the current one-reading design, the wrapper must settle on exactly one kana reading and pass it as `CreateCardInput.kanaReading`. If it cannot do so confidently, the card should be flagged for review rather than smuggling ambiguity into `CreateCardInput`.

A hint is generated only when the resolved spelling and applicable senses would otherwise be impractical to distinguish on the front of the card.

### Source metadata

Known-site rules should clean common page-title suffixes first. AI can handle unknown title formats, but it should return structured source metadata:

```ts
interface ProposedSource {
  title: string;
  lang: string;
  kind: "book" | "article" | "plain";
  includeURL: boolean;
}
```

The wrapper validates and canonicalizes `lang` with `Intl.getCanonicalLocales()`, decides whether the URL policy accepts `pageURL`, applies `『』`, `「」`, or no punctuation according to `kind`, and then constructs `CardSource` with that exact display label. `card_creator` must not infer source kind from the language or the presence of a URL. Script detection alone is not a reliable substitute for an explicit language value.

## Validation after AI

AI output is a proposal, never trusted field HTML. Before calling `createCard`, the extension should verify:

- Selected source spans are exact contiguous extracts from sanitized page evidence.
- Every intended target occurrence is wrapped in an unadorned `<mark>` element in each context.
- Full context has valid paragraph and quotation boundaries.
- Minimized context is complete, materially shorter, and still contains the target.
- The recognition target is a dictionary form licensed by the selected entry, allowing only the project's documented source-orthography rules.
- `kanaReading` is applicable to the recognition target and selected entry.
- Sense numbers are unique and valid.
- A hint satisfies the current hint policy.
- Source text is nonempty, `lang` is accepted by `Intl.getCanonicalLocales()`, and any stored URL is permanent and public.

`createCard` repeats the invariants required for safe rendering. Wrapper validation should nevertheless report failures in terms useful to the user, instead of exposing a low-level renderer exception.

## Relationship to Animecards conversion

The Animecards converter is an early example of this wrapper architecture:

- Its raw evidence is a legacy Anki note rather than a DOM encounter.
- Its selected JMDict entry is recovered from glossary links or reviewed overrides.
- Its larger source passage comes from an EPUB corpus rather than a captured page.
- Existing fields provide extra reading and source evidence, but may be stale or malformed.
- Deterministic deinflection, source restoration, and ruby handling resolve most easy cards.
- AI is used for the remaining target ambiguity, source-context selection, sense selection, hints, and context minimization.

The converter does not need to be a reusable extension library. Its value is demonstrating that very different acquisition pipelines can converge on the same small, deterministic `card_creator` contract.
