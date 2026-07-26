import { renderAnkiTemplate } from "../anki_template.ts";
import {
  type CardFieldName,
  cardFieldNames,
  type CardFields,
  type PreviewFixture,
} from "../fixtures.ts";
import {
  fetchText,
  loadFixtures,
  populateFixtureSelect,
  renderFixtureReason,
  selectedFixture,
} from "./shared.ts";

interface ModelAssets {
  frontTemplate: string;
  backTemplate: string;
  stylesPrefix: string;
  minimalCSS: string;
}

type CardSide = "front" | "back";

const fieldDescriptions: Record<CardFieldName, { description: string; rows: number }> = {
  "Key": {
    description: "Also controls which dictionary senses the back highlights.",
    rows: 2,
  },
  "Recognition target": {
    description: "Raw HTML shown on the front.",
    rows: 2,
  },
  "Reading": {
    description: "Stored Anki bracket notation; transformed by {{furigana:Reading}}.",
    rows: 3,
  },
  "Hint": {
    description: "Optional front-side hint.",
    rows: 2,
  },
  "Full context": {
    description: "Stored HTML and bracket notation for the full context.",
    rows: 4,
  },
  "Minimized context": {
    description: "Optional shortened context; enables the context expando.",
    rows: 3,
  },
  "Dictionary entry": {
    description: "Generated dictionary-entry HTML stored on the card.",
    rows: 10,
  },
  "Source": {
    description: "Optional source HTML.",
    rows: 2,
  },
};

const fixtureSelect = document.querySelector<HTMLSelectElement>("#fixture")!;
const fixtureReason = document.querySelector<HTMLElement>("#fixture-reason")!;
const sideSelect = document.querySelector<HTMLSelectElement>("#card-side")!;
const widthInput = document.querySelector<HTMLInputElement>("#card-width")!;
const widthOutput = document.querySelector<HTMLOutputElement>("#card-width-output")!;
const nightModeInput = document.querySelector<HTMLInputElement>("#night-mode")!;
const resetFieldsButton = document.querySelector<HTMLButtonElement>("#reset-fields")!;
const reloadSourceButton = document.querySelector<HTMLButtonElement>("#reload-source")!;
const fieldEditors = document.querySelector<HTMLElement>("#field-editors")!;
const measurement = document.querySelector<HTMLElement>("#front-back-measurement")!;
const cardFrame = document.querySelector<HTMLIFrameElement>("#card-frame")!;
const cardStage = document.querySelector<HTMLElement>(".card-stage")!;

let fixtures: PreviewFixture[] = [];
let currentFields: CardFields;
let modelAssets: ModelAssets;
let renderTimer: number | undefined;

initialize().catch((error) => {
  console.error(error);
  cardStage.textContent = "Unable to initialize the card preview.";
});

async function initialize(): Promise<void> {
  [fixtures, modelAssets] = await Promise.all([loadFixtures(), fetchModelAssets()]);
  currentFields = structuredClone(fixtures[0].fields);

  populateFixtureSelect(fixtureSelect, fixtures);
  buildFieldEditors();
  populateFieldEditors();
  updateFixtureDescription();
  updateCardWidth();

  fixtureSelect.addEventListener("change", loadSelectedFixture);
  sideSelect.addEventListener("change", renderCard);
  nightModeInput.addEventListener("change", renderCard);
  widthInput.addEventListener("input", updateCardWidth);
  resetFieldsButton.addEventListener("click", loadSelectedFixture);
  reloadSourceButton.addEventListener("click", reloadModelFiles);
  cardFrame.addEventListener("load", measureCard);

  new ResizeObserver(measureCard).observe(cardFrame);
  renderCard();
}

function buildFieldEditors(): void {
  fieldEditors.replaceChildren(
    ...cardFieldNames.map((name) => {
      const { description, rows } = fieldDescriptions[name];
      const wrapper = document.createElement("label");
      const heading = document.createElement("span");
      heading.textContent = name;
      const help = document.createElement("small");
      help.textContent = description;
      const textarea = document.createElement("textarea");
      textarea.dataset.field = name;
      textarea.rows = rows;
      textarea.spellcheck = false;
      textarea.addEventListener("input", () => {
        currentFields[name] = textarea.value;
        scheduleRender();
      });
      wrapper.append(heading, help, textarea);
      return wrapper;
    }),
  );
}

function loadSelectedFixture(): void {
  currentFields = structuredClone(currentFixture().fields);
  populateFieldEditors();
  updateFixtureDescription();
  renderCard();
}

function updateFixtureDescription(): void {
  renderFixtureReason(fixtureReason, currentFixture());
}

function populateFieldEditors(): void {
  for (
    const textarea of fieldEditors.querySelectorAll<HTMLTextAreaElement>(
      "textarea[data-field]",
    )
  ) {
    const name = textarea.dataset.field as CardFieldName;
    textarea.value = currentFields[name];
  }
}

function currentFixture(): PreviewFixture {
  return selectedFixture(fixtureSelect, fixtures);
}

function scheduleRender(): void {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderCard, 180);
}

function renderCard(): void {
  const renderedFront = renderAnkiTemplate(modelAssets.frontTemplate, currentFields);
  const renderedBack = renderAnkiTemplate(modelAssets.backTemplate, currentFields);
  cardFrame.title = `${currentFixture().optionLabel}, ${sideSelect.value} side`;
  cardFrame.srcdoc = buildCardDocument(renderedFront, renderedBack, modelAssets);
  measurement.textContent = "Measuring front and back…";
}

function buildCardDocument(
  renderedFront: string,
  renderedBack: string,
  { stylesPrefix, minimalCSS }: ModelAssets,
): string {
  const bodyClass = nightModeInput.checked ? ' class="nightMode"' : "";
  const previewStylesPrefix = stylesPrefix.replace(
    'url("_NotoSerifJP-VariableFont_wght.ttf")',
    'url("/model/NotoSerifJP-VariableFont_wght.ttf")',
  );
  const visibleSide = sideSelect.value as CardSide;
  const frontClass = visibleSide === "front" ? "is-visible" : "is-measurement";
  const backClass = visibleSide === "back" ? "is-visible" : "is-measurement";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
${previewStylesPrefix}
${minimalCSS}

html {
  color-scheme: light;
}

body {
  position: relative;
  box-sizing: border-box;
  min-height: 100%;
  padding-bottom: 1rem;
  background: rgb(255 255 255);
  color: rgb(20 20 20);
}

body.nightMode {
  color-scheme: dark;
  background: rgb(48 48 48);
  color: rgb(245 245 245);
}

.card-view.is-measurement {
  position: absolute;
  visibility: hidden;
  inset: 0 auto auto 0;
  width: 100%;
  pointer-events: none;
}
  </style>
</head>
<body${bodyClass}>
<div id="front-card" class="card-view ${frontClass}">
${renderedFront}
</div>
<div id="back-card" class="card-view ${backClass}">
${renderedBack}
</div>
</body>
</html>`;
}

function measureCard(): void {
  const frameDocument = cardFrame.contentDocument;
  if (frameDocument === null) {
    return;
  }

  const update = () => {
    const frontTarget = frameDocument.querySelector<HTMLElement>(
      "#front-card #recognition-target",
    );
    const backReading = frameDocument.querySelector<HTMLElement>("#back-card #reading");
    const visibleCard = frameDocument.querySelector<HTMLElement>(".card-view.is-visible");
    if (frontTarget === null || backReading === null || visibleCard === null) {
      return;
    }

    cardFrame.style.height = `${Math.ceil(visibleCard.scrollHeight + 16)}px`;
    const frontHeight = frontTarget.getBoundingClientRect().height;
    const backHeight = backReading.getBoundingClientRect().height;
    const delta = backHeight - frontHeight;
    const heightsMatch = Math.abs(delta) < 0.5;
    const frontLines = renderedLines(frontTarget);
    const backLines = renderedLines(backReading);
    const wrapsMatch = JSON.stringify(frontLines) === JSON.stringify(backLines);
    const heightSummary = heightsMatch
      ? "no height change"
      : `${delta > 0 ? "+" : ""}${Math.round(delta)} px`;

    measurement.replaceChildren(
      measurementLine(
        `${heightSummary}; wraps ${wrapsMatch ? "match" : "differ"}`,
        "measurement-summary",
      ),
      measurementLine(`Front ${Math.round(frontHeight)} px · ${formatLines(frontLines)}`),
      measurementLine(`Back ${Math.round(backHeight)} px · ${formatLines(backLines)}`),
    );
    measurement.classList.toggle("has-shift", !heightsMatch || !wrapsMatch);
  };

  frameDocument.fonts.ready.then(update);
  requestAnimationFrame(update);
}

function measurementLine(text: string, className = ""): HTMLElement {
  const line = document.createElement("span");
  line.className = className;
  line.textContent = text;
  return line;
}

function renderedLines(element: HTMLElement): string[] {
  const lines = new Map<number, string>();
  const ownerDocument = element.ownerDocument;
  const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("rt")) {
      continue;
    }
    for (let index = 0; index < (node.textContent?.length ?? 0); ++index) {
      const character = node.textContent![index];
      if (/\s/u.test(character)) {
        continue;
      }
      const range = ownerDocument.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      const line = Math.round(rect.top);
      lines.set(line, `${lines.get(line) ?? ""}${character}`);
    }
  }

  return [...lines.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text);
}

function formatLines(lines: string[]): string {
  return lines.length > 0 ? lines.join(" / ") : "(empty)";
}

function updateCardWidth(): void {
  const width = `${widthInput.value}px`;
  widthOutput.value = `${widthInput.value} px`;
  cardStage.style.setProperty("--card-width", width);
}

async function reloadModelFiles(): Promise<void> {
  reloadSourceButton.disabled = true;
  reloadSourceButton.textContent = "Reloading…";
  try {
    modelAssets = await fetchModelAssets();
    renderCard();
  } catch (error) {
    console.error(error);
    measurement.textContent = "Unable to reload the model files.";
  } finally {
    reloadSourceButton.disabled = false;
    reloadSourceButton.textContent = "Reload model files";
  }
}

async function fetchModelAssets(): Promise<ModelAssets> {
  const [frontTemplate, backTemplate, stylesPrefix, minimalCSS] = await Promise.all([
    fetchText("/model/front.html"),
    fetchText("/model/back.html"),
    fetchText("/model/styles_prefix.css"),
    fetchText("/model/minimal.css"),
  ]);
  return { frontTemplate, backTemplate, stylesPrefix, minimalCSS };
}
