# HTML Dictionary Previewer

Displays the checked-in JMDict sample entries using the available Miwake dictionary styles. It is a local visual-development tool for `jmdict_to_html`, not a deployed application.

```sh
deno task --cwd html_dictionary_previewer dev
```

The build renders the checked-in entries from the `data` package and transpiles the browser client into the ignored `build/` directory. The local server listens on `http://127.0.0.1:8000/` and serves only the client assets and generated preview data.
