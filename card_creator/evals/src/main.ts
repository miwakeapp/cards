import type {
  AIGeneratedFields,
  EvalGolden,
  EvalInput,
  EvalOutput,
} from "../../src/eval_types.ts";
import { EVAL_MODEL_IDS } from "../../src/eval_types.ts";

interface Example {
  input: EvalInput;
  golden: EvalGolden;
  results: Map<string, EvalOutput>;
}
const FIELD_NAMES: (keyof AIGeneratedFields)[] = ["applicableSenses", "reading", "hint", "minimizedContext"];

const runSelect = document.getElementById("run-select") as HTMLSelectElement;
const examplesContainer = document.getElementById("examples") as HTMLElement;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function discoverRuns(): Promise<string[]> {
  // Fetch the runs directory listing - Lume serves directory listings as JSON
  // when Accept header is application/json, but we'll use a manifest approach
  // For now, we'll try to fetch known run timestamps
  const runsResponse = await fetch("/runs/");
  const text = await runsResponse.text();

  // Parse directory listing from HTML
  const runs = new Set<string>();
  const regex = /href="([^"]+_[^"]+)\/"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const dirname = match[1];
    // Extract timestamp from dirname like "2025-12-21T02-39-55_gpt-5.1"
    const timestamp = dirname.split("_")[0];
    runs.add(timestamp);
  }

  return Array.from(runs).sort().reverse();
}

async function discoverInputIds(): Promise<string[]> {
  const inputsResponse = await fetch("/inputs/");
  const text = await inputsResponse.text();

  const ids: string[] = [];
  const regex = /href="([^"]+)\.json"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.push(decodeURIComponent(match[1]));
  }

  return ids;
}

async function loadExamples(timestamp: string): Promise<Example[]> {
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

    await Promise.all(EVAL_MODEL_IDS.map(async (model) => {
      try {
        const result = await fetchJson<EvalOutput>(
          `/runs/${timestamp}_${model}/${encodedId}.json`
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

function renderExample(example: Example): HTMLElement {
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
    ${EVAL_MODEL_IDS.map(m => `<div class="model-column">${m.replace("-preview", "")}</div>`).join("")}
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

    for (const model of EVAL_MODEL_IDS) {
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

function render(examples: Example[]) {
  examplesContainer.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const example of examples) {
    fragment.appendChild(renderExample(example));
  }

  examplesContainer.appendChild(fragment);
}

async function init() {
  try {
    const runs = await discoverRuns();

    if (runs.length === 0) {
      examplesContainer.textContent = "No eval runs found.";
      return;
    }

    // Populate run selector
    for (const run of runs) {
      const option = document.createElement("option");
      option.value = run;
      option.textContent = run;
      runSelect.appendChild(option);
    }

    // Load initial run
    const examples = await loadExamples(runs[0]);
    render(examples);

    // Handle run changes
    runSelect.addEventListener("change", async () => {
      const examples = await loadExamples(runSelect.value);
      render(examples);
    });
  } catch (error) {
    console.error(error);
    examplesContainer.textContent = "Failed to load eval data.";
  }
}

init();
