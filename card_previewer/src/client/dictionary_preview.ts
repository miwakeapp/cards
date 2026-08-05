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
const dictionary = document.querySelector<HTMLElement>("#dictionary")!;
const dictionaryIds = document.querySelector<HTMLElement>("#dictionary-ids")!;
const links = document.querySelector<HTMLElement>("#dictionary-links")!;
const STYLE_LINK_ID = "dictionary-style";

let fixtures: PreviewFixture[] = [];

initialize().catch((error) => {
  console.error(error);
  dictionary.textContent = "Unable to load preview data.";
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
  dictionary.innerHTML = fixture.fields["Dictionary"];
  const jmdictIds = [fixture.id, ...(fixture.additionalEntryIds ?? [])].toSorted(
    (left, right) => Number(left) - Number(right),
  );
  dictionaryIds.textContent = `JMDict ${jmdictIds.join(" · ")}`;
  links.replaceChildren(
    ...jmdictIds.map((id) =>
      buildExternalLink(
        jmdictIds.length === 1 ? "View on Takoboto" : `View ${id} on Takoboto`,
        `https://takoboto.jp/?w=${encodeURIComponent(id)}`,
      )
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
