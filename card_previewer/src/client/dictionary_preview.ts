import {
  buildExternalLink,
  loadFixtures,
  populateFixtureSelect,
  renderFixtureReason,
  selectedFixture,
} from "./shared.ts";
import type { PreviewFixture } from "../fixtures.ts";

const fixtureSelect = document.querySelector<HTMLSelectElement>("#fixture")!;
const fixtureReason = document.querySelector<HTMLElement>("#fixture-reason")!;
const styleSelect = document.querySelector<HTMLSelectElement>("#style")!;
const nightModeInput = document.querySelector<HTMLInputElement>("#night-mode")!;
const stage = document.querySelector<HTMLElement>("#dictionary-stage")!;
const entry = document.querySelector<HTMLElement>("#dictionary-entry")!;
const entryId = document.querySelector<HTMLElement>("#entry-id")!;
const links = document.querySelector<HTMLElement>("#dictionary-entry-links")!;
const STYLE_LINK_ID = "dictionary-style";

let fixtures: PreviewFixture[] = [];

initialize().catch((error) => {
  console.error(error);
  entry.textContent = "Unable to load preview data.";
});

async function initialize(): Promise<void> {
  fixtures = await loadFixtures();
  populateFixtureSelect(fixtureSelect, fixtures);

  fixtureSelect.addEventListener("change", render);
  styleSelect.addEventListener("change", renderStyles);
  nightModeInput.addEventListener("change", renderStyles);

  render();
}

function render(): void {
  const fixture = selectedFixture(fixtureSelect, fixtures);
  renderFixtureReason(fixtureReason, fixture);
  entry.dataset.entryId = fixture.id;
  entry.innerHTML = fixture.fields["Dictionary entry"];
  entryId.textContent = `JMDict ${fixture.id}`;
  links.replaceChildren(
    buildExternalLink(
      "View on Takoboto",
      `https://takoboto.jp/?w=${encodeURIComponent(fixture.id)}`,
    ),
    buildExternalLink(
      "View on Jisho",
      `https://jisho.org/word/${encodeURIComponent(fixture.primaryTerm)}`,
    ),
  );
  renderStyles();
}

function renderStyles(): void {
  ensureDictionaryStylesheet(styleSelect.value);
  stage.classList.toggle("nightMode", nightModeInput.checked);
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
