/**
 * Prepares a batch of leech notes for conversion to Miwake cards.
 *
 * Fetches leeches from Anki, searches epub texts for full context,
 * uses an LLM to extract appropriate sentence(s), and outputs
 * a JSON file for human review.
 *
 * Run with:
 *   deno task prepare-leech-batch [--count=20] [--model=claude-opus-4-6]
 */

import { join } from "@std/path";
import { generateText } from "ai";
import { DEFAULT_MODEL_ID, getModel, MODEL_IDS } from "../../card_creator/src/ai_provider.ts";
import type { ModelId } from "../../card_creator/src/ai_provider.ts";
import { ac } from "../shared/anki_connect.ts";

// --- CLI args ---

let count = 20;
let modelId: ModelId = DEFAULT_MODEL_ID;

for (const arg of Deno.args) {
  if (arg.startsWith("--count=")) {
    count = parseInt(arg.slice("--count=".length));
  } else if (arg.startsWith("--model=")) {
    const m = arg.slice("--model=".length);
    if (!MODEL_IDS.includes(m as ModelId)) {
      console.error(`Unknown model: ${m}. Available: ${MODEL_IDS.join(", ")}`);
      Deno.exit(1);
    }
    modelId = m as ModelId;
  }
}

function extractJmdictId(glossary: string): string | null {
  const match = glossary.match(/q=(\d+)/);
  return match ? match[1] : null;
}

// --- HTML utilities ---

/** Strips HTML tags and normalizes whitespace. Removes ruby readings for clean search text. */
function stripHtml(html: string): string {
  return html
    .replace(/<rt[^>]*>.*?<\/rt>/g, "") // remove ruby readings
    .replace(/<[^>]+>/g, "") // remove all tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, (m) => String.fromCodePoint(parseInt(m.slice(2, -1))))
    .replace(/\s+/g, "")
    .trim();
}

/** Cleans epub XHTML paragraph HTML for use as card context.
 *  - Removes class/id attributes
 *  - Removes <rb> wrappers (keeps content)
 *  - Removes <span> wrappers (keeps content)
 *  - Keeps <ruby> and <rt> tags
 */
function cleanEpubHtml(html: string): string {
  return html
    .replace(/<rb[^>]*>(.*?)<\/rb>/g, "$1") // unwrap <rb>
    .replace(/<span[^>]*>(.*?)<\/span>/g, "$1") // unwrap <span>
    .replace(/\s+(class|id)="[^"]*"/g, "") // remove class/id attrs
    .replace(/<ruby[^>]*>/g, "<ruby>") // clean ruby open tags
    .replace(/<rt[^>]*>/g, "<rt>") // clean rt open tags
    .replace(/^\s+/, "") // trim leading whitespace
    .trim();
}

// --- Epub indexing ---

interface EpubParagraph {
  /** Cleaned inner HTML of the <p> tag, suitable for card context. */
  html: string;
  /** Plain text for searching (HTML stripped, ruby readings removed). */
  plainText: string;
  /** Book directory name (= source). */
  source: string;
  /** Relative path within epub_texts/. */
  file: string;
  /** Index of this paragraph in the file's paragraph list. */
  index: number;
}

interface EpubFile {
  source: string;
  file: string;
  paragraphs: EpubParagraph[];
}

const EPUB_TEXTS_DIR = join(import.meta.dirname!, "..", "epub_texts");

async function buildEpubIndex(): Promise<EpubFile[]> {
  const files: EpubFile[] = [];

  for await (const bookEntry of Deno.readDir(EPUB_TEXTS_DIR)) {
    if (!bookEntry.isDirectory) continue;
    const source = bookEntry.name;
    const bookDir = `${EPUB_TEXTS_DIR}/${source}`;

    // Walk all subdirectories for .html and .xhtml files
    for await (const entry of walkDir(bookDir)) {
      if (!entry.name.endsWith(".html") && !entry.name.endsWith(".xhtml")) continue;
      if (entry.name === "titlepage.xhtml") continue;

      const content = await Deno.readTextFile(entry.path);
      const paragraphs = extractParagraphs(content, source, entry.path);
      if (paragraphs.length > 0) {
        files.push({ source, file: entry.path, paragraphs });
      }
    }
  }

  console.error(
    `Indexed ${
      files.reduce((s, f) => s + f.paragraphs.length, 0)
    } paragraphs from ${files.length} files across ${
      new Set(files.map((f) => f.source)).size
    } books`,
  );
  return files;
}

async function* walkDir(dir: string): AsyncGenerator<{ name: string; path: string }> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkDir(path);
    } else {
      yield { name: entry.name, path };
    }
  }
}

function extractParagraphs(xhtml: string, source: string, file: string): EpubParagraph[] {
  const paragraphs: EpubParagraph[] = [];
  const pRegex = /<p[^>]*>(.*?)<\/p>/gs;
  let match;
  let index = 0;

  while ((match = pRegex.exec(xhtml)) !== null) {
    const innerHtml = match[1];
    const plainText = stripHtml(innerHtml);

    // Skip empty or very short paragraphs (likely decorative)
    if (plainText.length < 2) {
      continue;
    }

    paragraphs.push({
      html: cleanEpubHtml(innerHtml),
      plainText,
      source,
      file,
      index: index++,
    });
  }

  return paragraphs;
}

// --- Search ---

interface SearchResult {
  source: string;
  file: string;
  /** The paragraph that matched. */
  matchParagraph: EpubParagraph;
  /** Window of paragraphs around the match (for LLM context extraction). */
  window: EpubParagraph[];
}

function searchEpubIndex(index: EpubFile[], query: string): SearchResult[] {
  const results: SearchResult[] = [];
  const strippedQuery = stripHtml(query);

  if (strippedQuery.length < 3) return results;

  for (const file of index) {
    for (const para of file.paragraphs) {
      if (para.plainText.includes(strippedQuery)) {
        // Build a window: 3 paragraphs before and after
        const windowStart = Math.max(0, para.index - 3);
        const windowEnd = Math.min(file.paragraphs.length - 1, para.index + 3);
        const window = file.paragraphs.filter((p) =>
          p.index >= windowStart && p.index <= windowEnd
        );

        results.push({
          source: file.source,
          file: file.file,
          matchParagraph: para,
          window,
        });
      }
    }
  }

  return results;
}

// --- LLM context extraction ---

async function extractFullContext(
  windowHtml: string[],
  word: string,
  _modelId: ModelId,
): Promise<string> {
  const model = getModel(_modelId);

  const result = await generateText({
    model,
    system: `You are extracting context for a Japanese language flashcard.

You will be given several paragraphs from a book. Select the appropriate "full context" for a flashcard about the given word.

Rules:
- Always include a complete sentence (ending with 。or closing quotation marks or other natural terminal punctuation)
- If the sentence is very short (under ~15 characters) or unclear on its own, include adjacent sentence(s) to clarify
- If the sentence is part of one- or two-sentence dialogue, include the whole dialogue exchange including 「」
- Never return unmatched Japanese quote brackets: if the selected text ends with 」, include the corresponding opening 「
- Do NOT include more context than necessary — usually one sentence is enough
- Preserve all HTML tags exactly as they appear (especially <ruby>, <rt>)
- Return ONLY the selected HTML context, no explanation or wrapping`,
    prompt: `Word: ${word}

Paragraphs:
${windowHtml.map((h, i) => `[${i}] ${h}`).join("\n")}`,
  });

  return result.text.trim();
}

// --- Main ---

type BatchEntry = {
  noteId: number;
  word: string;
  jmdictId: string | null;
  originalSentence: string;
  source: string | null;
  context: string | null;
  status: "matched" | "multiple_matches" | "not_found";
  candidates?: Array<{ source: string; context: string }>;
  warning?: string;
};

function wordInSentence(word: string, sentence: string): boolean {
  return stripHtml(sentence).includes(stripHtml(word));
}

const noteIds = await ac<number[]>("findNotes", {
  query: "deck:Mining tag:leech -tag:converted-to-miwake",
});

console.error(
  `Found ${noteIds.length} leech notes total, processing ${Math.min(count, noteIds.length)}`,
);

const notes = await ac<Array<Record<string, any>>>("notesInfo", {
  notes: noteIds.slice(0, count),
});

console.error("Building epub index...");
const epubIndex = await buildEpubIndex();

const results: BatchEntry[] = [];

for (const note of notes) {
  const fields = note.fields;
  const word: string = fields.Word?.value ?? fields["Recognition target"]?.value ?? "";
  const sentence: string = fields.Sentence?.value ?? "";
  const jmdictId = extractJmdictId(fields.Glossary?.value ?? "");

  console.error(`\nSearching for: ${word} — "${stripHtml(sentence).slice(0, 40)}..."`);

  const matches = searchEpubIndex(epubIndex, sentence);

  if (matches.length === 1) {
    const match = matches[0];
    console.error(`  Found in: ${match.source}`);

    const context = await extractFullContext(
      match.window.map((p) => p.html),
      word,
      modelId,
    );

    results.push({
      noteId: note.noteId,
      word,
      jmdictId,
      originalSentence: sentence,
      source: match.source,
      context,
      status: "matched",
    });
  } else if (matches.length > 1) {
    console.error(`  Multiple matches (${matches.length}):`);
    const candidates: Array<{ source: string; context: string }> = [];
    for (const match of matches) {
      console.error(`    - ${match.source}: ${match.matchParagraph.plainText.slice(0, 50)}...`);
      const context = await extractFullContext(
        match.window.map((p) => p.html),
        word,
        modelId,
      );
      candidates.push({ source: match.source, context });
    }

    // Use the first match as default, include all as candidates
    results.push({
      noteId: note.noteId,
      word,
      jmdictId,
      originalSentence: sentence,
      source: candidates[0].source,
      context: candidates[0].context,
      status: "multiple_matches",
      candidates,
    });
  } else {
    console.error(`  Not found in any epub`);
    results.push({
      noteId: note.noteId,
      word,
      jmdictId,
      originalSentence: sentence,
      source: null,
      context: null,
      status: "not_found",
    });
  }

  if (!wordInSentence(word, sentence)) {
    results[results.length - 1].warning = "word_not_in_sentence";
    console.error(`  ⚠ Word "${stripHtml(word)}" not found in sentence`);
  }
}

const dateStr = new Date().toISOString().slice(0, 10);
const outputPath = join(import.meta.dirname!, `batch_${dateStr}.json`);
await Deno.writeTextFile(outputPath, JSON.stringify(results, undefined, 2));
console.error(`\nWrote ${results.length} entries to ${outputPath}`);

const matched = results.filter((r) => r.status === "matched").length;
const multiple = results.filter((r) => r.status === "multiple_matches").length;
const notFound = results.filter((r) => r.status === "not_found").length;
const warnings = results.filter((r) => r.warning).length;
console.error(
  `  ${matched} matched, ${multiple} multiple matches, ${notFound} not found, ${warnings} warnings`,
);
