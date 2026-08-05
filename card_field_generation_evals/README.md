# Card-field generation evals

This package evaluates the focused AI operations in `card_field_generation` against tracked card-conversion references. Every fixture records whether its expectation was user-reviewed, agent-reviewed, replayed from an observed corpus artifact, or remains provisional. It deliberately keeps sense selection, additional-reading selection, hint generation, and context minimization separate: sense and reading selections have enumerable answers, null minimization decisions can be compared exactly, and novel source-grounded text needs review instead of being marked wrong merely because it differs from one preferred example.

## Running evals

The default run uses each operation's current production configuration: GPT-5.6 Sol at medium reasoning effort for sense selection, additional-reading selection, and hints, and Claude Opus 5 at low effort for context minimization. These settings are an agent-adjudicated engineering baseline selected on the development corpus, not a user-validated optimum. Provider results are content-addressed and persisted in `generated/cache.jsonl`, so rerunning an unchanged prompt/model/input does not pay for another request. This is the default `--cache-mode use` policy.

See [MODEL_SELECTION.md](MODEL_SELECTION.md) for the comparison methodology, development back-test, cost record, and rationale for those defaults.

```sh
deno task run
```

For inexpensive prompt iteration, use the deterministic 30-case development sample. It balances all four operations, stratifies each operation by expected outcome, rotates among user-reviewed, agent-reviewed, corpus-replay, and provisional evidence within each stratum, and excludes prompt few-shots. This is an iteration aid, not a statistically independent held-out test set.

```sh
deno task run --sample 30
```

Useful filters include:

```sh
deno task run --model gemini-3.6-flash --effort low --operation hint
deno task run --operation context-minimization --case 執刀
deno task run --model claude-sonnet-5 --case ハイタッチ
deno task run --model gpt-5.6-luna --model gpt-5.6-terra --sample 30
deno task run --cache-mode refresh --sample 30
deno task run --dry-run --sample 30
```

`--model`, `--effort`, `--operation`, and `--case` are repeatable. `--model all` and `--effort all` expand the complete registries. Omitting both model flags and effort flags retains each operation's own production configuration. Supplying only `--model` replaces every selected operation's model while retaining each operation's production effort; supplying only `--effort` does the converse. Supplying both creates the requested model/effort matrix for every selected operation. Requested combinations which produce identical provider settings are collapsed before planning: GPT-5.6 `minimal` becomes `none`; Gemini `none` becomes `minimal` and `xhigh`/`max` become `high`; Anthropic `minimal` becomes `low`; and every Haiku effort becomes `disabled`. Plans and artifacts consistently use these provider-effective settings. `--cache-mode use` reads and writes completed results, `refresh` skips existing results and replaces them after successful generation, and `bypass` neither reads nor writes them. Provider prompt caching remains active in every mode because it only discounts requests the eval still makes. Before making requests, the CLI protects both breadth and retry depth: cache-using plans may contain at most 250 model/case slots and 750 possible corrective provider attempts, while `refresh` and `bypass` plans may contain at most 50 slots and 150 attempts. The larger cache-using allowance accommodates the complete production-configuration corpus at the default three attempts, although a cold cache can still make every selected slot paid. The uncached allowance is intentionally sized for focused development samples because every selected slot is necessarily paid. `--dry-run` can inspect a plan of any size without provider calls or artifacts; after review, `--allow-expensive-run` explicitly overrides both limits. `--concurrency` defaults to 4 and bounds simultaneous structured-generation operations. Every paid corrective round is reported immediately with latency, token usage, and any validator rejection; the AI SDK may make bounded transient HTTP retries within one such round. Quota or credit exhaustion stops workers from claiming new cases. Already-started requests settle, every recorded slot remains in the completed-result cache, and the CLI writes explicitly interrupted partial artifacts before exiting unsuccessfully.

Each invocation that starts generation writes paired self-contained JSON and readable Markdown under `generated/runs/`. Reports include cache hits, provider attempts, retries, input/cache/output/reasoning tokens, estimated USD cost, latency, operation-specific reference diagnostics, and cases needing qualitative review. Interrupted reports identify the planned and recorded slot counts and make clear that their metrics and cost cover only recorded work. Hint reports flag outputs more than 6 and 12 Unicode code points longer than their recognition target; these are review diagnostics derived from the live corpus, not validation limits, because longer source-grounded phrases can be semantically necessary. Review details are case-centric: one source context and tracked reference judgment is followed by every tested model configuration, so disagreements can be read vertically instead of reconstructed from separate model sections. Deterministic-validation failures are shown attempt by attempt, including for cached results whose original paid `sourceGeneration` metadata is retained.

Artifacts use recursively canonicalized SHA-256 hashes to identify the selected fixture set, each individual fixture, each exact prompt/model request through its generation cache key, and each validated output. These hashes make comparisons traceable without treating generated text as authoritative or requiring ignored source artifacts to remain available.

## Cost estimates

Reports price the actual `GenerationUsage` buckets for uncached input, provider cache writes, cache reads, and output. Reasoning tokens are already included in output tokens and are not counted twice. Missing provider telemetry makes reported usage and cost a lower bound; contradictory totals and detail buckets instead make the normalized estimate uncertain in either direction. Local completed-result cache hits have no provider attempts or token usage, so they add $0 to the invocation estimate.

The checked-in standard API list prices were verified on **2026-07-29** against the first-party [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing), and [OpenAI](https://developers.openai.com/api/docs/pricing) pricing pages. Where applicable, the rates account for Anthropic's 5-minute and OpenAI's 30-minute cache writes at 1.25 times ordinary input, their 0.1-times cache-read rates, and Gemini's implicit-cache read prices. Claude Sonnet 5 uses its introductory $2/$10 input/output pricing through 2026-08-31, then automatically switches to Anthropic's announced $3/$15 standard pricing.

These values are labeled estimates, not invoice truth. They exclude free tiers, negotiated discounts, taxes, regional or data-residency uplifts, batch/flex/priority modes, tool charges, and cache-storage charges. The eval requests are also far below any long-context pricing thresholds. JSON artifacts retain the exact rate and USD breakdown for each model/operation summary, the whole-run total, pricing date, source links, and disclaimer so an old run remains auditable after list prices change.

Reports partition every operation by reference basis:

- **user-reviewed**: the user directly adjudicated the tracked expectation; once checked in, these visible cases are development evidence rather than a blinded holdout;
- **agent-reviewed**: an agent adjudicated the expectation from source evidence, JMDict, and documented policy; this is not a user preference judgment;
- **corpus-replay**: the expectation reproduces an observed card or conversion artifact without independent adjudication;
- **provisional**: the curator remains uncertain, so the result is diagnostic only.

No checked-in fixture is a statistically independent holdout. Reports compare sense selection's complete explicit outcome: a selected subset, a positive no-match judgment, or a defer-worthy ambiguity. Minimization reports compare the `null`/non-`null` disposition exactly; a non-null exact reference match is only diagnostic because several different shortenings can satisfy the same rubric. Hint reports first measure whether the generated, not-needed, or source-insufficient operation disposition agrees with the tracked reference. This is reference agreement, not a claim of semantic accuracy. They then classify generated hint text with seven dispositions:

- **preferred**: exactly matches one curated good example;
- **acceptable**: exactly matches a curated answer that is faithful and usable, but less concise or natural than the preferred examples;
- **known-bad**: reproduces a recorded failure;
- **novel**: passes package validation but needs qualitative review;
- **not-needed**: matches a tracked reference that the usages are semantically indistinguishable, so no separate hint should be generated;
- **source-insufficient**: matches a tracked reference that a semantic distinction exists but the source cannot fairly support a hint; callers create the otherwise-useful card unhinted rather than fabricating a cue;
- **reference-disposition-mismatch**: differs from the tracked reference among generated, not-needed, and source-insufficient.

Disposition agreement does not establish the quality of generated wording. Any novel package-validated hint still needs qualitative review for naturalness, usefulness, and faithfulness to the source and intended contrast.

Prompt-overlap cases still run and appear in detail, but are excluded from basis-specific metrics. Provisional references remain visible only as diagnostics. User-reviewed, agent-reviewed, corpus-replay, and provisional cohorts are reported separately, so replaying a generated card is never presented as a user preference judgment. The prompts and model settings were developed against this corpus; excluding exact few-shots prevents a direct prompt replay but does not make the remaining cases held out.

A separate preference worksheet was adjudicated outside the repository on 2026-07-30. Its sixteen intentionally exposed answers are incorporated here as `user-reviewed` fixtures. Eight further answers were withheld until the prompts and predictions were frozen; four matched exactly. The misses exposed a sense-selection distinction, two deterministic target-marking boundaries, and one subjective minimization choice. Once revealed, these cases became development evidence rather than a reusable holdout.

## Fixture files

- `cases/sense_selection.json` contains 114 tracked decisions: the focused Animecards batch, focused known-failure and no-applicable-sense controls, agent-adjudicated cases retained from the predecessor evaluator, the normative three-compatible-sense 見込み example from `DESIGN.md`, three additional controls for pedagogical sense grouping, three user-reviewed worksheet cases, and 19 final-Key decisions recovered from manual SurfacePro11 edits.
- `cases/reading_selection.json` contains five user-reviewed decisions: the three live-collection corrections that motivated the operation plus positive `日本` and mixed casual-`明日` controls from the card design policy.
- `cases/hint.json` contains 103 decisions: 60 failures carried forward from the predecessor card-generation review log, 26 agent-adjudicated cases from a read-only sample of accepted SurfacePro11 cards, four earlier controls where no semantic hint is needed, two deliberately underspecified controls where a hint is needed but the source cannot support one, two exposed user-preference cases, and nine new preferences recovered from manual SurfacePro11 hint edits.
- `cases/minimization.json` contains 55 decisions: 40 contexts that benefit from shortening and 15 contexts where the correct output is `null`.

`../data/resources/jmdict/card_field_generation_eval_entry_ids.json` is a generated boundary artifact listing the entries these fixtures require from `data`. Regenerate it with `deno task build:jmdict-entry-manifest` after changing fixture entry IDs. Tests reject a stale manifest. Keeping the flat ID list with the data resources lets `data` rebuild independently without reaching back into this consumer package or learning its fixture schema.

Each file is one JSON object with a `schemaVersion` and a `cases` array. Every case records its source provenance and `referenceBasis`. When a fixture derives from a predecessor failure, `provenance.knownFailure` explicitly names the tracked Markdown artifact, its level-two section, optional level-three subsection, and exact first-column table entry; repeated entries also name the exact second-column context. Fixture loading rejects unknown fixture properties, missing artifacts, heading hierarchies, ambiguous references, and absent rows instead of silently accepting malformed data or emitting a plausible-looking dangling citation. A sense fixture's `expected.outcome` is `selected`, `no-match`, or `ambiguous`; a selected outcome explicitly lists every applicable compatible sense, while an ambiguous outcome lists every sense the source leaves possible. Hint cases record the selected and contrasting JMDict usages explicitly; the runner never invents a contrast from an expected string.

Hint fixture contexts are sanitized HTML with the intended occurrence or occurrences wrapped in `<mark>`. The generation package converts those marks to occurrence-addressed opaque prompt sentinels, so a repeated same-spelling occurrence elsewhere in an excerpt cannot silently supply evidence for the wrong usage. A generated result keeps both a broad exact semantic-evidence span and a nested sentence-local hint-source span; the latter bounds the source material available to the final hint. The tracked corpus was migrated mechanically with `card_resolution`'s JMDict-aware occurrence lookup and structured HTML marker; every resolved occurrence and resulting mark count was audited.

`preferredHints` are concise, natural reference answers, not an exhaustive list of the only acceptable strings. `acceptableHints` records curated outputs that are faithful and usable but mildly overlong, overinflected, or otherwise not ideal; this prevents recurring good-enough text from being reported as novel without lowering the standard represented by `preferredHints`. `observedBadHints` records known failures when one actually exists; curated positive cases leave it empty rather than inventing negative evidence. Reports also show `rubricNotes`: a different answer can be good when it is equally source-grounded, contrastive, natural, and concise.

Similarly, `acceptableMinimizedContexts` are illustrative curated answers rather than exhaustive gold strings. The rubric and deterministic `card_resolution` validation decide whether a novel shortening is safe and useful. `keep-full-context` is different: it has no text references and expects an exact `null` result. The corpus covers causal and anaphoric context, dialogue, multi-paragraph input, repeated targets, ruby and Anki furigana, exact mark boundaries, and prior overlong or relationship-changing compression.

## Hint-case scope

The predecessor review log contained 77 cases. The hint fixtures retain the 60 failures that unambiguously isolate prompt-level hint quality:

- 52 source-grounding and phrasing failures from Exposure;
- 8 source-grounding, inflection, orthography, answer-leakage, or phrase-boundary failures from Animecards.

Four additional not-needed controls test whether the model declines to invent a semantic hint when entries differ only by reading or an indistinguishable lexicographic split. Two artificial controls use real JMDict contrasts but deliberately metalinguistic excerpts to test the separate source-insufficient outcome; one does not overlap the prompt few-shots.

Two exposed preference cases add direct user evidence: 飾り物 accepts either the exact source participant or a controlled `Xさん` placeholder, while 拠りどころ establishes the caller policy for a source-insufficient result: create the otherwise-useful card unhinted instead of fabricating a cue or deferring it.

A separate agent audit of 40 accepted SurfacePro11 cards contributes 26 cases absent from the historical corpus: 10 positive hint references, eight corrections for source-unsupported accepted hints, and eight `not-needed` cases that isolate a genuinely equivalent competing usage. The audited 圧巻 card is intentionally excluded because it has no contrasting usage; deciding not to request a hint there belongs to upstream acquisition policy, not hint generation.

A later read-only comparison of 40 manually reviewed SurfacePro11 notes against their applied conversion records recovered another set of direct user decisions. Nineteen same-entry Key edits provide sense-selection references: 18 new cases and a correction to the earlier corpus-replay expectation for いなご. These decisions reflect the Key's pedagogical grouping policy: senses belong together when learning one makes the others transparently understandable in ordinary context, even if the source sentence directly realizes only one. Fourteen nonempty Hint edits provide nine new hint cases and confirm five existing cases. Two corrections instead select a different spelling or JMDict entry, and five removed hints are consequences of deterministic affix notation; those seven remain outside these focused AI operations rather than being mislabeled as prompt evidence.

The other 17 cases are deliberately excluded from `hint.json`:

- 7 require JMDict changes or an explicit defer decision;
- 4 are sense-selection failures rather than hint-generation failures;
- 3 require reading or JMDict-entry selection;
- 2 require choosing a longer recognition target;
- 1 is the deterministic affix policy that decides whether any hint is needed.

Those exclusions should be covered by the appropriate future operation-specific fixtures instead of making hint generation responsible for upstream decisions.

## Provenance

The sense fixtures were extracted from `anki_updater_prototype/generated/animecards-surfacepro11-2026-07-26-focused-review-approved.json` and the later read-only comparison of live reviewed keys with their apply records. The hint fixtures combine historical review notes with ignored conversion manifests that preserve the selected JMDict entry, reading, and sense evidence, the 26 retained cases from the agent's read-only SurfacePro11 accepted-card audit, and the later reviewed Hint edits. The minimization fixtures combine 18 agent-reviewed predecessor evals, 31 accepted Miwake notes sampled read-only from SurfacePro11, two organic HTML-ruby inputs from the Exposure migration, and four direct preference-worksheet decisions. All evidence needed by an eval is copied into the tracked fixture; the ignored artifacts and live collection are not runtime dependencies.

The predecessor's review log is preserved verbatim at `archive/card_creator_evals/KNOWN_FAILURES.md`. It is historical evidence, distinct from the active unresolved-issue log at `KNOWN_FAILURES.md`. Fixtures that cite it retain their original conversion manifest separately in `provenance.artifact`, while `provenance.knownFailure` points to a validated archive section and row. Model-promoted outputs from the predecessor were not carried forward as authoritative expectations; agents re-adjudicated the active references, and exact minimization strings inherited from the predecessor remain silver evidence.

The 18 retained predecessor minimization pairs use `git:<commit>:<path>` artifact references because the obsolete evaluator's individual input and golden files were deliberately removed; the complete evidence needed by the new operation is copied into each fixture. The predecessor's nineteenth pair, `土いじり`, was intentionally omitted because its source text contained the unexplained artifact `52` inside `庭先で土いじりをしていた52が…`, so neither its context nor its model-promoted golden is reliable eval evidence.
