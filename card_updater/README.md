# Card Updater

Updates existing Miwake cards when JMDict changes. One command runs the whole workflow:

```sh
deno task --cwd card_updater update:cards
```

This downloads the latest JMDict release when needed, scans the collection read-only, classifies every card, pre-works the ambiguous ones with AI, and opens a local review app. Decisions persist under `generated/` as you make them, and the Apply button writes accepted updates back to Anki via AnkiConnect.

The workflow requires a running Anki with AnkiConnect, plus the AI provider credentials described in the root `.env.sample`. Use `--skip-ai` when reviewing without provider access.

## How cards are classified

- **Unchanged** — stored dictionary HTML already matches the latest rendering. Not shown.
- **Normalize** — differs only in entity encoding or whitespace. Applied with everything else, but not surfaced for review.
- **Routine** — the senses the card tests are unaffected (single-sense entries, changes to other senses or metadata, pure renumberings). Staged to update by default; the app shows a compact diff for each so they can be skimmed and individually held.
- **Re-target** — a targeted sense changed, moved away, or the entry changed shape under an all-senses card. AI re-runs sense determination using `card_creator`'s canonical prompt with the card's original mined context, and the app presents its selection, an editable hint, and word-level diffs for one-keystroke review.
- **Exception** — deleted entries, removed spellings, unparseable keys. Listed for manual handling.

Existing hints are never overwritten by default; the AI's hint is offered as an alternative.

## Useful flags

```sh
deno task --cwd card_updater update:cards --dry-run      # disable the Apply button
deno task --cwd card_updater update:cards --limit=50     # analyze a subset; Apply is disabled
deno task --cwd card_updater update:cards --skip-ai      # no AI calls; re-targets reviewed manually
deno task --cwd card_updater update:cards --offline      # don't check for a newer JMDict
deno task --cwd card_updater update:cards --query='...'  # different Anki search
deno task --cwd card_updater update:cards --anki-connect-url=http://surfacepro11:8765  # remote AnkiConnect
```

AnkiConnect defaults to `http://127.0.0.1:8765`. Use `--anki-connect-url` when Anki is running on another machine reachable over the local network or Tailnet.

Runs started with `--dry-run` or `--limit` keep the Apply button disabled. Hover over the disabled button for the reason. Limited scans are review-only because duplicate-key safety requires checking the complete query result; restart without `--limit` when you are ready to apply.

`generated/` holds the decision file, AI suggestion cache, and `apply-log.jsonl` audit log. Each successful apply record includes the note ID, key transition, written fields, and the before/after values of every updater-managed field. Decisions and cached suggestions invalidate automatically when a card or its dictionary entry changes.
