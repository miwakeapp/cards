# Card Updater

Updates existing Miwake cards when JMDict changes. One command runs the whole workflow:

```sh
deno task update-cards
```

This downloads the latest JMDict release (only when newer than `data/jmdict_eng.json`), scans the collection (read-only), classifies every card, pre-works the ambiguous ones with AI, and opens a local review app. Decisions persist to `runs/decisions.json` as you make them, and the Apply button writes accepted updates back to Anki via AnkiConnect.

## How cards are classified

- **Unchanged** — stored dictionary HTML already matches the latest rendering. Not shown.
- **Normalize** — differs only in entity encoding or whitespace. Applied with everything else, but not surfaced for review.
- **Routine** — the senses the card tests are unaffected (single-sense entries, changes to other senses or metadata, pure renumberings). Staged to update by default; the app shows a compact diff for each so they can be skimmed and individually held.
- **Re-target** — a targeted sense changed, moved away, or the entry changed shape under an all-senses card. AI re-runs sense determination using `card_creator`'s canonical prompt with the card's original mined context, and the app presents its selection, an editable hint, and word-level diffs for one-keystroke review.
- **Exception** — deleted entries, removed spellings, unparseable keys. Listed for manual handling.

Existing hints are never overwritten by default; the AI's hint is offered as an alternative.

## Useful flags

```sh
deno task update-cards -- --dry-run      # disable the Apply button
deno task update-cards -- --limit=50     # analyze a subset
deno task update-cards -- --skip-ai      # no AI calls; re-targets reviewed manually
deno task update-cards -- --offline      # don't check for a newer JMDict
deno task update-cards -- --query='...'  # different Anki search
```

`runs/` (gitignored) holds the decision file, the AI suggestion cache, and an apply audit log. Decisions and cached suggestions invalidate automatically when a card or its dictionary entry changes.
