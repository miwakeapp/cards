# Animecards → Miwake card conversion

This workflow converts reviewable Animecards notes in place. A note is eligible only when all of the following are true:

- it has exactly one card;
- its JMDict entry has exactly one sense;
- its JMDict entry can be identified from a glossary link or an exact headword match, and its recognition-target spelling belongs to only one JMDict entry;
- its recognition-target field does not contain a bracketed usage hint;
- its reading is unique, or the existing Animecards `Reading` field identifies it;
- the exact or inflected target can be located unambiguously in the sentence;
- its full context can be checked and, when necessary, restored against source material;
- the resulting Miwake Card key does not already exist.

The converter uses the shared tokenizer/deinflector to locate common conjugated forms for highlighting. Single-sense cards with short contexts use no AI. Longer contexts use the canonical `card_creator` prompt only for minimized context generation. The code retains the multi-sense enrichment path for future validation, but preparation deliberately keeps it disabled for this initial pass. Cases that cannot be validated against JMDict or the EPUB source are recorded instead of being guessed.

Source names are cleaned of known reader-app suffixes. When the source field is empty, the prepare step searches `epub_texts/` and fills the source only if the complete context occurs in exactly one book. URLs from private readers and URLs with authentication or expiry parameters are retained in the manifest for auditing but are not linked on the card. Each candidate's `sourceResolution` records the chosen name, method, URL, and public-URL decision.

## Usage

Anki must be running with the Animecards and Miwake note types installed. Both note types must have one card template, because that lets Anki retain the existing card ID and review history during the model change. The installed AnkiConnect must provide `updateNoteModel`; version 25.11.9.0 is known to provide it.

From `anki_updater_prototype/`:

```sh
deno task animecards:prepare
deno task animecards:restore-context generated/animecards-YYYY-MM-DD.json
deno task animecards:enrich generated/animecards-YYYY-MM-DD.context.json
deno task animecards:report generated/animecards-YYYY-MM-DD.context.enriched.json
deno task animecards:apply generated/animecards-YYYY-MM-DD.context.enriched.json
deno task animecards:apply generated/animecards-YYYY-MM-DD.context.enriched.json --write
```

The prepare command reads Anki and writes a reviewable JSON manifest and Markdown audit report; it never modifies the collection. Each candidate contains the complete original note data and a fingerprint. Set a candidate's `approved` property to `false` to hold it back.

Preparation searches the matching EPUB paragraph for every sourced candidate. Complete excerpts are re-extracted deterministically so source-authored `<ruby>` and `<rt>` return. Cutoff excerpts are marked pending for `animecards:restore-context`, which uses a source-faithful extraction prompt and defaults to Gemini Flash. AI output is accepted only when it contains the entire original excerpt, has complete balanced boundaries, and can be re-extracted verbatim from one unique source window. Its append-only `.context-cache.jsonl` sidecar means an interrupted or dry run is reusable. Candidates without a source-backed full context are automatically deferred, omitted from enrichment and apply, and written by `animecards:report` to a `.deferred-contexts.csv` file for a later semi-manual pass. Apply accepts only restored contexts.

The enrich command uses `card_creator`'s canonical prompt when a context is over 50 plain-text characters. It appends every result to a fingerprint-validated `.ai-cache.jsonl` sidecar and can resume without repeating completed requests; the final enriched manifest makes apply purely local apart from AnkiConnect. Resumable stage outputs are fingerprinted against the complete input manifest so that review edits cannot accidentally reuse a stale checkpoint. For the default single-sense workflow, AI readings, highlighting, source decisions, sense selection, and hints are discarded; only normalized `minimizedContext` is retained. Failed enrichments are deferred from apply, while pending enrichment on an approved candidate blocks apply until enrichment completes. The default concurrency is 5 and can be changed with `--concurrency=N`.

The apply command is also read-only unless `--write` is present. Its preflight re-fetches every note, rejects notes edited since preparation, checks for new key conflicts, and treats already-applied entries as successful no-ops. After every write it verifies the target fields, tags, and original card ID. Results are appended to `generated/animecards-apply-YYYY-MM-DD.jsonl`. Add `--reset` to call Anki's Forget operation after conversion, returning the retained card to the new queue; this replaces the former create-a-new-card-and-delete-the-leech workflow.

Common options:

```sh
deno task animecards:prepare --limit=100
deno task animecards:prepare --query='deck:Mining note:Animecards tag:leech'
deno task animecards:prepare --word-field=Expression --sentence-field=Context
deno task animecards:prepare --output=generated/my-conversion.json
deno task animecards:prepare --anki-connect-url=http://SurfacePro11:8765
deno task animecards:prepare --epub-texts-dir=/path/to/epub_texts
deno task animecards:prepare --no-epub-source-lookup
deno task animecards:prepare --jmdict-overrides=generated/jmdict-overrides.json
deno task animecards:restore-context generated/my-conversion.json --model=gemini-3.5-flash
deno task animecards:apply generated/my-conversion.json --limit=10
deno task animecards:apply generated/my-conversion.json --reset --write
```

When a glossary contains several JMDict links, preparation declines to choose one. Supply a reviewed JSON object mapping Anki note IDs to JMDict IDs, such as `{ "1234567890": "1414110" }`, with `--jmdict-overrides`. The normal spelling, reading, and context checks still apply to the selected entry.

`Word`/`Expression`/`Recognition target`, `Sentence`/`Context`, `Glossary`/`Definition`, `Reading`, `Source`, and `Source URL` are detected automatically. Field flags override this detection. The complete source snapshot in the manifest is the recovery record, so retain it until the conversion has been reviewed and synced.
