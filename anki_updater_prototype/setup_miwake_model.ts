/**
 * Sets up (or refreshes) the Miwake note type via AnkiConnect.
 *
 * - Fields (in order, with Key first for sorting/browsing):
 *   Key, Recognition target, Reading, Hint, Full context, Minimized context,
 *   Dictionary entry, Source, Source URL
 * - Templates match the current Anki model (furigana:Reading fallback).
 * - CSS = card chrome + current minimal.css (night-mode aware).
 *
 * Run with: deno run --allow-read --allow-net anki_updater_prototype/setup_miwake_model.ts
 */

const MODEL_NAME = "Miwake";
const DECK_NAME = "Mining"; // existing target deck
const FIELDS = [
  "Key",
  "Recognition target",
  "Reading",
  "Hint",
  "Full context",
  "Minimized context",
  "Dictionary entry",
  "Source",
  "Source URL",
];

const front = `<p id="recognition-target" lang="ja">{{Recognition target}}</p>

{{#Hint}}
<p id="hint" lang="ja">{{Hint}}</p>
{{/Hint}}`;

const back = `<p id="reading" lang="ja">{{furigana:Reading}}{{^Reading}}{{furigana:Recognition target}}{{/Reading}}</p>

<div id="dictionary-entry" class="miwake-dictionary-entry">
{{Dictionary entry}}
</div>

<p id="context" lang="ja">{{furigana:Minimized context}}{{^Minimized context}}{{furigana:Full context}}{{/Minimized context}}</p>`;

// Card-level styling: font-face for Anki media font, layout for word/reading/context,
// then append the shared dictionary minimal CSS from disk.
const minimalCssPath = new URL("../html_dictionary_previewer/src/styles/minimal.css", import.meta.url);
const minimalCss = await Deno.readTextFile(minimalCssPath);
const cardChromeCss = String.raw`
@font-face {
  font-family: "Noto Serif Japanese";
  src: url("_NotoSerifJP-VariableFont_wght.ttf");
  font-display: swap;
}

:lang(ja) {
  font-family: "Noto Serif Japanese", serif;
}

:lang(en) {
  font-family: sans-serif;
}

body {
  margin: 0;
  padding: 0;
}

#recognition-target {
  font-size: 2.2rem;
  text-align: center;
  margin: 0;
  margin-top: 0.5rem;
}

#hint {
  margin-top: 0.5rem;
  text-align: center;
  color: gray;
}

#reading {
  font-size: 2.2rem;
  text-align: center;
  margin: 0;
  margin-top: 0.75rem;
  margin-bottom: 0.6rem;
}

#dictionary-entry {
  margin-top: 0.5rem;
}

#context {
  margin-top: 1rem;
  line-height: 1.6;
  text-align: center;
  font-size: 1.4rem;

  mark {
    background: none;
    font-weight: 700;
    color: inherit;
  }
}
`;

const combinedCss = `${cardChromeCss}\n${minimalCss}`;

type ACParams = Record<string, unknown>;
async function ac(action: string, params: ACParams = {}) {
  const body = { action, version: 6, params };
  const resp = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.error) {
    throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
  }
  return json.result;
}

const models: string[] = await ac("modelNames");
const exists = models.includes(MODEL_NAME);

if (!exists) {
  console.log(`Creating model ${MODEL_NAME}...`);
  await ac("createModel", {
    modelName: MODEL_NAME,
    inOrderFields: FIELDS,
    css: combinedCss,
    cardTemplates: [
      {
        Name: "Miwake Card",
        Front: front,
        Back: back,
      },
    ],
  });
} else {
  console.log(`Updating existing model ${MODEL_NAME}...`);
  // Update templates
  await ac("updateModelTemplates", {
    model: {
      name: MODEL_NAME,
      templates: {
        "Miwake Card": { Front: front, Back: back },
      },
    },
  });
  // Update styling
  await ac("updateModelStyling", {
    model: { name: MODEL_NAME, css: combinedCss },
  });
  // Reorder fields to ensure Key is first, etc.
  for (let i = 0; i < FIELDS.length; i++) {
    await ac("modelFieldReposition", {
      modelName: MODEL_NAME,
      fieldName: FIELDS[i],
      index: i,
    });
  }
}

// Optional: ensure deck exists
await ac("createDeck", { deck: DECK_NAME });

console.log("Done. Note: if Anki still sorts on a different field, set the sort field to Key in Anki's 'Manage Note Types' UI.");
