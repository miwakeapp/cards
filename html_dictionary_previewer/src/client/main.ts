interface PreviewEntry {
  id: string;
  primaryTerm: string;
  html: string;
}

const entriesContainer = document.querySelector<HTMLElement>("#entries")!;
const styleSelect = document.querySelector<HTMLSelectElement>("#style")!;
const nightModeInput = document.querySelector<HTMLInputElement>("#night-mode")!;
const STYLE_LINK_ID = "dictionary-style";

try {
  const response = await fetch(new URL("/data/entries.json", document.baseURI));
  if (!response.ok) {
    throw new Error(`Failed to load entries: ${response.status}`);
  }
  const entries = await response.json() as PreviewEntry[];
  bindControls();
  render(entries);
} catch (error) {
  console.error(error);
  entriesContainer.textContent = "Unable to load preview data.";
}

function bindControls(): void {
  styleSelect.addEventListener("change", renderStyles);
  nightModeInput.addEventListener("change", renderStyles);
}

function render(entries: PreviewEntry[]): void {
  renderStyles();
  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const wrapper = document.createElement("div");
    wrapper.className = "entry-wrapper";

    const article = document.createElement("article");
    article.className = "miwake-dictionary-entry";
    article.dataset.entryId = entry.id;
    article.innerHTML = entry.html;
    wrapper.appendChild(article);

    const linkContainer = document.createElement("div");
    linkContainer.className = "dictionary-entry-links";
    linkContainer.append(
      buildExternalLink(
        "View on Takoboto",
        `https://takoboto.jp/?w=${encodeURIComponent(entry.id)}`,
      ),
      buildExternalLink(
        "View on Jisho",
        `https://jisho.org/word/${encodeURIComponent(entry.primaryTerm)}`,
      ),
    );
    wrapper.appendChild(linkContainer);
    fragment.appendChild(wrapper);
  }

  entriesContainer.replaceChildren(fragment);
}

function renderStyles(): void {
  ensureDictionaryStylesheet(styleSelect.value);
  document.documentElement.classList.toggle("night-mode", nightModeInput.checked);
}

function ensureDictionaryStylesheet(href: string): void {
  let link = document.querySelector<HTMLLinkElement>(`#${STYLE_LINK_ID}`);
  if (link === null) {
    link = document.createElement("link");
    link.id = STYLE_LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = href;
}

function buildExternalLink(label: string, href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = label;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}
