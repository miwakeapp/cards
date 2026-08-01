# Card Creator

Deterministically renders fully decided semantic content as complete Miwake Card fields.

`card_creator` does not acquire source text or make semantic and pedagogical choices. Callers must first select the JMDict entry, recognition-target spelling, kana reading, applicable senses, full and minimized contexts, hint, and source metadata. Those decisions may come from deterministic analysis, AI, user input, or a mixture; they are deliberately outside this package.

```ts
import { createCard } from "card_creator";

const card = await createCard({
  jmdictEntry,
  recognitionTarget: "頼る",
  kanaReading: "たよる",
  applicableSenseNumbers: [1],
  fullContext: "同じように、<mark>頼ったり</mark><mark>頼られたり</mark>すればいいと思うよ。",
  source: {
    text: "『作品名』",
    lang: "ja",
  },
});
```

The renderer validates the resolved input and then:

- Builds the Miwake Card key from the selected entry and senses.
- Validates marked-context structure without trying to redo the caller's target matching.
- Converts source `<ruby>` to Anki bracket syntax, validates marked ruby against `kanaReading`, and reverses full-size-kana typography in incidental ruby using JMDict where possible.
- Precisely places furigana in the `Reading` field.
- Adds `～` notation when the selected senses are unambiguously prefix- or suffix-only.
- Renders semantic JMDict HTML.
- Escapes and formats explicit source metadata.

See the exported `CreateCardInput` and `CardSource` documentation for the exact contract.

`card_creator/keys` is the lightweight entrypoint for parsing and formatting Miwake Card keys.

`formatReadingForAnki()` formats a selected spelling and reading using Anki's bracket-based furigana syntax. It returns `null` when the local furigana data cannot determine precise placement.

`compatibleSenseNumbersForJMDictUsage()` applies JMDict's spelling and reading restrictions before a caller makes any contextual choice among senses. It uses the same validation and compatibility rules as `createCard()`.

The package also exposes the deterministic JMDict/card-front rules needed to prepare a fully decided card without duplicating renderer semantics. `jmdictUsagesForSpelling()` enumerates every usage an undecorated spelling can represent, while `jmdictAlternativesForCardFront()` removes alternatives already distinguished by the front's `～` notation. Surviving alternatives are candidates for a separate semantic hint decision; their presence does not by itself prove that a hint is useful.

Card construction uses JMDict furigana data and the compact spelling-to-readings index from the `data` package. Refresh the full local resources with:

```sh
deno task --cwd data update:jmdict
```

Run the package tests with `deno test -P card_creator`.
