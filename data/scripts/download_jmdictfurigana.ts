import * as path from "@std/path";

const furiganaURL = "https://jisho.hlorenzi.com/furigana.txt";
const outputFilename = path.resolve(import.meta.dirname!, "../jmdict_furigana.json");
const temporaryFilename = `${outputFilename}.download`;

console.log(`Downloading from: ${furiganaURL}`);

const response = await fetch(furiganaURL);
if (!response.ok) {
  throw new Error(`Failed to download: ${response.statusText}`);
}

// Stream the response to handle large file
let text = "";
let charactersRead = 0;

let lastLogTime = Date.now();
for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
  charactersRead += chunk.length;
  text += chunk;
  if (Date.now() - lastLogTime > 1000) {
    lastLogTime = Date.now();
    console.log(`Downloaded ${charactersRead} characters...`);
  }
}

const lines = text.split("\n");
console.log(`Downloaded ${charactersRead} characters, ${lines.length} lines. Processing...`);

function toAnkiFormat(wordDotted: string, readingDotted: string): string {
  const wordParts = wordDotted.split(".");
  const readingParts = readingDotted.split(".");

  if (wordParts.length !== readingParts.length) {
    throw new Error(
      `Mismatched parts: ${wordDotted} (${wordParts.length}) vs ${readingDotted} (${readingParts.length})`,
    );
  }

  let result = "";
  for (let i = 0; i < wordParts.length; i++) {
    const wordPart = wordParts[i];
    const readingPart = readingParts[i];

    if (wordPart !== readingPart) {
      // Needs furigana - add space before if not at the start
      if (result.length > 0) {
        result += " ";
      }
      result += `${wordPart}[${readingPart}]`;
    } else {
      // Same text - append directly without brackets
      result += wordPart;
    }
  }

  return result;
}

// Build the lookup object
const furiganaData: Record<string, string> = {};
let processedCount = 0;
let skippedCount = 0;

for (const line of lines) {
  if (!line.trim()) continue;

  const parts = line.split(";");
  if (parts.length !== 3) {
    console.log(`Skipping line because it doesn't have 3 parts: ${line}`);
    skippedCount++;
    continue;
  }

  const [id, wordDotted, readingDotted] = parts;

  // Remove dots to get the actual word and reading
  const word = wordDotted.replace(/\./g, "");
  const reading = readingDotted.replace(/\./g, "");

  try {
    const ankiFormat = toAnkiFormat(wordDotted, readingDotted);
    const key = `${id}|${word}|${reading}`;
    furiganaData[key] = ankiFormat;
    processedCount++;
  } catch (e) {
    console.error(`Error processing line: ${line}`);
    console.error(e);
    skippedCount++;
  }
}

console.log(`Processed ${processedCount} entries, skipped ${skippedCount}`);
if (processedCount < 500_000 || skippedCount > processedCount / 100) {
  throw new Error(
    `Implausible furigana data: processed ${processedCount} entries and skipped ${skippedCount}`,
  );
}

const json = JSON.stringify(furiganaData);
await Deno.writeTextFile(temporaryFilename, json);
await Deno.rename(temporaryFilename, outputFilename);

console.log(`Saved to ${outputFilename} (${(json.length / 1024 / 1024).toFixed(2)} MB)`);
