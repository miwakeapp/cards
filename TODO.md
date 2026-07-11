# TODO

## Meta

- Move this into GitHub issues, once we have a GitHub repository.

## Rarity provenance and deployment

- Record the NWJC source file's identity and normalization version in generated rarity resources, while continuing to download the latest upstream data.
- Decide whether BCCWJ remains explicitly local-only and noncommercial, can be used with separate permission, or should be replaced by a distributable source before browser-add-on deployment.

## General cleanup

- Decide how to choose source markup based on semantics: `<cite>` for work titles, `<span>` for non-titles, and `<a>` for useful public links.
- Evaluate rarity calibration and exact `wordfreq` data against a curated set of desired word orderings and coverage.
- Consolidate the project's other HTML-entity decoders around `@std/html/entities`.
- Stream ZIP extraction if setup needs to work within a lower memory ceiling.
- Add standard root formatting, linting, documentation linting, type checking, and permission-aware test tasks, backed by CI.
- Expand `data/README.md` to cover the existing JMDict workflows.
- Add an explicit repository license before public distribution.
- Add more JSDoc and/or types on public APIs (maybe all exported APIs?).
