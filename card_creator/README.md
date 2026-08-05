# Card Creator

Deterministically renders fully decided semantic content as complete Miwake Card fields.

`card_creator` does not acquire source text or make semantic and pedagogical choices. Callers must first select the accepted JMDict entry/sense usages and kana readings, plus the recognition-target spelling, full and minimized contexts, hint, and source metadata. Those decisions may come from deterministic analysis, AI, user input, or a mixture; they are deliberately outside this package.

```ts
import { createCard } from "card_creator";

const card = await createCard({
  jmdictUsages: [{
    entry: jmdictEntry,
    applicableSenseNumbers: [1],
  }],
  kanaReadings: ["たよる"],
  recognitionTarget: "頼る",
  fullContext: "同じように、<mark>頼ったり</mark><mark>頼られたり</mark>すればいいと思うよ。",
  source: {
    text: "『作品名』",
    lang: "ja",
  },
});
```

Each `AcceptedJMDictUsage` has one distinct `entry` and optional `applicableSenseNumbers`. `kanaReadings` independently lists every accepted pronunciation and is omitted for a kana recognition target. Input order is immaterial: the renderer gives Key usages, `Dictionary` blocks, and Reading alternatives stable orders. Marked source ruby may match any accepted reading.

Passing several entries or readings asserts that every listed pronunciation is an acceptable answer for every selected entry/sense usage on this recognition card. JMDict cannot always encode that cross-entry equivalence: it may attach each reading to only one of the entries. The renderer therefore performs the mechanical checks JMDict can support—every reading directly grounds at least one complete usage, and every usage has at least one directly grounding reading—while leaving the stronger semantic judgment to the caller.

The renderer validates the resolved input and then:

- Builds one canonical Miwake Card Key by sorting the accepted JMDict entry/sense usages.
- Validates marked-context structure without trying to redo the caller's target matching.
- Converts source `<ruby>` to Anki bracket syntax, validates marked ruby against any accepted reading, and reverses full-size-kana typography in incidental ruby using JMDict where possible.
- Precisely places furigana in the `Reading` field.
- Keeps one annotated spelling as plain text, or renders several accepted readings as an HTML list.
- Adds `～` notation when the selected senses are unambiguously prefix- or suffix-only.
- Renders semantic JMDict HTML for every distinct Key entry, composing independently identifiable blocks only when the recognition unit spans entries.
- Escapes and formats explicit source metadata.

The package root intentionally contains only `createCard()` and its input/output types: `CreateCardInput`, `AcceptedJMDictUsage`, `CardSource`, and the type-only `CardFields` re-export. `card_model` remains the canonical owner of `CardFields` and the persisted Key, Reading, and Dictionary codecs.

`card_creator/accepted-reading` exposes one updater-facing operation, `formatAcceptedReadingsForAnki()`. It applies the same entry/reading/sense validation and canonical reading order as `createCard()`, then returns undecorated Anki-furigana alternatives. It returns `null` for kana targets or when precise placement data is unavailable, allowing maintenance to preserve an existing Reading instead of choosing a replacement. The internal resolved-content graph is not public.

The JMDict preparation helpers live under `card_creator/jmdict` instead of expanding the root API:

- `compatibleSenseNumbersForJMDictUsage()` applies JMDict's spelling and reading restrictions before a caller makes any contextual choice among senses.
- `jmdictUsagesForSpelling()` enumerates every usage an undecorated spelling can represent.
- `jmdictAlternativesForCardFront()` removes alternatives already distinguished by the front's `～` notation.

These functions share `JMDictSpellingUsage` and use the same validation and compatibility rules as `createCard()`. Surviving front-side alternatives are candidates for a separate semantic hint decision; their presence does not by itself prove that a hint is useful.

Card construction uses JMDict furigana data and the compact spelling-to-readings index from the `data` package. Refresh the full local resources with:

```sh
deno task --cwd data update:jmdict
```

Run the package tests with `deno test -P card_creator`.
