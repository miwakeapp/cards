# Miwake Card Model

Owns the production Anki card templates and styles for the Miwake note type.

The installable files live in `assets/`:

- `front.html` and `back.html` are the Anki card templates.
- `styles_prefix.css` contains the card chrome and is prepended to `minimal.css`, which styles the semantic JMDict HTML.
- `NotoSerifJP-VariableFont_wght.ttf` is used by the local previewer and corresponds to the `_NotoSerifJP-VariableFont_wght.ttf` file referenced from the Anki stylesheet.

To create the note type in a running Anki instance with AnkiConnect installed:

```sh
deno task --cwd card_model setup
```

The setup task creates a new `Miwake` note type and stops if one already exists. Edit the files in `assets/` to change the production model; `card_previewer` reads the same files directly.
