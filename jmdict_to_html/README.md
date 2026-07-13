# JMDict to HTML

Renders a `jmdict-simplified` entry as semantic HTML for Miwake cards.

```ts
import { renderEntry } from "jmdict_to_html";

const html = renderEntry(jmdictEntry);
```

The `jmdict_to_html/format-reading-for-anki` subpath formats a particular spelling and reading using Anki's bracket-based furigana syntax:

```ts
import { formatReadingForAnki } from "jmdict_to_html/format-reading-for-anki";

const reading = await formatReadingForAnki("2252350", "大人買い", "おとながい");
```

HTML rendering uses the checked-in JMDict tag descriptions in the `data` package. Furigana formatting uses its full local furigana resource; download that with `deno task --cwd data download:furigana`.

Run the package tests with `deno test -P jmdict_to_html`. Update intentional HTML snapshot changes with `deno task --cwd jmdict_to_html test:update`.
