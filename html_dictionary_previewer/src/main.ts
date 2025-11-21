import { renderEntry } from "jmdict_to_html";
import type { JMdictWord } from "jmdict_to_html";

const entriesContainer = document.getElementById("entries") as HTMLElement;
const styleSelect = document.getElementById("style") as HTMLSelectElement;
const nightModeInput = document.getElementById("night-mode") as HTMLInputElement;
const STYLE_LINK_ID = "dictionary-style";

const state: { entries: JMdictWord[] } = { entries: [] };

try {
  const response = await fetch(new URL("/data/entries.json", document.baseURI));
  if (!response.ok) {
    throw new Error(`Failed to load entries: ${response.status}`);
  }
  state.entries = (await response.json()) as JMdictWord[];
  bindControls();
  render();
} catch (error) {
  console.error(error);
  entriesContainer.textContent = "Unable to load preview data.";
}

function bindControls() {
  styleSelect.addEventListener("change", render);
  nightModeInput.addEventListener("change", render);
}

function render() {
  ensureDictionaryStylesheet(styleSelect.value);
  const nightMode = nightModeInput.checked;
  const fragment = document.createDocumentFragment();

  for (const entry of state.entries) {
    const article = document.createElement("article");
    article.className = "dictionary-entry";
    article.dataset.entryId = entry.id;
    if (nightMode) {
      article.classList.add("night-mode", "nightMode", "night_mode");
    }
    article.innerHTML = renderEntry(entry);
    fragment.appendChild(article);
  }

  entriesContainer.replaceChildren(fragment);
}

function ensureDictionaryStylesheet(href: string) {
  let link = document.getElementById(STYLE_LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = STYLE_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = href;
}
