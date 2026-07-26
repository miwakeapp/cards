import type { PreviewFixture } from "../fixtures.ts";

export async function loadFixtures(): Promise<PreviewFixture[]> {
  const response = await fetch(new URL("/data/fixtures.json", document.baseURI), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to load preview fixtures: ${response.status}`);
  }
  return response.json() as Promise<PreviewFixture[]>;
}

export function populateFixtureSelect(
  select: HTMLSelectElement,
  fixtures: readonly PreviewFixture[],
): void {
  select.replaceChildren(
    ...fixtures.map((fixture) => {
      const option = document.createElement("option");
      option.value = fixture.id;
      option.textContent = fixture.optionLabel;
      return option;
    }),
  );
}

export function selectedFixture(
  select: HTMLSelectElement,
  fixtures: readonly PreviewFixture[],
): PreviewFixture {
  return fixtures.find(({ id }) => id === select.value) ?? fixtures[0];
}

export function renderFixtureReason(
  element: HTMLElement,
  fixture: PreviewFixture,
): void {
  element.textContent = fixture.reason;
}

export function buildExternalLink(label: string, href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.textContent = label;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(new URL(url, document.baseURI), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.text();
}
