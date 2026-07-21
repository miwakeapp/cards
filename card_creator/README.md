# Card Creator

Creates complete Miwake Card fields from a recognition target, its context, and a JMDict entry. Card construction is independent of any particular AI provider: callers supply the function that generates the inferred fields.

```ts
import { createCard } from "card_creator";
import { DEFAULT_MODEL_ID, generateCardFields } from "card_creator/ai";

const card = await createCard({
  input,
  jmdictEntry,
  generateFields: (generationInput) => generateCardFields(generationInput, DEFAULT_MODEL_ID),
});
```

`card_creator/ai` contains the supported model IDs and canonical AI field generator. It reads the corresponding provider API key from the environment when a model is used. See the repository `.env.sample` for the supported variables.

`card_creator/keys` is the lightweight entrypoint for parsing and formatting Miwake Card keys. Consumers that only need key handling should use that subpath so they do not load card rendering or AI dependencies.

Card construction uses JMDict furigana data from the `data` package. Download the full local resource with:

```sh
deno task --cwd data download:furigana
```

Run the package tests with `deno test -P card_creator`. Update intentional snapshot changes with `deno task --cwd card_creator test:update`.
