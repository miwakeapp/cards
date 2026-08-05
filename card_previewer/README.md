# Miwake Cards Previewer

Provides two high-fidelity local views over one curated fixture catalog:

- The dictionary-entry view renders one fixture at a time using either of the available Miwake Cards dictionary styles.
- The card-template view loads the real `front.html`, `back.html`, `styles_prefix.css`, and `minimal.css`, with editable raw Anki fields and adjustable card widths.

It is a development tool for Miwake Cards HTML and CSS, not a deployed application.

```sh
deno task --cwd card_previewer dev
```

Both views use the fixture definitions in `src/fixtures.ts` and display why each entry is useful. The generated dictionary HTML is also the value of the card fixture's `Dictionary` field, so both views exercise the same source data.

The card preview can switch between front and back, edit every user-visible card field, exercise conditional template branches, and report the rendered line breaks and heights of the front recognition target and back reading. Field editors contain the values Anki stores, including bracket-based furigana such as `食[た]べる`; the preview applies the same bracket-to-ruby transformation when a template uses the `furigana:` field filter.

Edit the checked-in model, dictionary style, or fixture files to change the preview. The **Reload model files** button refreshes the card template and styles after an edit; reloading the browser refreshes everything.

The build renders the selected checked-in entries from the `data` package and bundles the browser clients into the ignored `build/` directory. By default, the local server listens on `http://127.0.0.1:8000/`; `HOST` and `PORT` can override that address. It serves only the preview clients, generated preview data, and model assets needed for the card view.
