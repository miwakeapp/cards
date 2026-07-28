# Animecards → Miwake card conversion

This workflow converts reviewable Animecards notes in place. A note is eligible only when all of the following are true:

- it has exactly one card;
- its JMDict entry has exactly one sense, unless the explicit multi-sense rollout flag is used;
- its JMDict entry can be identified from a glossary link or an exact headword match, or the explicit entry-selection pass can distinguish several same-spelling entries;
- its recognition-target field does not contain a bracketed usage hint;
- its reading is unique, or the existing Animecards `Reading` field identifies it;
- the exact or inflected target can be located unambiguously in the sentence;
- its full context can be checked and, when necessary, restored against source material;
- the resulting Miwake Card key does not already exist.

The converter uses JMDict part-of-speech data to locate conjugated forms directly, with the tokenizer as a fallback instead of an authority on unstable token boundaries. It also searches uniquely matched EPUB passages, including excerpts spanning adjacent paragraphs, before rejecting a truncated Animecards excerpt. Recovered paragraph boundaries use plain `<p>` elements rather than ebook classes, IDs, or `<br>` separators. Single-sense cards with short contexts use no AI by default. An opt-in cached target-resolution pass can use the prototype's combined card-field prompt for unusual derivations; longer contexts use that prompt later for minimized context generation. Pass `--include-multiple-senses` to retain entries with several senses: JMDict spelling and reading restrictions resolve any uniquely compatible sense deterministically, while genuinely ambiguous candidates remain pending for the cached enrichment stage. The flag remains explicit so ordinary single-sense batches keep their established policy during the initial multi-sense rollout. Cases that cannot be validated against JMDict or the EPUB source are recorded instead of being guessed.

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

Pass `--resolve-entries-with-ai` to handle a Jitendex glossary containing several JMDict links or a selected entry whose recognition-target spelling also belongs to other entries. Explicit source ruby first excludes entries with incompatible readings; an Animecard reading is weaker evidence and does not exclude competing entries before semantic comparison. The pass presents the remaining entries' senses as one numbered list to the canonical sense-and-hint operation. If the comparison chooses an unlinked entry whose reading contradicts the Animecard reading, the one linked, reading-compatible alternative may be checked independently and is accepted only when its senses fit the context and produce the required short contrastive hint. A semantically preferred same-reading entry is never overridden this way. Shared-spelling entries may have several senses because this operation selects the entry and senses at the same time; unrelated multi-sense cards remain controlled by `--include-multiple-senses`. No match, a selection spanning entries, or an allowed entry with no useful hint remains deferred with a distinct skip reason. A generated hint is omitted from the final card when its `～` boundary notation uniquely distinguishes the selected affix usage; another sense or entry with the same boundary pattern keeps the hint. Results are stored in an append-only `.entry-ai-cache.jsonl` sidecar, and the audit report records the allowed IDs, every compared ID, the selected ID, final hint, model, and context, including sense field and usage tags.

Pass `--resolve-targets-with-ai` to retry only otherwise-unresolved target-in-context cases with the prototype's combined card-field prompt. The returned value must be a literal substring of the context, and every occurrence is marked. Successful results are stored in an append-only `.target-ai-cache.jsonl` sidecar and recorded on each candidate with the model and generation time; all unrelated AI fields from this pass are discarded. `--ai-model` selects the model for both optional preparation-time AI passes.

Preparation searches the matching EPUB passage for every sourced candidate and deterministically derives the minimum source span that the final context must retain. It restores source-authored `<ruby>` and `<rt>`, completes partial sentences, and expands an excerpt that cuts into dialogue to the complete outer `「…」` or `『…』` passage, even across EPUB paragraphs; crossed paragraphs are serialized as plain `<p>` blocks. This span is only a structural lower bound: even a complete non-dialogue sentence remains pending until `animecards:restore-context` uses AI to judge whether it is understandable alone or needs the smallest useful amount of adjacent source context. The single cached selection pass defaults to Gemini Flash and may return the required span unchanged, but may never shorten it. Output is accepted only when it contains the entire required span, has complete balanced boundaries, and can be re-extracted verbatim from one unambiguous source window. Repeated source locations are accepted only when both their required HTML and semantic-evidence windows are identical. The append-only `.context-cache.jsonl` sidecar means an interrupted or dry run is reusable. Candidates without a source-backed full context are automatically deferred, omitted from enrichment and apply, and written by `animecards:report` to a `.deferred-contexts.csv` file for a later semi-manual pass. Apply accepts only semantically selected contexts.

The enrich command uses the prototype's combined card-field prompt when a context is over 50 plain-text characters. Sense selection always uses the same evaluated sense-and-hint rules through the narrower generation operation. For EPUB-backed candidates, it receives the matched paragraph plus the nearest paragraph on each side as semantic evidence; this window remains separate from, and is never rendered as, the card's intentionally concise full context. The selected reading and JMDict-compatible sense numbers are supplied as constraints; outputs outside those senses, missing or malformed disambiguating hints, and invalid card renderings fail closed. A result saying that none of the compatible senses describes the usage is recorded explicitly and deferred rather than forcing a misleading card. It appends every result to a fingerprint-validated `.ai-cache.jsonl` sidecar and can resume without repeating completed requests; the final enriched manifest makes apply purely local apart from AnkiConnect. Resumable stage outputs are fingerprinted against the complete input manifest so that review edits cannot accidentally reuse a stale checkpoint. For the default single-sense workflow, AI readings, highlighting, source decisions, sense selection, and hints are discarded; only normalized `minimizedContext` is retained. Failed enrichments are deferred from apply, while pending enrichment on an approved candidate blocks apply until enrichment completes. The audit report lists each multi-sense candidate's selected and compatible senses, final key, hint, model, card context, and wider sense-selection evidence. The default concurrency is 5 and can be changed with `--concurrency=N`.

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
deno task animecards:prepare --include-multiple-senses
deno task animecards:prepare --resolve-entries-with-ai --ai-model=gemini-3.6-flash
deno task animecards:prepare --resolve-targets-with-ai --ai-model=gemini-3.5-flash
deno task animecards:restore-context generated/my-conversion.json --model=gemini-3.5-flash
deno task animecards:apply generated/my-conversion.json --limit=10
deno task animecards:apply generated/my-conversion.json --reset --write
```

For a reviewed manual decision, supply a JSON object mapping Anki note IDs to JMDict IDs, such as `{ "1234567890": "1414110" }`, with `--jmdict-overrides`. The normal spelling, reading, context, and same-spelling hint checks still apply to the selected entry.

`Word`/`Expression`/`Recognition target`, `Sentence`/`Context`, `Glossary`/`Definition`, `Reading`, `Source`, and `Source URL` are detected automatically. Field flags override this detection. The complete source snapshot in the manifest is the recovery record, so retain it until the conversion has been reviewed and synced.
