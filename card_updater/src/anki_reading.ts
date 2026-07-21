import { formatReadingForAnki } from "jmdict_to_html/format-reading-for-anki";

/** Parses the strict Anki bracket syntax emitted by Miwake and verifies its surface spelling. */
export function parseAnkiReading(
  field: string,
  expectedSurface: string,
): string[] | null {
  const readings: string[] = [];
  for (const formatted of field.split(" / ")) {
    let surface = "";
    let reading = "";
    for (const chunk of formatted.split(" ")) {
      if (!chunk) {
        return null;
      }
      const parsed = parseChunk(chunk);
      if (parsed === null) {
        return null;
      }
      surface += parsed.surface;
      reading += parsed.reading;
    }
    if (surface !== expectedSurface) {
      return null;
    }
    readings.push(reading);
  }

  return readings;
}

function parseChunk(chunk: string): { surface: string; reading: string } | null {
  const open = chunk.indexOf("[");
  if (open === -1) {
    return chunk.includes("]") ? null : { surface: chunk, reading: chunk };
  }
  const close = chunk.indexOf("]", open + 1);
  if (
    close === -1 || close === open + 1 ||
    chunk.indexOf("[", open + 1) !== -1 || chunk.indexOf("]", close + 1) !== -1
  ) {
    return null;
  }

  const base = chunk.slice(0, open);
  const annotation = chunk.slice(open + 1, close);
  const suffix = chunk.slice(close + 1);
  if (base === "") {
    return suffix === "" ? { surface: "", reading: annotation } : null;
  }
  return { surface: base + suffix, reading: annotation + suffix };
}

/**
 * Recomputes furigana boundaries while preserving each pronunciation already stored on the card.
 */
export async function recomputeAnkiReading(
  field: string,
  expectedSurface: string,
  jmdictId: string,
): Promise<string | null> {
  const parsed = parseAnkiReading(field, expectedSurface);
  if (parsed === null) return null;

  const formatted: string[] = [];
  for (const reading of parsed) {
    const updated = await formatReadingForAnki(
      jmdictId,
      expectedSurface,
      reading,
    );
    if (updated === null) {
      return null;
    }
    formatted.push(updated);
  }

  return formatted.join(" / ");
}
