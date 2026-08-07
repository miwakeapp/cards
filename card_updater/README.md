# Card Updater

Updates existing Miwake cards when JMDict changes. One command runs the whole workflow:

```sh
deno task --cwd card_updater update:cards
```

This downloads the latest JMDict and furigana resources when needed, scans the collection read-only, classifies every card, pre-works the ambiguous ones with AI, and opens a local review app. Decisions persist under `generated/` as you make them, and the Apply button writes accepted updates back to Anki via AnkiConnect.

The workflow requires a running Anki with AnkiConnect, plus the AI provider credentials described in the root `.env.sample`. Use `--skip-ai` when reviewing without provider access.

## How cards are classified

- **Unchanged** — stored dictionary HTML already matches the latest rendering. Not shown.
- **Normalize** — differs only in entity encoding or whitespace. Applied with everything else, but not surfaced for review.
- **Routine** — the senses the card tests are unaffected (single-sense entries, changes to other senses or metadata, pure renumberings), or the stored pronunciation is unchanged and only its furigana boundaries moved. Staged to update by default; the app shows a compact diff for each so they can be skimmed and individually held.
- **Re-target** — a targeted sense changed, moved away, or the entry changed shape under an all-senses card. Focused AI first selects senses from the card's marked original context. It then generates a source-grounded hint whenever another semantic usage is visible from the exact front-side spelling, including unselected senses in the entry, senses available only through another reading, and other same-spelling entries. The app presents the selection, an editable hint, and word-level diffs for one-keystroke review. When the context matches no sense or cannot distinguish between possible senses, the updater fails closed and leaves the card for manual review instead of proposing a guess.
- **Exception** — deleted entries, removed spellings, unparseable keys, and other structural problems. Listed for manual handling and never overwritten.

Existing hints are preserved by default and a newly generated hint is offered as an alternative. Selecting every reading-compatible sense in the entry does not by itself make a hint redundant: the front still omits the reading and may expose another sense or entry. Reviewers can clear a hint when no semantically distinct front-side usage remains.

The focused sense and hint operations use their independently evaluated production model and effort settings. `--model=...` explicitly overrides the provider model for both operations while retaining each operation's production reasoning effort. The review UI reports the actual model-and-effort configuration IDs used for every suggestion.

## Useful flags

```sh
deno task --cwd card_updater update:cards --dry-run      # disable the Apply button
deno task --cwd card_updater update:cards --limit=50     # analyze a subset; Apply is disabled
deno task --cwd card_updater update:cards --skip-ai      # no AI calls; re-targets reviewed manually
deno task --cwd card_updater update:cards --model=gpt-5.6-sol  # override both focused operations' model
deno task --cwd card_updater update:cards --offline      # don't check for newer dictionary or furigana data
deno task --cwd card_updater update:cards --accept-large-furigana-change  # allow an inspected large furigana change
deno task --cwd card_updater update:cards --query='deck:"Japanese::Vocabulary"'  # narrow the Miwake notes analyzed
deno task --cwd card_updater update:cards --anki-connect-url=http://surfacepro11:8765  # remote AnkiConnect
```

AnkiConnect defaults to `http://127.0.0.1:8765`. Use `--anki-connect-url` when Anki is running on another machine reachable over the local network or Tailnet.

The updater always constrains its Anki search to the `Miwake` note type. `--query` adds a narrower search within that note type instead of replacing the constraint.

Runs started with `--dry-run` or `--limit` keep the Apply button disabled. Hover over the disabled button for the reason. Limited scans are review-only because duplicate-key safety requires checking the complete query result; restart without `--limit` when you are ready to apply.

The Key is the updater's identity authority. It must use exact canonical syntax; changing an entry or sense is accepted only when the resulting Key and Reading still form a valid recognition card. A single Reading remains plain Anki bracket notation, while several alternatives use one direct `<li>` per reading inside a `<ul>`. Alternatives may be added or removed by hand, but the updater validates the complete resulting set and restores its stable source-independent order. It does not use AI to choose, add, or drop a pronunciation. Every pronunciation must directly support at least one complete JMDict usage, every usage must be directly supported by at least one pronunciation, and the card asserts the stronger semantic rule that every listed pronunciation is acceptable for every selected usage.

`Dictionary` is a generated snapshot, not user-managed identity data. Once the stored blocks are structured well enough to compare with JMDict, every accepted update replaces the whole field with freshly rendered HTML. The updater also checks the complete scanned collection for any shared spelling/entry/sense usage, surfaces every overlap as an exception, and blocks an apply which would introduce one. The numerically first entry is only the deterministic maintenance anchor for focused retargeting. On a multi-entry card, exact sense renumbering and changes confined to unselected senses remain routine, but changes to selected sense content or shared semantic metadata in any entry require renewed manual review of the cross-entry equivalence assertion. A missing supplementary entry or a no-longer-compatible spelling, sense, or pronunciation likewise becomes an exception.

`generated/` holds the decision file, the content-addressed focused-generation JSONL cache, and `apply-log.jsonl` audit log. Repeated identical operation inputs reuse validated results across runs, while forcing a suggestion from the review UI refreshes those results. The suggestion itself is cheaply reconstructed from the independently cached operations, so prompt changes cannot be masked by a stale whole-suggestion cache. Each successful apply record includes the note ID, key transition, written fields, and the before/after values of every updater-managed field, including Reading. Decisions invalidate automatically when a card, its dictionary entry, or its proposed reading changes.
