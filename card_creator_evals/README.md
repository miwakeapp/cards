# Card Creator Evals

Evaluates `card_creator`'s AI-generated fields against a checked-in set of contexts and reviewed goldens. Inputs and goldens are source material; model run results are local artifacts stored under `generated/runs/`.

Run every configured model, or select one:

```sh
deno task --cwd card_creator_evals run
deno task --cwd card_creator_evals run --model=claude-opus-4-8
```

The runner needs the relevant provider API keys from the root `.env` file. It writes one directory per timestamp and model. Inspect runs in the local comparison app:

```sh
deno task --cwd card_creator_evals dev
```

After reviewing a run, promote all or part of it to the checked-in goldens:

```sh
deno task --cwd card_creator_evals accept --run=2026-07-13T12-00-00
deno task --cwd card_creator_evals accept --run=2026-07-13T12-00-00 --model=claude-opus-4-8
```

`fetch:samples` can create inputs from a running Anki collection, but the resulting files should be reviewed and minimized before committing. Known cases that still need coverage are recorded in `KNOWN_FAILURES.md`.
