# Anki Updater Prototype

This package is a saved-work scratchpad for recurring or potentially reusable Anki workflows. It follows the repository's public package boundaries and task conventions, but it is intentionally exempt from the source-layout and polish standards applied to maintained libraries and applications.

## Workflows

- `shared/` contains reusable AnkiConnect, Miwake note-model, and JMDict resolution code.
- `leech/` contains the Mining-deck leech-card conversion workflow.
- `jlpt/` contains the JLPT CSV import workflow and its source CSV data.

## Common Tasks

Run from `anki_updater_prototype/`.

```sh
deno task setup-miwake-model
deno task prepare-leech-batch
deno task create-leech-batch leech/batch_YYYY-MM-DD.json
deno task create-from-csv jlpt/jlpt-moji-goi/N1_2025-12_moji-goi.csv
deno task report-unresolved-csv jlpt/jlpt-moji-goi jlpt/jlpt-moji-goi/unresolved-report.csv
deno task report-vocab-appearances jlpt/jlpt-moji-goi/moji-goi-vocab.csv jlpt/jlpt-moji-goi/vocab-appearances.csv
```

`shared/jmdict_resolution/recognition_target_lookup.ts` handles tokenizer-backed recognition-target normalization, including common deinflection cases. This is intended to be reusable by the eventual browser extension.
