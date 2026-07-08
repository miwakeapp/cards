/**
 * AI re-targeting suggestions for cards whose targeted senses may have changed.
 *
 * Sense and hint determination deliberately reuses `card_creator`'s `generateCardFields` — the
 * same prompt, few-shot examples, and schema that create cards in the first place — fed with the
 * card's original mined context and the NEW JMDict entry. Confidence is then derived
 * deterministically by comparing the AI's choice against the structural sense alignment.
 */

import { DEFAULT_MODEL_ID, generateCardFields, type ModelId } from "card_creator";
import { formatMiwakeKey } from "card_creator/keys";
import type { AnalyzedCard } from "./analyze.ts";
import { sha256OfJSON } from "./hash.ts";

export type SuggestionConfidence = "high" | "medium" | "low";

export interface Suggestion {
  /** 1-indexed applicable senses in the new entry; empty means all senses apply. */
  senses: number[];
  /** The canonical AI-generated hint (may differ from the card's current hint). */
  aiHint: string | null;
  /**
   * The hint the review UI should default to. Existing hints are never overwritten by
   * default; the AI hint is offered as an alternative.
   */
  defaultHint: string | null;
  confidence: SuggestionConfidence;
  /** Deterministic explanation of how the suggestion relates to the entry changes. */
  explanation: string;
  modelId: string;
  fromCache: boolean;
}

export interface SuggestionCacheEntry {
  inputHash: string;
  modelId: string;
  generatedAt: string;
  applicableSenses: number[];
  hint: string | null;
}

export type SuggestionCache = Record<string, SuggestionCacheEntry>;

export function suggestionInputHash(
  card: AnalyzedCard,
  modelId: string,
): Promise<string> {
  return sha256OfJSON([
    modelId,
    card.note.fields.key,
    card.note.fields.hint,
    card.note.fields.dictionaryEntry,
    card.latestEntryHTML,
    card.note.fields.fullContext,
  ]);
}

/** Prepares the stored `Full context` field for the card-creation prompt. */
export function contextForPrompt(fullContext: string): string {
  return fullContext
    .replace(/<\/?mark>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

export async function suggestForCard(
  card: AnalyzedCard,
  {
    modelId = DEFAULT_MODEL_ID,
    cache = {},
    force = false,
    generate = generateCardFields,
  }: {
    modelId?: ModelId;
    cache?: SuggestionCache;
    force?: boolean;
    generate?: typeof generateCardFields;
  } = {},
): Promise<{ suggestion: Suggestion; cacheEntry: SuggestionCacheEntry }> {
  if (card.latestWord === null || card.newParsed === null) {
    throw new Error(`Card ${card.note.noteId} has no latest entry to suggest against.`);
  }

  const inputHash = await suggestionInputHash(card, modelId);
  const cached = cache[String(card.note.noteId)];
  const fromCache = !force && cached !== undefined && cached.inputHash === inputHash &&
    cached.modelId === modelId;

  let applicableSenses: number[];
  let aiHint: string | null;
  if (fromCache) {
    applicableSenses = cached.applicableSenses;
    aiHint = cached.hint;
  } else {
    const fields = await generate({
      context: contextForPrompt(card.note.fields.fullContext),
      recognitionTarget: card.parsedKey!.recognitionTarget,
      jmdictEntry: card.latestWord,
      source: undefined,
      sourceURL: undefined,
    }, modelId);
    applicableSenses = normalizeSenseSelection(fields.applicableSenses, card);
    aiHint = fields.hint;
  }

  const suggestion = buildSuggestion(card, applicableSenses, aiHint, modelId, fromCache);
  const cacheEntry: SuggestionCacheEntry = {
    inputHash,
    modelId,
    generatedAt: new Date().toISOString(),
    applicableSenses,
    hint: aiHint,
  };
  return { suggestion, cacheEntry };
}

function normalizeSenseSelection(senses: number[], card: AnalyzedCard): number[] {
  const total = card.newParsed!.senses.length;
  const valid = [...new Set(senses)]
    .filter((sense) => Number.isInteger(sense) && sense >= 1 && sense <= total)
    .sort((a, b) => a - b);
  return valid.length === total ? [] : valid;
}

function buildSuggestion(
  card: AnalyzedCard,
  senses: number[],
  aiHint: string | null,
  modelId: string,
  fromCache: boolean,
): Suggestion {
  const allApply = senses.length === 0;
  const currentHint = card.note.fields.hint;

  // Existing hints are kept by default (they may be hand-edited); see DESIGN.md.
  const defaultHint = allApply ? null : (currentHint || aiHint);

  const expected = card.mappedTargetSenses;
  const sensesMatchExpectation = expected.length > 0 &&
    JSON.stringify(senses) === JSON.stringify(expected);
  const hasContext = card.note.fields.fullContext.trim() !== "";

  let confidence: SuggestionConfidence;
  if (!hasContext) {
    confidence = "low";
  } else if (sensesMatchExpectation) {
    confidence = "high";
  } else if (allApply && card.parsedKey!.senseNumbers === null) {
    // The card targeted all senses and the AI still thinks all senses apply.
    confidence = "high";
  } else {
    confidence = "medium";
  }

  return {
    senses,
    aiHint,
    defaultHint,
    confidence,
    explanation: buildExplanation(card, senses, sensesMatchExpectation, hasContext),
    modelId,
    fromCache,
  };
}

function buildExplanation(
  card: AnalyzedCard,
  senses: number[],
  sensesMatchExpectation: boolean,
  hasContext: boolean,
): string {
  const parts: string[] = [];
  const oldCount = card.oldParsed!.senses.length;
  const newCount = card.newParsed!.senses.length;

  if (oldCount !== newCount) {
    parts.push(`The entry went from ${oldCount} to ${newCount} senses.`);
  } else {
    parts.push("The sense list changed.");
  }

  if (senses.length === 0) {
    parts.push("The AI judges all senses still apply to the mined context.");
  } else {
    parts.push(
      `The AI picks sense${senses.length > 1 ? "s" : ""} ${
        senses.join(", ")
      } for the mined context.`,
    );
  }

  if (sensesMatchExpectation) {
    parts.push("This matches where the previously targeted sense text moved.");
  } else if (card.mappedTargetSenses.length > 0) {
    parts.push(
      `Structural alignment alone would have suggested ${card.mappedTargetSenses.join(", ")}.`,
    );
  } else if (card.removedTargetedSenses.length > 0) {
    parts.push("The previously targeted sense has no counterpart in the new entry.");
  }

  if (!hasContext) {
    parts.push("No mined context is stored on this card, so this is a weak guess.");
  }

  return parts.join(" ");
}

export function suggestedKey(card: AnalyzedCard, senses: number[]): string {
  return formatMiwakeKey(
    card.parsedKey!.recognitionTarget,
    card.parsedKey!.jmdictId,
    senses,
    card.newParsed!.senses.length,
  );
}
