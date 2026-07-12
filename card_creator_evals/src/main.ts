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

const FIELD_NAMES: Array<keyof AIGeneratedFields> = [
  "applicableSenses",
  "reading",
  "hint",
  "minimizedContext",
];

const runSelect = document.querySelector<HTMLSelectElement>("#run-select")!;
const examplesContainer = document.querySelector<HTMLElement>("#examples")!;

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

async function discoverRuns(): Promise<RunInfo> {
  const entries = await fetchJSON<string[]>("/api/runs");
  const timestamps = new Set<string>();
  const modelIds = new Set<string>();

  for (const entry of entries) {
    // Parse a directory name such as `2025-12-21T02-39-55_gpt-5.1`.
    const separatorIndex = entry.indexOf("_");
    if (separatorIndex !== -1) {
      timestamps.add(entry.slice(0, separatorIndex));
      modelIds.add(entry.slice(separatorIndex + 1));
    }
  }

  return {
    timestamps: Array.from(timestamps).sort().reverse(),
    modelIds: Array.from(modelIds).sort(),
  };
}

async function discoverInputIds(): Promise<string[]> {
  const entries = await fetchJSON<string[]>("/api/inputs");
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.replace(/\.json$/, ""));
}

async function loadExamples(timestamp: string, modelIds: string[]): Promise<Example[]> {
  const inputIds = await discoverInputIds();
  const examples = await Promise.all(inputIds.map(async (inputId): Promise<Example | null> => {
    const encodedId = encodeURIComponent(inputId);
    const [input, golden] = await Promise.all([
      fetchJSON<EvalInput>(`/inputs/${encodedId}.json`),
      fetchJSON<EvalGolden>(`/goldens/${encodedId}.json`).catch(() => null),
    ]);
    if (golden === null) {
      return null;
    }

    const results = new Map<string, EvalOutput>();
    await Promise.all(modelIds.map(async (modelId) => {
      try {
        results.set(
          modelId,
          await fetchJSON<EvalOutput>(`/runs/${timestamp}_${modelId}/${encodedId}.json`),
        );
      } catch {
        // Not every model has a result for every timestamp and input.
      }
    }));
    return { input, golden, results };
  }));
  return examples.filter((example): example is Example => example !== null);
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
    return golden === null || golden === undefined ? "match" : "missing";
  }
  return JSON.stringify(golden) === JSON.stringify(actual) ? "match" : "diff";
}

function renderExample(example: Example, modelIds: string[]): HTMLElement {
  const card = element("article", "example-card");
  const header = document.createElement("header");
  header.append(
    element("h2", undefined, example.input.recognitionTarget),
    element("p", "context", example.input.context),
  );
  card.appendChild(header);

  const grid = element("div", "comparison-grid");
  const headerRow = element("div", "grid-row header-row");
  headerRow.append(
    element("div", "field-name"),
    element("div", "model-column", "Golden"),
    ...modelIds.map((modelId) => element("div", "model-column", modelId.replace("-preview", ""))),
  );
  grid.appendChild(headerRow);

  for (const fieldName of FIELD_NAMES) {
    const row = element("div", "grid-row");
    const goldenValue = example.golden.aiFields[fieldName];
    row.append(
      element("div", "field-name", fieldName),
      element("div", "field-value golden", formatFieldValue(goldenValue)),
    );

    for (const modelId of modelIds) {
      const result = example.results.get(modelId);
      if (result === undefined) {
        row.appendChild(element("div", "field-value no-data", "-"));
        continue;
      }
      const actualValue = result.aiFields[fieldName];
      row.appendChild(
        element(
          "div",
          `field-value ${compareValues(goldenValue, actualValue)}`,
          formatFieldValue(actualValue),
        ),
      );
    }
    grid.appendChild(row);
  }

  card.appendChild(grid);
  return card;
}

function element(tagName: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tagName);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function render(examples: Example[], modelIds: string[]): void {
  examplesContainer.replaceChildren(...examples.map((example) => renderExample(example, modelIds)));
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
