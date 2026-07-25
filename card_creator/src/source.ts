import { escape } from "@std/html/entities";
import type { CardSource } from "./types.ts";

function canonicalLanguageTag(lang: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(lang);
    if (canonical === undefined) {
      throw new RangeError("Intl.getCanonicalLocales() returned no language tags");
    }
    return canonical;
  } catch {
    throw new Error(
      `source.lang ${JSON.stringify(lang)} must be accepted by Intl.getCanonicalLocales()`,
    );
  }
}

function canonicalURL(url: string): string {
  try {
    return new URL(url).href;
  } catch (cause) {
    throw new TypeError(`source.url ${JSON.stringify(url)} must be an absolute URL`, { cause });
  }
}

/** Formats already-resolved source metadata for the Miwake Card's `Source` field. */
export function formatSourceHTML(source: CardSource | undefined): string | null {
  if (source === undefined) return null;
  if (source.text === "" || source.text !== source.text.trim()) {
    throw new Error(
      `source.text ${JSON.stringify(source.text)} must be nonempty and have no surrounding ` +
        `whitespace`,
    );
  }

  const lang = canonicalLanguageTag(source.lang);
  const url = source.url === undefined ? undefined : canonicalURL(source.url);
  const label = escape(source.text);

  if (url === undefined) {
    return `<span lang="${lang}">${label}</span>`;
  }
  return `<a lang="${lang}" href="${escape(url)}">${label}</a>`;
}
