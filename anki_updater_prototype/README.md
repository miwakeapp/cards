# Anki Updater Prototype

This package is a saved-work scratchpad for recurring or potentially reusable Anki workflows. It follows the repository's public package boundaries and task conventions, but it is intentionally exempt from the source-layout and polish standards applied to maintained libraries and applications.

## Workflows

- `shared/` contains reusable AnkiConnect, Miwake note-model, and JMDict resolution code.
- `animecards/` contains the reviewable, in-place Animecards → Miwake card conversion workflow.
- `jlpt/` contains the JLPT CSV import workflow and its source CSV data.

## Common Tasks

Run from `anki_updater_prototype/`.

```sh
deno task animecards:prepare
deno task animecards:restore-context generated/animecards-YYYY-MM-DD.json
deno task animecards:enrich generated/animecards-YYYY-MM-DD.context.json
deno task animecards:apply generated/animecards-YYYY-MM-DD.context.enriched.json
deno task setup-miwake-model
deno task create-from-csv jlpt/jlpt-moji-goi/N1_2025-12_moji-goi.csv
deno task report-unresolved-csv jlpt/jlpt-moji-goi jlpt/jlpt-moji-goi/unresolved-report.csv
deno task report-vocab-appearances jlpt/jlpt-moji-goi/moji-goi-vocab.csv jlpt/jlpt-moji-goi/vocab-appearances.csv
```

The Animecards workflow separates read-only preparation from an explicitly-enabled write phase, fingerprints complete source notes, verifies card-ID preservation, and records nontrivial cases instead of guessing. It also replaces the former leech workflow: convert a leech Animecard in place and apply with `--reset` to return its retained card to Anki's new queue. See [`animecards/README.md`](./animecards/README.md).

`shared/jmdict_resolution/recognition_target_lookup.ts` handles tokenizer-backed recognition-target normalization, including common deinflection cases. This is intended to be reusable by the eventual browser extension.
