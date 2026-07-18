import type { ACInvoke } from "../shared/anki_connect.ts";
import type { AnkiNoteInfo } from "./types.ts";

export interface FetchNoteInfosOptions {
  chunkSize?: number;
  maxAttempts?: number;
  retryDelayMilliseconds?: number;
  onProgress?: (fetched: number, total: number) => void;
  onRetry?: (error: unknown, attempt: number, maxAttempts: number) => void;
}

export async function fetchNoteInfos(
  noteIds: number[],
  invoke: ACInvoke,
  options: FetchNoteInfosOptions = {},
): Promise<AnkiNoteInfo[]> {
  const {
    chunkSize = 200,
    maxAttempts = 3,
    retryDelayMilliseconds = 500,
    onProgress,
    onRetry,
  } = options;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("maxAttempts must be a positive integer");
  }

  const notes: AnkiNoteInfo[] = [];
  for (let index = 0; index < noteIds.length; index += chunkSize) {
    const chunk = noteIds.slice(index, index + chunkSize);
    let chunkNotes: AnkiNoteInfo[] | undefined;
    for (let attempt = 1; attempt <= maxAttempts; ++attempt) {
      try {
        chunkNotes = await invoke<AnkiNoteInfo[]>("notesInfo", { notes: chunk });
        break;
      } catch (error) {
        if (attempt === maxAttempts) throw error;
        onRetry?.(error, attempt, maxAttempts);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds * attempt));
      }
    }
    notes.push(...chunkNotes!);
    onProgress?.(notes.length, noteIds.length);
  }
  return notes;
}

export function ankiSearchValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
