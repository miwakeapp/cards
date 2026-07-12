# TODO

## Rarity provenance and deployment

- Record the NWJC source file's identity and normalization version in generated rarity resources, while continuing to download the latest upstream data.
- Decide whether BCCWJ remains explicitly local-only and noncommercial, can be used with separate permission, or should be replaced by a distributable source before browser-add-on deployment.

## Card updater evaluation

- Build a small, checked-in evaluation set for JMDict retarget suggestions. The synthetic unit tests are good for deterministic classification and sense alignment, but they do not tell us whether AI suggestions remain useful across the messy changes that occur in real JMDict releases.
  - Curate representative migrations from actual old/new JMDict entries: reworded, reordered, split, merged, added, and removed senses; changed spelling or reading applicability; and all-senses cards whose entry gains or loses a sense. Include easy-looking cases where retaining the existing target is correct as well as cases requiring a new key, different targeted senses, a changed or removed hint, or manual review.
  - Store only the minimal old and new entry data, an authored or safely anonymized context, the card fields needed by the suggester, and the source JMDict versions. Do not check in raw Anki exports, note IDs, bulk reports, model reasoning, or personal source text.
  - Record a human-reviewed expected decision and a short rationale for each case. Evaluate sense selection and proposed key exactly; evaluate hints by explicit constraints such as keep, remove, or mention a required disambiguating spelling instead of requiring one exact sentence.
  - Keep this separate from ordinary unit tests if it calls a live model. Provide a repeatable command that reports per-case results and aggregate accuracy, so prompt or model changes can be compared deliberately instead of judged from a handful of current cards.

## Leech regeneration

- Turn the recurring prototype leech conversion into a review-then-apply workflow that preserves Anki history and never changes the proposed result between review and application.
  - Keep the useful preparation flow: find eligible leeches, recover the original source and fuller context from the local EPUB corpus where possible, use AI to select an appropriate sentence window, and write a human-editable intermediate file. It can remain rough prototype code while this is a personal workflow.
  - Generate the complete proposed Miwake fields once and persist them in a gitignored plan. Reviewing a dry run should inspect the same fields that will be written; applying the plan must not call AI again. Include enough generation metadata to understand how the proposal was produced, but do not commit personal contexts, note IDs, or run reports.
  - Fingerprint the relevant source-note fields when building the plan. Before applying, refuse or hold an item if its source note has changed, disappeared, or no longer has the expected note type. Preflight duplicate Miwake keys and treat any collision as something to resolve, since the key is the card's identity.
  - Normally update the existing note in place so its card ID, scheduling state, and review history survive the conversion. If Anki's note-model conversion cannot preserve those properties for a particular source shape, stop for review. Treat intentionally replacing it with a fresh card as a separate, explicit reset action.
  - Make application resumable and auditable: record which exact plan entries were applied, make rerunning an interrupted plan idempotent, and report partial failures without regenerating already-reviewed fields or silently tagging unresolved source notes as converted.
  - Keep the planning, validation, and field-mapping logic separate enough to test without a live Anki collection. The eventual product may present this through the broader leech-management UI described in `DESIGN.md`; the prototype does not need that UI before its data flow is safe.

## AI result caching

- Make persistent AI results valid for the exact request that produced them. A reusable cache entry must be invalidated by the model ID, the complete effective input, and a revision or fingerprint covering the system prompt, user-prompt construction, output schema, few-shot examples, and materially relevant post-processing rules.
  - Apply this to `card_updater`: its suggestion hash should cover both the card and dictionary inputs and the behavior of `card_creator` used to produce the suggestion. Expose an explicit card-generation prompt revision, or a stable fingerprint of the prompt, schema, and examples, and include it in the suggestion hash.
  - For future long-running batch workflows, persist each successful result promptly so interruption does not waste completed calls, validate cached values with the current schema and normalization rules before use, and provide an explicit way to force regeneration. Do not cache failed or malformed responses as successful results.
  - Prefer a reviewed plan over a second cache when the plan itself contains the final generated fields, as in leech regeneration. Do not build a repository-wide generic AI-cache framework yet; implement correct workflow-specific persistence first, then extract shared hashing and atomic JSON-storage mechanics only after a second durable consumer demonstrates the common shape.

## General cleanup

- Decide how to choose source markup based on semantics: `<cite>` for work titles, `<span>` for non-titles, and `<a>` for useful public links.
- Evaluate rarity calibration and exact `wordfreq` data against a curated set of desired word orderings and coverage.
- Consolidate the project's other HTML-entity decoders around `@std/html/entities`.
- Stream ZIP extraction if setup needs to work within a lower memory ceiling.
- Add an explicit repository license before public distribution.

## Repository maintenance

- Add a root README with the package map, Deno prerequisite, common development commands, and an explanation of which generated resources are checked in versus kept local.
- Add dependency-update automation that updates the lockfile and opens reviewable pull requests. Keep related AI SDK core/provider packages on compatible generations instead of updating providers independently.
- Document a small, non-destructive manual smoke procedure for AI providers and AnkiConnect after major dependency upgrades. CI can validate types and mocked behavior but cannot exercise credentials, provider responses, or a live Anki collection.
- Validate the downloaded `jmdict-simplified` schema before replacing the local dictionary, and record stronger source identity such as the exact asset name or input hash in the checked snapshot metadata. The downloader intentionally follows current releases, while the TypeScript types update independently.
- If the full Lorenzi furigana dataset is ever bundled or redistributed, resolve its distribution terms explicitly. The current full download remains local; only a small test excerpt is checked in.
