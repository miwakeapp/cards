# JMDict to HTML

Renders a `jmdict-simplified` entry as semantic HTML for Miwake cards.

```ts
import { renderEntry } from "jmdict_to_html";

const html = renderEntry(jmdictEntry);
```

HTML rendering uses the checked-in JMDict tag descriptions in the `data` package. Within each sense, a British English gloss is omitted when an otherwise-identical American English gloss is present.

Run the package tests with `deno test -P jmdict_to_html`. Update intentional HTML snapshot changes with `deno task --cwd jmdict_to_html test:update`.
