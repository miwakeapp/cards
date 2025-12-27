import type { AIGeneratedFields, EvalGolden, EvalInput, EvalOutput } from "./types.ts";

interface Example {
  input: EvalInput;
  golden: EvalGolden;
  results: Map<string, EvalOutput>;
}

interface RunInfo {
  timestamps: string[];
  modelIds: string[];
}

const FIELD_NAMES: (keyof AIGeneratedFields)[] = [
  "applicableSenses",
  "reading",
  "hint",
  "minimizedContext",
];

const runSelect = document.getElementById("run-select") as HTMLSelectElement;
const examplesContainer = document.getElementById("examples") as HTMLElement;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

function parseDirectoryListing(html: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const links = doc.querySelectorAll("li a");
  return Array.from(links).map((a) => decodeURIComponent(a.getAttribute("href") ?? ""));
}

async function discoverRuns(): Promise<RunInfo> {
  const response = await fetch("/runs/");
  const html = await response.text();
  const entries = parseDirectoryListing(html);

  const timestamps = new Set<string>();
  const modelIds = new Set<string>();

  for (const entry of entries) {
    // Parse dirname like "2025-12-21T02-39-55_gpt-5.1/"
    const dirname = entry.replace(/\/$/, "");
    const underscoreIndex = dirname.indexOf("_");
    if (underscoreIndex !== -1) {
      timestamps.add(dirname.slice(0, underscoreIndex));
      modelIds.add(dirname.slice(underscoreIndex + 1));
    }
  }

  return {
    timestamps: Array.from(timestamps).sort().reverse(),
    modelIds: Array.from(modelIds).sort(),
  };
}

async function discoverInputIds(): Promise<string[]> {
  const response = await fetch("/inputs/");
  const html = await response.text();
  const entries = parseDirectoryListing(html);

  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""));
}

async function loadExamples(timestamp: string, modelIds: string[]): Promise<Example[]> {
  const inputIds = await discoverInputIds();
  const examples: Example[] = [];

  for (const inputId of inputIds) {
    const encodedId = encodeURIComponent(inputId);

    const [input, golden] = await Promise.all([
      fetchJson<EvalInput>(`/inputs/${encodedId}.json`),
      fetchJson<EvalGolden>(`/goldens/${encodedId}.json`).catch(() => null),
    ]);

    if (!golden) continue;

    const results = new Map<string, EvalOutput>();

    await Promise.all(modelIds.map(async (model) => {
      try {
        const result = await fetchJson<EvalOutput>(
          `/runs/${timestamp}_${model}/${encodedId}.json`,
        );
        results.set(model, result);
      } catch {
        // Model result not available for this run
      }
    }));

    examples.push({ input, golden, results });
  }

  return examples;
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "(null)";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.join(", ")}]`;
  }
  return String(value);
}

function compareValues(golden: unknown, actual: unknown): "match" | "diff" | "missing" {
  if (actual === null || actual === undefined) {
    if (golden === null || golden === undefined) {
      return "match";
    }
    return "missing";
  }

  const goldenStr = JSON.stringify(golden);
  const actualStr = JSON.stringify(actual);

  return goldenStr === actualStr ? "match" : "diff";
}

function renderExample(example: Example, modelIds: string[]): HTMLElement {
  const card = document.createElement("article");
  card.className = "example-card";

  // Header with input info
  const header = document.createElement("header");
  header.innerHTML = `
    <h2>${example.input.recognitionTarget}</h2>
    <p class="context">${example.input.context}</p>
  `;
  card.appendChild(header);

  // Comparison grid
  const grid = document.createElement("div");
  grid.className = "comparison-grid";

  // Header row
  const headerRow = document.createElement("div");
  headerRow.className = "grid-row header-row";
  headerRow.innerHTML = `
    <div class="field-name"></div>
    <div class="model-column">Golden</div>
    ${modelIds.map((m) => `<div class="model-column">${m.replace("-preview", "")}</div>`).join("")}
  `;
  grid.appendChild(headerRow);

  // Field rows
  for (const fieldName of FIELD_NAMES) {
    const row = document.createElement("div");
    row.className = "grid-row";

    const goldenValue = example.golden.aiFields[fieldName];

    let rowHtml = `
      <div class="field-name">${fieldName}</div>
      <div class="field-value golden">${formatFieldValue(goldenValue)}</div>
    `;

    for (const model of modelIds) {
      const result = example.results.get(model);
      if (result) {
        const actualValue = result.aiFields[fieldName];
        const status = compareValues(goldenValue, actualValue);
        rowHtml += `<div class="field-value ${status}">${formatFieldValue(actualValue)}</div>`;
      } else {
        rowHtml += `<div class="field-value no-data">-</div>`;
      }
    }

    row.innerHTML = rowHtml;
    grid.appendChild(row);
  }

  card.appendChild(grid);
  return card;
}

function render(examples: Example[], modelIds: string[]) {
  examplesContainer.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const example of examples) {
    fragment.appendChild(renderExample(example, modelIds));
  }

  examplesContainer.appendChild(fragment);
}

try {
  const { timestamps, modelIds } = await discoverRuns();

  if (timestamps.length === 0) {
    examplesContainer.textContent = "No eval runs found.";
  } else {
    for (const timestamp of timestamps) {
      const option = document.createElement("option");
      option.value = timestamp;
      option.textContent = timestamp;
      runSelect.appendChild(option);
    }

    render(await loadExamples(timestamps[0], modelIds), modelIds);

    runSelect.addEventListener("change", async () => {
      render(await loadExamples(runSelect.value, modelIds), modelIds);
    });
  }
} catch (error) {
  console.error(error);
  examplesContainer.textContent = "Failed to load eval data.";
}
