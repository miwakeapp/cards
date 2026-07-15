/**
 * On-disk persistence for review decisions, the AI suggestion cache, and the apply log.
 * Everything lives under `card_updater/generated/` (gitignored).
 */

import * as path from "@std/path";
import type { AnalyzedCard } from "./analyze.ts";
import type { AppliedFieldValues } from "./anki.ts";
import { sha256OfJSON } from "./hash.ts";
import type { SuggestionCache } from "./suggest.ts";

const GENERATED_DIRECTORY = path.resolve(import.meta.dirname!, "../generated");
const DECISIONS_PATH = path.join(GENERATED_DIRECTORY, "decisions.json");
const AI_CACHE_PATH = path.join(GENERATED_DIRECTORY, "ai-cache.json");
const APPLY_LOG_PATH = path.join(GENERATED_DIRECTORY, "apply-log.jsonl");

export type DecisionKind = "accept" | "hold" | "reject";

export interface DecisionRecord {
  decision: DecisionKind;
  /** Final sense selection for accepted re-targets; `null` elsewhere. */
  senses: number[] | null;
  /** Final hint value for accepted re-targets (`null` clears); `null` elsewhere too. */
  hint: string | null;
  resolvedBy: "ai" | "ai-edited" | "human";
  /** Ties the decision to the exact analyzed content; stale decisions are dropped. */
  fingerprint: string;
  decidedAt: string;
}

export interface AppliedRecord {
  appliedAt: string;
  fromKey: string;
  toKey: string;
  wroteFields: string[];
  before: AppliedFieldValues;
  after: AppliedFieldValues;
}

/** Hashes the analysis-relevant content of a card, for decision/suggestion invalidation. */
export function cardFingerprint(card: AnalyzedCard): Promise<string> {
  return sha256OfJSON([
    card.note.fields.key,
    card.note.fields.hint,
    card.note.fields.dictionaryEntry,
    card.latestEntryHTML,
    card.note.fields.fullContext,
  ]);
}

async function readJSONFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await Deno.readTextFile(filePath)) as T;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return fallback;
    }
    throw error;
  }
}

async function writeJSONFile(filePath: string, value: unknown): Promise<void> {
  await Deno.mkdir(GENERATED_DIRECTORY, { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(value, undefined, 2) + "\n");
}

export class ReviewState {
  #decisions = new Map<number, DecisionRecord>();
  #applied = new Map<number, AppliedRecord>();
  #fingerprints: Map<number, string>;

  private constructor(fingerprints: Map<number, string>) {
    this.#fingerprints = fingerprints;
  }

  /**
   * Loads persisted decisions, keeping only those whose fingerprint still matches the current
   * analysis (cards edited in Anki, or affected by a newer JMDict, drop back to undecided).
   */
  static async load(cards: AnalyzedCard[]): Promise<ReviewState> {
    const fingerprints = new Map<number, string>();
    for (const card of cards) {
      fingerprints.set(card.note.noteId, await cardFingerprint(card));
    }

    const state = new ReviewState(fingerprints);
    const saved = await readJSONFile<{ decisions?: Record<string, DecisionRecord> }>(
      DECISIONS_PATH,
      {},
    );
    for (const [noteIdText, record] of Object.entries(saved.decisions ?? {})) {
      const noteId = Number(noteIdText);
      if (fingerprints.get(noteId) === record.fingerprint) {
        state.#decisions.set(noteId, record);
      }
    }
    return state;
  }

  fingerprint(noteId: number): string | undefined {
    return this.#fingerprints.get(noteId);
  }

  decision(noteId: number): DecisionRecord | null {
    return this.#decisions.get(noteId) ?? null;
  }

  applied(noteId: number): AppliedRecord | null {
    return this.#applied.get(noteId) ?? null;
  }

  async setDecision(noteId: number, record: DecisionRecord | null): Promise<void> {
    if (record === null) {
      this.#decisions.delete(noteId);
    } else {
      this.#decisions.set(noteId, record);
    }
    await this.#persistDecisions();
  }

  async setDecisions(entries: Array<[number, DecisionRecord | null]>): Promise<void> {
    for (const [noteId, record] of entries) {
      if (record === null) {
        this.#decisions.delete(noteId);
      } else {
        this.#decisions.set(noteId, record);
      }
    }
    await this.#persistDecisions();
  }

  async markApplied(noteId: number, record: AppliedRecord): Promise<void> {
    this.#applied.set(noteId, record);
    await Deno.mkdir(GENERATED_DIRECTORY, { recursive: true });
    await Deno.writeTextFile(
      APPLY_LOG_PATH,
      JSON.stringify({ noteId, ...record }) + "\n",
      { append: true },
    );
  }

  #persistDecisions(): Promise<void> {
    return writeJSONFile(DECISIONS_PATH, {
      description:
        "Review decisions from the Miwake card updater. Entries are dropped automatically when the underlying card or dictionary entry changes.",
      decisions: Object.fromEntries(this.#decisions),
    });
  }
}

export function loadSuggestionCache(): Promise<SuggestionCache> {
  return readJSONFile<SuggestionCache>(AI_CACHE_PATH, {});
}

export function saveSuggestionCache(cache: SuggestionCache): Promise<void> {
  return writeJSONFile(AI_CACHE_PATH, cache);
}
