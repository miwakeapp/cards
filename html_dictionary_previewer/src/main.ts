import { renderEntry } from "../../jmdict_to_html/src/mod.ts";
import type { JMdictWord } from "../../jmdict_to_html/src/mod.ts";

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
    const wrapper = document.createElement("div");
    wrapper.className = "entry-wrapper";

    const article = document.createElement("article");
    article.className = "dictionary-entry";
    article.dataset.entryId = entry.id;
    if (nightMode) {
      article.classList.add("night-mode", "nightMode", "night_mode");
    }
    article.innerHTML = renderEntry(entry);
    wrapper.appendChild(article);

    const externalLinks = buildExternalLinks(entry);
    if (externalLinks.length > 0) {
      const linkContainer = document.createElement("div");
      linkContainer.className = "dictionary-entry-links";
      for (const { label, href } of externalLinks) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.textContent = label;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        linkContainer.appendChild(anchor);
      }
      wrapper.appendChild(linkContainer);
    }
    fragment.appendChild(wrapper);
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

type ExternalLink = {
  label: string;
  href: string;
};

function buildExternalLinks(entry: JMdictWord): ExternalLink[] {
  const links: ExternalLink[] = [];
  if (entry.id) {
    links.push({
      label: "View on Takoboto",
      href: `https://takoboto.jp/?w=${encodeURIComponent(entry.id)}`,
    });
  }

  const primaryTerm = getPrimaryLookupTerm(entry);
  if (primaryTerm) {
    links.push({
      label: "View on Jisho",
      href: `https://jisho.org/word/${encodeURIComponent(primaryTerm)}`,
    });
  }

  return links;
}

function getPrimaryLookupTerm(entry: JMdictWord): string | undefined {
  const kanji = entry.kanji?.[0]?.text;
  if (kanji) {
    return kanji;
  }
  const kana = entry.kana?.[0]?.text;
  if (kana) {
    return kana;
  }
  return undefined;
}
