import {
  type RenderedTextOccurrence,
  resolveContextTarget,
  type ResolvedContextTarget,
} from "card_resolution";
import { containsKanji } from "japanese_text";

const HAN_CHARACTER = /\p{Script=Han}/v;
const HIRAGANA_CHARACTER = /\p{Script=Hiragana}/v;
const KATAKANA_CHARACTER = /\p{Script=Katakana}/v;
const COUNTER_PREFIX_CHARACTER = /[\p{Number}〇零一二三四五六七八九十百千万億兆何数幾両半]/v;

type KanaScript = "hiragana" | "katakana";

function firstKanaScript(text: string): KanaScript | undefined {
  for (const character of text) {
    if (HIRAGANA_CHARACTER.test(character)) return "hiragana";
    if (KATAKANA_CHARACTER.test(character)) return "katakana";
  }
  return undefined;
}

function validateResolvedOccurrences(
  renderedText: string,
  recognitionTarget: string,
  occurrences: readonly RenderedTextOccurrence[],
  partOfSpeech: readonly string[],
): void {
  if (!containsKanji(recognitionTarget)) {
    const targetScript = firstKanaScript(recognitionTarget);
    for (const { surface } of occurrences) {
      const surfaceScript = firstKanaScript(surface);
      if (
        targetScript !== undefined && surfaceScript !== undefined && targetScript !== surfaceScript
      ) {
        throw new Error(
          `Deterministic target resolution changed the kana script of recognitionTarget ${
            JSON.stringify(recognitionTarget)
          } to source surface ${JSON.stringify(surface)}`,
        );
      }
    }
  }

  const permitsLeftAttachment = partOfSpeech.some((tag) => tag === "suf" || tag === "n-suf");
  const permitsRightAttachment = partOfSpeech.some((tag) => tag === "pref" || tag === "n-pref");
  for (const { start, end, surface } of occurrences) {
    if (!HAN_CHARACTER.test(surface)) continue;
    const previous = [...renderedText.slice(0, start)].at(-1) ?? "";
    const nextCodePoint = renderedText.codePointAt(end);
    const next = nextCodePoint === undefined ? "" : String.fromCodePoint(nextCodePoint);
    const previousIsCounterPrefix = [...surface].length === 1 &&
      partOfSpeech.includes("ctr") && COUNTER_PREFIX_CHARACTER.test(previous);
    const leftAttachmentIsAllowed = permitsLeftAttachment || previousIsCounterPrefix;
    if (
      (HAN_CHARACTER.test(previous) && !leftAttachmentIsAllowed) ||
      (HAN_CHARACTER.test(next) && !permitsRightAttachment && !permitsLeftAttachment &&
        !previousIsCounterPrefix)
    ) {
      throw new Error(
        `Cannot safely mark source surface ${JSON.stringify(surface)} for recognitionTarget ` +
          `${JSON.stringify(recognitionTarget)} because it occurs inside a Han compound`,
      );
    }
  }
}

/**
 * Finds source surfaces derived from one selected JMDict spelling and marks every safe occurrence.
 *
 * The caller deliberately supplies only its resolved recognition target: alternate JMDict spellings
 * and readings must be resolved before this boundary, or the card front could disagree with the
 * spelling seen in context. Ambiguous one-kanji substrings and kana-script substitutions fail closed.
 */
export async function markResolvedContextTarget(
  contextHTML: string,
  recognitionTarget: string,
  partOfSpeech: readonly string[],
): Promise<string> {
  return (await resolveSafeContextTarget(contextHTML, recognitionTarget, partOfSpeech)).markedHTML;
}

/** Resolves one target to exact source ranges and applies prototype-specific safety checks. */
export async function resolveSafeContextTarget(
  contextHTML: string,
  recognitionTarget: string,
  partOfSpeech: readonly string[],
): Promise<ResolvedContextTarget> {
  const resolved = await resolveContextTarget(contextHTML, recognitionTarget, {
    partOfSpeech,
    allowSingleCharacterSubstring: true,
  });
  if (resolved === null) {
    throw new Error(
      `Could not deterministically locate recognitionTarget ${
        JSON.stringify(recognitionTarget)
      } in the supplied context`,
    );
  }
  validateResolvedOccurrences(
    resolved.renderedText,
    recognitionTarget,
    resolved.occurrences,
    partOfSpeech,
  );
  return resolved;
}
