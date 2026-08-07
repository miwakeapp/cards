/**
 * Local web server for the review app: serves the UI, exposes the analyzed cards, persists
 * decisions as they are made, and applies accepted updates to Anki on request.
 */

import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";
import { parseKey } from "card_model/keys";
import type { GenerationCache } from "card_field_generation";
import { findAllEntriesBySpelling, type SpellingIndex } from "card_resolution";
import { type JMDictWord, readingAppliesToKanji } from "data";
import { ac, type ACInvoke, applyNoteUpdate, openNotesInAnki } from "./anki.ts";
import { applyRestrictionReason } from "./client/apply_policy.ts";
import { RecognitionUnitIndex } from "./duplicate_keys.ts";
import type { AnalyzedCard } from "./analyze.ts";
import { parseCardReadingAlternatives, validateCardReading } from "./reading_validation.ts";
import type { ExceptionContext, ReviewItem, ReviewMeta, ReviewPayload } from "./review_api.ts";
import { suggestedKey, suggestForCard, type Suggestion } from "./suggest.ts";
import { type DecisionRecord, type ReviewState } from "./state.ts";

const CLIENT_DIRECTORY = path.resolve(import.meta.dirname!, "client");
const BUILD_DIRECTORY = path.resolve(import.meta.dirname!, "../build");

export interface ServerOptions {
  cards: AnalyzedCard[];
  entries: ReadonlyMap<string, JMDictWord>;
  suggestions: Map<number, Suggestion>;
  spellingIndex: SpellingIndex;
  generationCache: GenerationCache;
  state: ReviewState;
  meta: Omit<ReviewMeta, "counts">;
  port: number;
  invoke?: ACInvoke;
}

/** The default stance when the user has recorded no decision. */
export function impliedDecision(card: AnalyzedCard): "accept" | "none" {
  return card.verdict === "routine" || card.verdict === "normalize" ? "accept" : "none";
}

/** Builds concise structured context for an invalid Reading when its failure is unambiguous. */
export function invalidReadingExceptionContext(
  card: AnalyzedCard,
  entries: ReadonlyMap<string, JMDictWord>,
): ExceptionContext | null {
  if (card.reason !== "invalid-reading" || card.parsedKey === null) return null;

  const recognitionTarget = card.note.fields.recognitionTarget || card.parsedKey.spelling;
  const alternatives = parseCardReadingAlternatives(
    card.note.fields.reading,
    recognitionTarget,
    card.parsedKey.spelling,
  );
  if (alternatives === null) return null;

  for (const alternative of alternatives) {
    const exactMatches = card.parsedKey.usages.flatMap(({ jmdictId }) => {
      const entry = entries.get(jmdictId);
      if (entry === undefined) return [];
      return entry.kana
        .filter(({ text }) => text === alternative.kanaReading)
        .map((form) => ({ entry, form }));
    });
    if (exactMatches.length === 0) {
      return {
        kind: "reading-no-match",
        reading: alternative.formatted,
        kanaReading: alternative.kanaReading,
      };
    }
    const appliesToKeySpelling = exactMatches.some(({ form }) =>
      readingAppliesToKanji(form, card.parsedKey!.spelling)
    );
    if (!appliesToKeySpelling) {
      return {
        kind: "reading-not-applicable",
        kanaReading: alternative.kanaReading,
        recognitionTarget,
        jmdictId: exactMatches[0].entry.id,
      };
    }
  }
  return null;
}

/** Builds note and sense context for every card involved in a duplicate recognition unit. */
export function duplicateExceptionContext(
  card: AnalyzedCard,
  conflictingNoteIds: readonly number[],
  cardsByNoteId: ReadonlyMap<number, AnalyzedCard>,
  entries: ReadonlyMap<string, JMDictWord>,
): ExceptionContext | null {
  if (card.reason !== "duplicate-recognition-unit") return null;

  const notes = [card.note.noteId, ...conflictingNoteIds].map((noteId) => {
    const relatedCard = cardsByNoteId.get(noteId);
    if (relatedCard?.parsedKey === null || relatedCard?.parsedKey === undefined) return null;
    return {
      noteId,
      usages: relatedCard.parsedKey.usages.map(({ jmdictId, senseNumbers }) => ({
        jmdictId,
        senseNumbers: senseNumbers ??
          entries.get(jmdictId)?.sense.map((_, index) => index + 1) ?? [],
      })),
    };
  });
  if (notes.some((note) => note === null)) return null;
  const completeNotes = notes as NonNullable<typeof notes[number]>[];
  const noteIds = new Set(completeNotes.map(({ noteId }) => noteId));
  const recognitionTargets = new Set([...noteIds].map((noteId) => {
    const relatedCard = cardsByNoteId.get(noteId)!;
    return relatedCard.note.fields.recognitionTarget || relatedCard.parsedKey!.spelling;
  }));
  const jmdictIds = [
    ...new Set(completeNotes.flatMap((note) => note.usages.map(({ jmdictId }) => jmdictId))),
  ].toSorted((left, right) => Number(left) - Number(right));
  const entryContexts = jmdictIds.flatMap((jmdictId) => {
    const entry = entries.get(jmdictId);
    if (entry === undefined) return [];
    const otherCards = [...cardsByNoteId.values()].flatMap((relatedCard) => {
      if (noteIds.has(relatedCard.note.noteId) || relatedCard.parsedKey === null) return [];
      const recognitionTarget = relatedCard.note.fields.recognitionTarget ||
        relatedCard.parsedKey.spelling;
      if (recognitionTargets.has(recognitionTarget)) return [];
      const usage = relatedCard.parsedKey.usages.find((usage) => usage.jmdictId === jmdictId);
      if (usage === undefined) return [];
      return [{
        noteId: relatedCard.note.noteId,
        recognitionTarget,
        senseNumbers: usage.senseNumbers ?? entry.sense.map((_, index) => index + 1),
      }];
    }).toSorted((left, right) => left.noteId - right.noteId);
    return [{ jmdictId, senseCount: entry.sense.length, otherCards }];
  });
  return {
    kind: "duplicate-recognition-unit",
    notes: completeNotes,
    entries: entryContexts,
  };
}

/** Validates and canonically formats the Reading retained beside a proposed latest-JMDict Key. */
export async function validateResultingReading(
  card: AnalyzedCard,
  key: string,
  reading: string,
  entries: ReadonlyMap<string, JMDictWord>,
): Promise<{ reading: string } | { error: string }> {
  const parsedKey = parseKey(key);
  if (parsedKey === null) return { error: "The resulting Key is not canonical." };

  const readingValidation = await validateCardReading({
    key: parsedKey,
    recognitionTarget: card.note.fields.recognitionTarget,
    reading,
    entries,
  });
  if (readingValidation.error !== null) {
    return { error: `The resulting Key and Reading are incompatible: ${readingValidation.error}` };
  }
  return { reading: readingValidation.proposedReading ?? reading };
}

export function startServer(options: ServerOptions): Deno.HttpServer {
  const { cards, entries, suggestions, spellingIndex, generationCache, state, meta } = options;
  const invoke = options.invoke ?? ac;
  const cardsByNoteId = new Map(cards.map((card) => [card.note.noteId, card]));
  const recognitionUnits = new RecognitionUnitIndex(
    cards.map((card) => ({ noteId: card.note.noteId, key: card.note.fields.key })),
    entries,
  );

  function cardPayload(card: AnalyzedCard): ReviewItem {
    const suggestion = suggestions.get(card.note.noteId) ?? null;
    const savedDecision = state.decision(card.note.noteId);
    const applied = state.applied(card.note.noteId);
    return {
      noteId: card.note.noteId,
      verdict: card.verdict,
      reason: card.reason,
      detail: card.detail,
      exceptionContext: card.reason === "invalid-reading"
        ? invalidReadingExceptionContext(card, entries)
        : card.reason === "duplicate-recognition-unit"
        ? duplicateExceptionContext(
          card,
          recognitionUnits.conflicts(card.note.noteId, card.note.fields.key),
          cardsByNoteId,
          entries,
        )
        : null,
      word: card.note.fields.recognitionTarget ||
        card.parsedKey?.spelling || card.note.fields.key,
      key: card.note.fields.key,
      hint: card.note.fields.hint,
      fullContext: card.note.fields.fullContext,
      currentEntryHTML: card.note.fields.dictionary,
      latestEntryHTML: card.latestEntryHTML,
      oldSenseCount: card.oldParsed?.senses.length ?? null,
      mappedTargetSenses: card.mappedTargetSenses,
      removedSenses: card.alignment?.removedSenses.map((sense) => ({
        number: sense.number,
        text: sense.text,
        wasTargeted: card.targetSenseNumbers.includes(sense.number),
      })) ?? [],
      proposedKey: card.proposedKey,
      currentReading: card.note.fields.reading,
      proposedReading: card.proposedReading,
      senseViews: card.senseViews,
      changeChips: card.changeChips,
      suggestion,
      decision: savedDecision === null ? null : {
        decision: savedDecision.decision,
        senses: savedDecision.senses,
        hint: savedDecision.hint,
        resolvedBy: savedDecision.resolvedBy,
        decidedAt: savedDecision.decidedAt,
      },
      applied: applied === null ? null : { wroteFields: applied.wroteFields },
    };
  }

  function statePayload(): ReviewPayload {
    const counts = { unchanged: 0, normalize: 0, routine: 0, retarget: 0, exception: 0 };
    for (const card of cards) {
      ++counts[card.verdict];
    }
    return {
      meta: { ...meta, counts },
      items: cards
        .filter((card) => card.verdict !== "unchanged")
        .map((card) => cardPayload(card)),
    };
  }

  async function handleAPI(request: Request, url: URL): Promise<Response> {
    if (url.pathname === "/api/state" && request.method === "GET") {
      return json(statePayload());
    }

    if (url.pathname === "/api/decisions" && request.method === "POST") {
      const body = await request.json() as {
        entries: Array<{ noteId: number; record: DecisionRecord | null }>;
      };
      const entries: Array<[number, DecisionRecord | null]> = [];
      for (const { noteId, record } of body.entries) {
        if (!cardsByNoteId.has(noteId)) {
          return json({ error: `Unknown note ${noteId}` }, 400);
        }
        entries.push([
          noteId,
          record === null ? null : { ...record, fingerprint: state.fingerprint(noteId)! },
        ]);
      }
      await state.setDecisions(entries);
      return json({ ok: true });
    }

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      const body = await request.json() as { noteId: number };
      const card = cardsByNoteId.get(body.noteId);
      if (!card || card.newParsed === null) {
        return json({ error: `Cannot suggest for note ${body.noteId}` }, 400);
      }
      const suggestion = await suggestForCard(card, {
        sameSpellingEntries: findAllEntriesBySpelling(
          spellingIndex,
          card.parsedKey!.spelling,
        ),
        ...(meta.modelOverride === undefined ? {} : { modelId: meta.modelOverride }),
        generationCache,
        force: true,
      });
      suggestions.set(card.note.noteId, suggestion);
      meta.modelConfigurationIds = [
        ...new Set([...meta.modelConfigurationIds, ...suggestion.modelConfigurationIds]),
      ].toSorted();
      return json({ suggestion });
    }

    if (url.pathname === "/api/open-notes" && request.method === "GET") {
      const rawNoteIds = url.searchParams.getAll("noteId");
      const noteIds = [...new Set(rawNoteIds.map(Number))];
      if (
        noteIds.length === 0 ||
        noteIds.some((noteId) => !Number.isSafeInteger(noteId) || !cardsByNoteId.has(noteId))
      ) {
        return json({ error: "One or more notes are unknown." }, 400);
      }
      await openNotesInAnki(noteIds, invoke);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/api/apply" && request.method === "POST") {
      const restrictionReason = applyRestrictionReason(meta);
      if (restrictionReason !== undefined) {
        return json({ error: restrictionReason }, 400);
      }
      const body = await request.json() as { noteIds: number[] };
      const results = [];
      for (const noteId of body.noteIds) {
        const card = cardsByNoteId.get(noteId);
        if (!card) {
          results.push({ noteId, ok: false, error: "Unknown note." });
          continue;
        }
        results.push(await applyCard(card));
      }
      return json({ results });
    }

    return json({ error: "Not found" }, 404);
  }

  async function applyCard(card: AnalyzedCard) {
    const noteId = card.note.noteId;
    if (state.applied(noteId)) {
      return { noteId, ok: false, error: "Already applied in this session." };
    }

    const resolution = resolveApply(card, state.decision(noteId));
    if ("error" in resolution) {
      return { noteId, ok: false, error: resolution.error };
    }

    const { set } = resolution;
    const resultingKey = set.key ?? card.note.fields.key;
    const resultingReading = set.reading ?? card.note.fields.reading;
    const readingValidation = await validateResultingReading(
      card,
      resultingKey,
      resultingReading,
      entries,
    );
    if ("error" in readingValidation) return { noteId, ok: false, error: readingValidation.error };
    if (readingValidation.reading !== resultingReading) set.reading = readingValidation.reading;
    const conflicts = recognitionUnits.conflicts(noteId, resultingKey);
    if (conflicts.length > 0) {
      return {
        noteId,
        ok: false,
        error: `Another scanned card represents the same JMDict entry/sense usage (note IDs: ${
          conflicts.join(", ")
        }).`,
      };
    }

    const result = await applyNoteUpdate({
      noteId,
      expect: {
        key: card.note.fields.key,
        recognitionTarget: card.note.fields.recognitionTarget,
        reading: card.note.fields.reading,
        dictionary: card.note.fields.dictionary,
        hint: card.note.fields.hint,
      },
      set,
    }, invoke);

    if (result.ok) {
      recognitionUnits.update(noteId, resultingKey);
      await state.markApplied(noteId, {
        appliedAt: new Date().toISOString(),
        fromKey: card.note.fields.key,
        toKey: set.key ?? card.note.fields.key,
        wroteFields: result.wroteFields,
        before: result.before,
        after: result.after,
      });
    }
    return { noteId, ok: result.ok, error: result.error, wroteFields: result.wroteFields };
  }

  function resolveApply(
    card: AnalyzedCard,
    record: DecisionRecord | null,
  ):
    | {
      set: {
        key?: string;
        reading?: string;
        dictionary?: string;
        hint?: string;
      };
    }
    | { error: string } {
    const effective = record?.decision ?? impliedDecision(card);
    if (effective !== "accept") {
      return { error: `Not accepted (${effective === "none" ? "undecided" : effective}).` };
    }
    if (card.latestEntryHTML === null) {
      return { error: "No latest entry to apply." };
    }

    if (card.verdict === "retarget") {
      if (record === null || record.senses === null) {
        return { error: "Re-target cards need an explicit reviewed decision." };
      }
      return {
        set: {
          dictionary: card.latestEntryHTML,
          key: suggestedKey(card, record.senses),
          hint: record.hint ?? "",
          ...(card.proposedReading === null ? {} : { reading: card.proposedReading }),
        },
      };
    }

    if (card.verdict === "routine" || card.verdict === "normalize") {
      return {
        set: {
          dictionary: card.latestEntryHTML,
          ...(card.proposedKey === null ? {} : { key: card.proposedKey }),
          ...(card.proposedReading === null ? {} : { reading: card.proposedReading }),
        },
      };
    }

    return { error: "Exceptions must be handled manually in Anki." };
  }

  return Deno.serve({
    port: options.port,
    hostname: "127.0.0.1",
    onListen: () => {},
  }, async (request) => {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleAPI(request, url);
      }
      return await serveDir(request, {
        fsRoot: url.pathname === "/main.js" ? BUILD_DIRECTORY : CLIENT_DIRECTORY,
        quiet: true,
        headers: ["cache-control: no-store"],
      });
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
