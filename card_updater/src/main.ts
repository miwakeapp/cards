/**
 * Updates existing Miwake cards for JMDict changes, end to end:
 *
 * 1. Downloads the latest JMDict release (when newer than the local copy).
 * 2. Fetches all updatable cards from Anki (read-only).
 * 3. Classifies each card by how much attention its update needs.
 * 4. Pre-works the ambiguous ones with AI (the same prompt that creates cards).
 * 5. Serves the review app, persisting decisions as they are made.
 * 6. Applies accepted updates to Anki when the reviewer says so.
 *
 * Run with:
 *   deno task update:cards
 *   deno task update:cards --dry-run --limit=50
 */

import { parseArgs } from "@std/cli/parse-args";
import { DEFAULT_MODEL_ID, MODEL_IDS, type ModelId } from "card_creator/ai";
import { allJMDictEntries } from "data";
import { createACInvoke, DEFAULT_ANKI_CONNECT_URL, fetchMiwakeNotes } from "./anki.ts";
import { analyzeCard, type AnalyzedCard } from "./analyze.ts";
import { ensureLatestFurigana, ensureLatestJMDict } from "data/download";
import { startServer } from "./server.ts";
import { loadSuggestionCache, ReviewState, saveSuggestionCache } from "./state.ts";
import { suggestForCard, type Suggestion } from "./suggest.ts";

const DEFAULT_QUERY = 'deck:Mining card:"Miwake Card"';
const DEFAULT_PORT = 8787;
const AI_CONCURRENCY = 4;

interface Options {
  query: string;
  limit: number | undefined;
  modelId: ModelId;
  port: number;
  ankiConnectURL: string;
  dryRun: boolean;
  offline: boolean;
  acceptLargeFuriganaChange: boolean;
  skipAI: boolean;
  openBrowser: boolean;
}

function parseArguments(args: string[]): Options {
  const flags = parseArgs(args, {
    boolean: ["dry-run", "offline", "accept-large-furigana-change", "skip-ai", "open"],
    negatable: ["open"],
    string: ["query", "model", "limit", "port", "anki-connect-url"],
    default: {
      query: DEFAULT_QUERY,
      model: DEFAULT_MODEL_ID,
      port: DEFAULT_PORT,
      "anki-connect-url": DEFAULT_ANKI_CONNECT_URL,
      open: true,
    },
  });

  if (!(MODEL_IDS as readonly string[]).includes(flags.model)) {
    exitWithUsage(`--model must be one of: ${MODEL_IDS.join(", ")}`);
  }

  return {
    query: flags.query,
    limit: flags.limit === undefined ? undefined : positiveInteger(flags.limit, "--limit"),
    modelId: flags.model as ModelId,
    port: positiveInteger(flags.port, "--port"),
    ankiConnectURL: validateAnkiConnectURL(flags["anki-connect-url"]),
    dryRun: flags["dry-run"],
    offline: flags.offline,
    acceptLargeFuriganaChange: flags["accept-large-furigana-change"],
    skipAI: flags["skip-ai"],
    openBrowser: flags.open,
  };
}

function validateAnkiConnectURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    exitWithUsage("--anki-connect-url must be an absolute HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    exitWithUsage("--anki-connect-url must be an absolute HTTP or HTTPS URL");
  }
  return value;
}

function positiveInteger(value: unknown, flag: string): number {
  const number = typeof value === "string" && value !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    exitWithUsage(`${flag} must be a positive integer`);
  }
  return number;
}

function exitWithUsage(message: string): never {
  console.error(message);
  console.error(
    "Usage: deno task update:cards [--query=...] [--limit=N] [--model=...] [--port=N] [--anki-connect-url=URL] [--dry-run] [--offline] [--accept-large-furigana-change] [--skip-ai] [--no-open]",
  );
  Deno.exit(1);
}

async function generateSuggestions(
  cards: AnalyzedCard[],
  options: Options,
): Promise<Map<number, Suggestion>> {
  const suggestions = new Map<number, Suggestion>();
  const targets = cards.filter((card) => card.needsAI && card.newParsed !== null);
  if (targets.length === 0 || options.skipAI) {
    if (targets.length > 0) {
      console.error(`Skipping AI suggestions for ${targets.length} cards (--skip-ai).`);
    }
    return suggestions;
  }

  const cache = await loadSuggestionCache();
  console.error(`Generating AI suggestions for ${targets.length} cards (${options.modelId})...`);
  let completed = 0;
  let fromCache = 0;

  const queue = [...targets];
  async function worker() {
    while (true) {
      const card = queue.shift();
      if (card === undefined) {
        return;
      }
      try {
        const { suggestion, cacheEntry } = await suggestForCard(card, {
          modelId: options.modelId,
          cache,
        });
        suggestions.set(card.note.noteId, suggestion);
        cache[String(card.note.noteId)] = cacheEntry;
        if (suggestion.fromCache) {
          ++fromCache;
        }
      } catch (error) {
        console.error(`  AI suggestion failed for ${card.note.fields.key}: ${error}`);
      }
      ++completed;
      if (completed % 5 === 0 || completed === targets.length) {
        console.error(`  ${completed}/${targets.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));

  await saveSuggestionCache(cache);
  console.error(
    `AI suggestions ready (${targets.length - fromCache} generated, ${fromCache} from cache).`,
  );
  return suggestions;
}

function openBrowser(url: string): void {
  const commands: Record<string, [string, string[]]> = {
    windows: ["cmd", ["/c", "start", "", url]],
    darwin: ["open", [url]],
    linux: ["xdg-open", [url]],
  };
  const command = commands[Deno.build.os];
  if (!command) {
    return;
  }
  try {
    new Deno.Command(command[0], { args: command[1], stdout: "null", stderr: "null" }).spawn()
      .unref();
  } catch {
    // Opening the browser is best-effort; the URL is printed regardless.
  }
}

const options = parseArguments(Deno.args);
const generatedAt = new Date().toISOString();
const invoke = createACInvoke(options.ankiConnectURL);
const ankiProfile = await invoke<string>("getActiveProfile");
console.error(`Connected to Anki profile "${ankiProfile}" at ${options.ankiConnectURL}.`);

console.error("Checking JMDict data...");
const jmdict = await ensureLatestJMDict({ offline: options.offline });
console.error(`JMDict ${jmdict.action} (${jmdict.current.version}, ${jmdict.current.dictDate}).`);
console.error("Checking furigana data...");
const furiganaUpdate = await ensureLatestFurigana({
  offline: options.offline,
  acceptLargeChange: options.acceptLargeFuriganaChange,
});
console.error(
  `Furigana ${furiganaUpdate.action} (${furiganaUpdate.current.entryCount} records).`,
);
console.error("Loading local JMDict...");
const entries = await allJMDictEntries();
console.error(`Loaded ${entries.size} JMDict entries.`);

console.error(`Querying Anki at ${options.ankiConnectURL}: ${options.query}`);
const notes = await fetchMiwakeNotes(options.query, {
  limit: options.limit,
  invoke,
  onProgress: (fetched, total) => console.error(`  Fetched ${fetched}/${total} notes`),
});
console.error(`Fetched ${notes.length} Miwake notes.`);

console.error("Analyzing cards...");
const cards = await Promise.all(notes.map((note) => {
  const jmdictId = note.fields.key.split("|")[1]?.trim();
  return analyzeCard(
    note,
    jmdictId === undefined ? undefined : entries.get(jmdictId),
  );
}));

const counts = { unchanged: 0, normalize: 0, routine: 0, retarget: 0, exception: 0 };
for (const card of cards) {
  ++counts[card.verdict];
}
console.error(
  `Analysis: ${counts.unchanged} unchanged, ${counts.normalize} normalize-only, ` +
    `${counts.routine} routine, ${counts.retarget} re-target, ${counts.exception} exceptions.`,
);

const suggestions = await generateSuggestions(cards, options);
const suggestionCache = await loadSuggestionCache();
const state = await ReviewState.load(cards);

startServer({
  cards,
  suggestions,
  suggestionCache,
  state,
  meta: {
    generatedAt,
    query: options.query,
    ankiConnectURL: options.ankiConnectURL,
    ankiProfile,
    limit: options.limit,
    dryRun: options.dryRun,
    modelId: options.modelId,
    jmdict,
    furigana: furiganaUpdate,
    scannedCount: cards.length,
  },
  port: options.port,
  invoke,
});

const url = `http://127.0.0.1:${options.port}/`;
console.error(`\nReview app ready: ${url}`);
if (options.dryRun) {
  console.error("Running with --dry-run: decisions are saved, but applying is disabled.");
}
if (options.limit !== undefined) {
  console.error(
    "Running with --limit: review is available, but applying is disabled until restarted without --limit.",
  );
}
console.error("Press Ctrl+C to stop.");
if (options.openBrowser) {
  openBrowser(url);
}
