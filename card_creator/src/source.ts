import { escape } from "@std/html/entities";

function inferSourceLanguage(sourceText: string): "ja" | "en" {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/v.test(sourceText) ? "ja" : "en";
}

/** Formats a source name and optional public URL for the Miwake `Source` field. */
export function formatSourceHTML(
  sourceText: string | null,
  sourceURL: string | null,
): string | null {
  if (sourceText === null && sourceURL === null) return null;

  const label = sourceText ?? sourceURL!;
  const lang = inferSourceLanguage(label);
  const escapedLabel = escape(label);
  const displayedLabel = lang === "ja"
    ? sourceURL === null ? `『${escapedLabel}』` : `「${escapedLabel}」`
    : escapedLabel;

  if (sourceURL === null) {
    return `<span lang="${lang}">${displayedLabel}</span>`;
  }

  return `<a lang="${lang}" href="${escape(sourceURL)}">${displayedLabel}</a>`;
}
