# Card Resolution

Provides deterministic building blocks used while resolving source evidence into final `card_creator` input.

The package currently owns three related responsibilities:

- Recognition-target lookup derives dictionary spellings from encountered text and locates the exact inflected occurrences of an already-selected JMDict spelling. JMDict part-of-speech tags guide deterministic conjugation, with Kuromoji used both to validate lexical boundaries and to provide fallback candidates around uncertain token boundaries.
- Context markup wraps those exact source occurrences in `<mark>` while preserving structured HTML, paragraph boundaries, and complete ruby annotation components.
- Generation-safe context adaptation replaces marked HTML with occurrence-addressed plain-text sentinels, projects Anki bracket furigana to visible text when needed for comparison, then validates and restores model-selected target markup without exposing HTML to the model.

```ts
import { resolveContextTarget } from "card_resolution";

const resolved = await resolveContextTarget(
  "<p>同じように、頼ったり頼られたりすればいい。</p>",
  "頼る",
  { partOfSpeech: ["v5r"] },
);
if (resolved === null) {
  throw new Error("The selected spelling does not occur in the source context");
}
const markedContext = resolved.markedHTML;
```

`resolveContextTarget()` is the preferred integration boundary: lookup and HTML rewriting share the same rendered-text projection and retain occurrence ranges, so an identical surface belonging to a different lexical item is not marked accidentally. Lower-level plain-text lookup and explicit-range markup remain available for callers that already own an equivalent occurrence-preserving boundary.

Workflows consuming an existing marked context can call `verifyMarkedContextTarget()` before semantic processing. It checks every stored mark against the same tokenizer-backed resolution engine, ignores display-only Anki bracket readings, and rejects kana-script substitutions. It does not rewrite the context or require every other supported occurrence to be marked.

The marked range includes tightly bound target morphology such as voice, tense, conditionals, desiderative `たい`, appearance `そう`, and the connective in `頼ったり`. The boundary is morphosyntactic rather than semantic: morphology which selects a nonfinal stem belongs inside the mark, while a construction following an already-complete predicate remains outside. Thus `呼び捨てにされたくない` and appearance `上回りそうだ` are marked in full, but `取り締まるべきだ` marks `<mark>取り締まる</mark>べきだ` and hearsay `上回ったそうだ` marks `<mark>上回った</mark>そうだ`.

Context-marking inputs must already be trusted, sanitized fragments; this package preserves supplied structure but is not an HTML sanitizer. Semantic choices remain outside it. It does not select a JMDict entry, choose among several plausible senses, decide how much context is useful, or generate a hint. Once those choices are final, `card_creator` validates and renders the complete card.
