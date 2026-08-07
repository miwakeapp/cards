# Miwake Card Model

Owns the persisted Miwake Card contract: production Anki fields, Key and Reading syntax, Dictionary composition, and the templates and styles for the Miwake note type. Card creation policy remains in `card_creator`.

The installable files live in `assets/`:

- `front.html` and `back.html` are the Anki card templates.
- `styles_prefix.css` contains the card chrome and is prepended to `minimal.css`, which styles the semantic JMDict HTML.
- `NotoSerifJP-VariableFont_wght.ttf` is used by the local previewer and corresponds to the `_NotoSerifJP-VariableFont_wght.ttf` file referenced from the Anki stylesheet.

To create the note type in a running Anki instance with AnkiConnect installed:

```sh
deno task --cwd card_model setup
```

The setup task creates a new `Miwake` note type and stops if one already exists. Edit the files in `assets/` to change the production model; `card_previewer` reads the same files directly.

The model has eight fields. Semantic JMDict usages are encoded in canonical numeric-ID order in `Key`; accepted pronunciations use a stable source-independent order in `Reading`. One accepted pronunciation remains plain text, while multiple pronunciations are stored as an HTML list. `Dictionary` always contains one rendered entry block per Key usage, divided by a subtle rule when there is more than one.

The package root exports the canonical `noteTypeName` and `cardTemplateName`, `fieldNames`, the derived `fieldOrder`, and their `FieldName` type, plus the complete `CardFields` result type. Focused subpaths own the rest of the persisted representation:

- `card_model/keys` exposes `parseKey()` and `formatKey()`, with named types for parsed Keys and resolved formatter inputs.
- `card_model/reading` exposes `parseReading()` and `formatReading()`, with a named type for parsed alternatives.
- `card_model/dictionary` exposes `renderDictionaryField()` and `splitDictionaryField()` for complete wrapped Dictionary fields.
