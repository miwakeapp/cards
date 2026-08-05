import type { JMDictWord } from "data";
import { renderEntry } from "jmdict_to_html";
import type { Key } from "./keys.ts";

const ENTRY_PATTERN = /<div\s+class="miwake-dictionary-entry">\s*([\s\S]*?)\s*<\/div>/g;

/** Renders every JMDict entry represented by one card as canonical `Dictionary` field HTML. */
export function renderDictionaryField(entries: readonly JMDictWord[]): string {
  if (entries.length === 0) throw new Error("entries must contain at least one JMDict entry");
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new Error("entries must not repeat a JMDict entry");
  }

  return entries.toSorted((left, right) => Number(left.id) - Number(right.id)).map((entry) => {
    const html = renderEntry(entry).split("\n").map((line) => `  ${line}`).join("\n");
    return `<div class="miwake-dictionary-entry">\n` +
      `${html}\n</div>`;
  }).join("\n");
}

/**
 * Splits a stored field into its independently rendered entries, pairing canonical wrapper order
 * with canonical Key usage order. Malformed or incomplete compositions fail closed.
 */
export function splitDictionaryField(
  html: string,
  parsedKey: Key,
): ReadonlyMap<string, string> | null {
  const trimmed = html.trim();
  const entryHTML: string[] = [];
  let cursor = 0;
  for (const match of trimmed.matchAll(ENTRY_PATTERN)) {
    if (trimmed.slice(cursor, match.index).trim() !== "") return null;
    entryHTML.push(
      match[1].trim().split("\n").map((line) => line.startsWith("  ") ? line.slice(2) : line).join(
        "\n",
      ),
    );
    cursor = match.index! + match[0].length;
  }
  if (trimmed.slice(cursor).trim() !== "") return null;
  if (entryHTML.length !== parsedKey.usages.length) return null;
  return new Map(
    parsedKey.usages.map(({ jmdictId }, index) => [jmdictId, entryHTML[index]]),
  );
}
