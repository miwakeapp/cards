# Miwake Cards

This repository is a highly in-progress set of utilities for creating, managing, and updating my personal collection of Japanese vocabulary flashcards. The plan is to slowly evolve it into one or more reusable tools, packaged in a way that makes sense for a broader audience of people who have flashcard philosophies and Japanese learning levels similar to mine.

For now, most of the vision is documented in [DESIGN.md](./DESIGN.md). [EXTENSION-BRAINSTORMING.md](./EXTENSION-BRAINSTORMING.md) sketches how a browser extension could resolve captured page evidence into deterministic `card_creator` input.

The current architecture resolves as much as possible deterministically, then uses small, independently evaluated AI operations for the semantic and pedagogical decisions that remain. Fully decided content crosses a narrow boundary into deterministic card rendering.

## Setup

The repository is a Deno workspace. Install the locked dependency graph and run the complete automated check suite with:

```sh
deno task ci
```

Some workflows call AI providers. Copy `.env.sample` to `.env` and add only the credentials for the providers you use. Workflows that communicate with Anki also require a running Anki with AnkiConnect installed.

## Packages

| Package                                                         | Purpose                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`card_creator`](./card_creator/)                               | Validates and renders decided cards, and owns their deterministic JMDict/front semantics.  |
| [`card_resolution`](./card_resolution/)                         | Resolves exact target occurrences and safely adapts structured contexts for generation.    |
| [`card_field_generation`](./card_field_generation/)             | Owns focused AI operations for unresolved card fields.                                     |
| [`card_field_generation_evals`](./card_field_generation_evals/) | Back-tests those operations against basis-labeled conversion references.                   |
| [`card_model`](./card_model/)                                   | Owns the production Anki card templates, styles, font, and setup workflow.                 |
| [`card_previewer`](./card_previewer/)                           | Previews dictionary-entry styles and card templates with shared representative fixtures.   |
| [`card_updater`](./card_updater/)                               | Reviews and applies changes caused by new JMDict revisions.                                |
| [`data`](./data/)                                               | Owns JMDict and rarity resource access, provenance, downloads, and checked-in samples.     |
| [`jmdict_to_html`](./jmdict_to_html/)                           | Renders semantic JMDict HTML.                                                              |
| [`rarity_score`](./rarity_score/)                               | Scores recognition-target rarity using the generated corpus resources.                     |
| [`anki_updater_prototype`](./anki_updater_prototype/)           | Preserves recurring and potentially reusable personal Anki workflows at prototype quality. |

Reusable packages expose their public APIs through `src/mod.ts` and declared subpaths. Executable packages use `src/main.ts` for the Deno entrypoint and keep browser code under `src/client/`. Auxiliary commands belong in `scripts/`, and tests and their fixtures belong in `test/`.

The prototype package is deliberately exempt from the maintained packages' source-layout standard, but it still uses public workspace imports and declared tasks.

## Development

Deno's built-in commands are used directly for individual checks:

```sh
deno fmt
deno lint
deno check --doc --frozen
```

The root tasks coordinate checks that need workspace configuration:

```sh
deno task test
deno task --recursive doc:check
deno task --recursive --if-present build
deno task ci
```

Package-specific workflows are run from the repository root with `--cwd`, for example `deno task --cwd data update:jmdict` or `deno task --cwd card_previewer dev`. Each package README documents its own prerequisites, outputs, and tasks. Related tasks use `:` namespaces, so patterns such as `deno task --cwd data "download:*"` can run a family in parallel.

## Checked-in and local artifacts

The repository uses the same artifact boundaries in each maintained package:

- `build/` contains reproducible, disposable build output. It is ignored by Git.
- `generated/` contains local downloads, derived databases, caches, run results, and other workflow state. It is ignored by Git and may be expensive or impossible to reconstruct exactly.
- `resources/` contains intentionally checked-in runtime or sample data, including data derived by a documented refresh task.
- `test/fixtures/` contains checked-in data used only by tests.

The full JMDict, Lorenzi's Jisho furigana segmentation data, NWJC, and BCCWJ inputs are local resources. Clean checkouts and CI use a small checked-in JMDict subset, so ordinary tests and builds do not require downloading the full datasets. See the [`data` package](./data/) for setup and provenance.
