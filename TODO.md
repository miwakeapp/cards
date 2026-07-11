# TODO

## Meta

- Move this into GitHub issues, once we have a GitHub repository.

## Rarity provenance and deployment

- Record the NWJC source file's identity and normalization version in generated rarity resources, while continuing to download the latest upstream data.
- Decide whether BCCWJ remains explicitly local-only and noncommercial, can be used with separate permission, or should be replaced by a distributable source before browser-add-on deployment.

## Card updater evaluation

- Build a small, checked-in evaluation set for JMDict retarget suggestions. The synthetic unit tests are good for deterministic classification and sense alignment, but they do not tell us whether AI suggestions remain useful across the messy changes that occur in real JMDict releases.
  - Curate representative migrations from actual old/new JMDict entries: reworded, reordered, split, merged, added, and removed senses; changed spelling or reading applicability; and all-senses cards whose entry gains or loses a sense. Include easy-looking cases where retaining the existing target is correct as well as cases requiring a new key, different targeted senses, a changed or removed hint, or manual review.
  - Store only the minimal old and new entry data, an authored or safely anonymized context, the card fields needed by the suggester, and the source JMDict versions. Do not check in raw Anki exports, note IDs, bulk reports, model reasoning, or personal source text.
  - Record a human-reviewed expected decision and a short rationale for each case. Evaluate sense selection and proposed key exactly; evaluate hints by explicit constraints such as keep, remove, or mention a required disambiguating spelling instead of requiring one exact sentence.
  - Keep this separate from ordinary unit tests if it calls a live model. Provide a repeatable command that reports per-case results and aggregate accuracy, so prompt or model changes can be compared deliberately instead of judged from a handful of current cards.

## General cleanup

- Decide how to choose source markup based on semantics: `<cite>` for work titles, `<span>` for non-titles, and `<a>` for useful public links.
- Evaluate rarity calibration and exact `wordfreq` data against a curated set of desired word orderings and coverage.
- Consolidate the project's other HTML-entity decoders around `@std/html/entities`.
- Stream ZIP extraction if setup needs to work within a lower memory ceiling.
- Add standard root formatting, linting, documentation linting, type checking, and permission-aware test tasks, backed by CI.
- Expand `data/README.md` to cover the existing JMDict workflows.
- Add an explicit repository license before public distribution.
- Add more JSDoc and/or types on public APIs (maybe all exported APIs?).
