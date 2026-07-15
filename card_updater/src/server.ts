/**
 * Local web server for the review app: serves the UI, exposes the analyzed cards, persists
 * decisions as they are made, and applies accepted updates to Anki on request.
 */

import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";
import { ac, type ACInvoke, applyNoteUpdate, openNoteInAnki } from "./anki.ts";
import { applyRestrictionReason } from "./client/apply_policy.ts";
import type { AnalyzedCard } from "./analyze.ts";
import type { ReviewItem, ReviewMeta, ReviewPayload } from "./review_api.ts";
import { suggestedKey, suggestForCard, type Suggestion, type SuggestionCache } from "./suggest.ts";
import { type DecisionRecord, type ReviewState, saveSuggestionCache } from "./state.ts";

const CLIENT_DIRECTORY = path.resolve(import.meta.dirname!, "client");
const BUILD_DIRECTORY = path.resolve(import.meta.dirname!, "../build");

export interface ServerOptions {
  cards: AnalyzedCard[];
  suggestions: Map<number, Suggestion>;
  suggestionCache: SuggestionCache;
  state: ReviewState;
  meta: Omit<ReviewMeta, "counts">;
  port: number;
  invoke?: ACInvoke;
}

/** The default stance when the user has recorded no decision. */
export function impliedDecision(card: AnalyzedCard): "accept" | "none" {
  return card.verdict === "routine" || card.verdict === "normalize" ? "accept" : "none";
}

export function startServer(options: ServerOptions): Deno.HttpServer {
  const { cards, suggestions, suggestionCache, state, meta } = options;
  const invoke = options.invoke ?? ac;
  const cardsByNoteId = new Map(cards.map((card) => [card.note.noteId, card]));
  const allKeys = new Set(cards.map((card) => card.note.fields.key));

  function cardPayload(card: AnalyzedCard): ReviewItem {
    const suggestion = suggestions.get(card.note.noteId) ?? null;
    const savedDecision = state.decision(card.note.noteId);
    const applied = state.applied(card.note.noteId);
    return {
      noteId: card.note.noteId,
      verdict: card.verdict,
      reason: card.reason,
      detail: card.detail,
      word: card.note.fields.recognitionTarget ||
        card.parsedKey?.recognitionTarget || card.note.fields.key,
      key: card.note.fields.key,
      recognitionTarget: card.parsedKey?.recognitionTarget ?? null,
      jmdictId: card.parsedKey?.jmdictId ?? null,
      hint: card.note.fields.hint,
      fullContext: card.note.fields.fullContext,
      currentEntryHTML: card.note.fields.dictionaryEntry,
      latestEntryHTML: card.latestEntryHTML,
      oldSenseCount: card.oldParsed?.senses.length ?? null,
      newSenseCount: card.newParsed?.senses.length ?? null,
      totalNewSenses: card.newParsed?.senses.length ?? 0,
      targetSenseNumbers: card.targetSenseNumbers,
      mappedTargetSenses: card.mappedTargetSenses,
      removedSenses: card.alignment?.removedSenses.map((sense) => ({
        number: sense.number,
        text: sense.text,
        wasTargeted: card.targetSenseNumbers.includes(sense.number),
      })) ?? [],
      proposedKey: card.proposedKey,
      needsAI: card.needsAI,
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
      fingerprint: state.fingerprint(card.note.noteId),
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
      const { suggestion, cacheEntry } = await suggestForCard(card, {
        modelId: meta.modelId,
        cache: suggestionCache,
        force: true,
      });
      suggestions.set(card.note.noteId, suggestion);
      suggestionCache[String(card.note.noteId)] = cacheEntry;
      await saveSuggestionCache(suggestionCache);
      return json({ suggestion });
    }

    if (url.pathname === "/api/open-note" && request.method === "POST") {
      const body = await request.json() as { noteId: number };
      await openNoteInAnki(body.noteId, invoke);
      return json({ ok: true });
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
    if (set.key !== undefined && set.key !== card.note.fields.key && allKeys.has(set.key)) {
      return {
        noteId,
        ok: false,
        error: `Another scanned card already has the key "${set.key}".`,
      };
    }

    const result = await applyNoteUpdate({
      noteId,
      expect: {
        key: card.note.fields.key,
        dictionaryEntry: card.note.fields.dictionaryEntry,
        hint: card.note.fields.hint,
      },
      set,
    }, invoke);

    if (result.ok) {
      if (set.key !== undefined) {
        allKeys.add(set.key);
      }
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
  ): { set: { key?: string; dictionaryEntry?: string; hint?: string } } | { error: string } {
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
          dictionaryEntry: card.latestEntryHTML,
          key: suggestedKey(card, record.senses),
          hint: record.hint ?? "",
        },
      };
    }

    if (card.verdict === "routine" || card.verdict === "normalize") {
      return {
        set: {
          dictionaryEntry: card.latestEntryHTML,
          ...(card.proposedKey === null ? {} : { key: card.proposedKey }),
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
