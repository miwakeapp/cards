/**
 * AnkiConnect access for the card updater: fetching Miwake note snapshots and applying
 * reviewed field updates.
 */

export type ACInvoke = <T = unknown>(
  action: string,
  params?: Record<string, unknown>,
) => Promise<T>;

export const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";

export function createACInvoke(
  ankiConnectURL: string,
  fetchImplementation: typeof fetch = fetch,
): ACInvoke {
  return async <T = unknown>(
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImplementation(ankiConnectURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: 6, params }),
      });
    } catch (cause) {
      throw new Error(
        `Could not reach AnkiConnect at ${ankiConnectURL}. Is Anki running with the AnkiConnect add-on?`,
        { cause },
      );
    }
    const json = await response.json();
    if (json.error) {
      throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
    }
    return json.result as T;
  };
}

export const ac = createACInvoke(DEFAULT_ANKI_CONNECT_URL);

export interface MiwakeNoteFields {
  key: string;
  recognitionTarget: string;
  reading: string;
  hint: string;
  fullContext: string;
  minimizedContext: string;
  dictionaryEntry: string;
  source: string;
}

export interface MiwakeNoteSnapshot {
  noteId: number;
  tags: string[];
  cards: number[];
  fields: MiwakeNoteFields;
}

interface AnkiNoteInfo {
  noteId: number;
  tags: string[];
  cards: number[];
  modelName: string;
  fields: Record<string, { value: string; order: number }>;
}

const FIELD_NAMES = {
  key: "Key",
  recognitionTarget: "Recognition target",
  reading: "Reading",
  hint: "Hint",
  fullContext: "Full context",
  minimizedContext: "Minimized context",
  dictionaryEntry: "Dictionary entry",
  source: "Source",
} as const;

/** Strips incidental markup Anki may have added to a plain-text field. */
export function normalizeAnkiPlainText(html: string): string {
  return decodeBasicEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function snapshotFromNoteInfo(info: AnkiNoteInfo): MiwakeNoteSnapshot {
  const value = (name: string) => info.fields[name]?.value ?? "";
  return {
    noteId: info.noteId,
    tags: info.tags,
    cards: info.cards,
    fields: {
      key: normalizeAnkiPlainText(value(FIELD_NAMES.key)),
      recognitionTarget: normalizeAnkiPlainText(value(FIELD_NAMES.recognitionTarget)),
      reading: value(FIELD_NAMES.reading),
      hint: normalizeAnkiPlainText(value(FIELD_NAMES.hint)),
      fullContext: value(FIELD_NAMES.fullContext),
      minimizedContext: value(FIELD_NAMES.minimizedContext),
      dictionaryEntry: value(FIELD_NAMES.dictionaryEntry),
      source: value(FIELD_NAMES.source),
    },
  };
}

export async function fetchMiwakeNotes(
  query: string,
  { limit, invoke = ac, onProgress }: {
    limit?: number;
    invoke?: ACInvoke;
    onProgress?: (fetched: number, total: number) => void;
  } = {},
): Promise<MiwakeNoteSnapshot[]> {
  let noteIds = await invoke<number[]>("findNotes", { query });
  if (limit !== undefined) {
    noteIds = noteIds.slice(0, limit);
  }

  const snapshots: MiwakeNoteSnapshot[] = [];
  const chunkSize = 200;
  for (let i = 0; i < noteIds.length; i += chunkSize) {
    const chunk = noteIds.slice(i, i + chunkSize);
    const infos = await invoke<AnkiNoteInfo[]>("notesInfo", { notes: chunk });
    snapshots.push(...infos.map(snapshotFromNoteInfo));
    onProgress?.(snapshots.length, noteIds.length);
  }

  return snapshots;
}

export interface NoteFieldUpdate {
  noteId: number;
  /** Values the fields must still have for the update to proceed. */
  expect: { key: string; reading: string; dictionaryEntry: string; hint: string };
  /** New field values; only present keys are written. */
  set: { key?: string; reading?: string; dictionaryEntry?: string; hint?: string };
}

export type AppliedFieldValues = Pick<
  MiwakeNoteFields,
  "key" | "reading" | "dictionaryEntry" | "hint"
>;

export type ApplyResult =
  | {
    noteId: number;
    ok: true;
    error?: never;
    wroteFields: string[];
    before: AppliedFieldValues;
    after: AppliedFieldValues;
  }
  | {
    noteId: number;
    ok: false;
    error: string;
    wroteFields: string[];
    before?: never;
    after?: never;
  };

/**
 * Applies one reviewed update, guarding against the note having changed in Anki since it was
 * analyzed: the current field values must still match the analysis-time snapshot.
 */
export async function applyNoteUpdate(
  update: NoteFieldUpdate,
  invoke: ACInvoke = ac,
): Promise<ApplyResult> {
  const infos = await invoke<AnkiNoteInfo[]>("notesInfo", { notes: [update.noteId] });
  const current = infos[0];
  if (!current || Object.keys(current).length === 0) {
    return { noteId: update.noteId, ok: false, error: "Note no longer exists.", wroteFields: [] };
  }

  const snapshot = snapshotFromNoteInfo(current);
  const mismatches: string[] = [];
  if (snapshot.fields.key !== update.expect.key) {
    mismatches.push("Key");
  }
  if (snapshot.fields.reading !== update.expect.reading) {
    mismatches.push("Reading");
  }
  if (snapshot.fields.dictionaryEntry.trim() !== update.expect.dictionaryEntry.trim()) {
    mismatches.push("Dictionary entry");
  }
  if (snapshot.fields.hint !== update.expect.hint) {
    mismatches.push("Hint");
  }
  if (mismatches.length > 0) {
    return {
      noteId: update.noteId,
      ok: false,
      error: `Note changed in Anki since analysis (${mismatches.join(", ")}). Re-run the tool.`,
      wroteFields: [],
    };
  }

  const before = {
    key: snapshot.fields.key,
    reading: snapshot.fields.reading,
    dictionaryEntry: snapshot.fields.dictionaryEntry,
    hint: snapshot.fields.hint,
  };
  const after = {
    key: update.set.key ?? before.key,
    reading: update.set.reading ?? before.reading,
    dictionaryEntry: update.set.dictionaryEntry ?? before.dictionaryEntry,
    hint: update.set.hint ?? before.hint,
  };

  const fields: Record<string, string> = {};
  if (update.set.key !== undefined && update.set.key !== snapshot.fields.key) {
    fields[FIELD_NAMES.key] = update.set.key;
  }
  if (update.set.reading !== undefined && update.set.reading !== snapshot.fields.reading) {
    fields[FIELD_NAMES.reading] = update.set.reading;
  }
  if (
    update.set.dictionaryEntry !== undefined &&
    update.set.dictionaryEntry !== snapshot.fields.dictionaryEntry
  ) {
    fields[FIELD_NAMES.dictionaryEntry] = update.set.dictionaryEntry;
  }
  if (update.set.hint !== undefined && update.set.hint !== snapshot.fields.hint) {
    fields[FIELD_NAMES.hint] = update.set.hint;
  }

  if (Object.keys(fields).length === 0) {
    return { noteId: update.noteId, ok: true, wroteFields: [], before, after };
  }

  try {
    await invoke("updateNoteFields", { note: { id: update.noteId, fields } });
  } catch (error) {
    return {
      noteId: update.noteId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      wroteFields: [],
    };
  }

  return { noteId: update.noteId, ok: true, wroteFields: Object.keys(fields), before, after };
}

/** Opens the Anki card browser focused on the given note. */
export function openNoteInAnki(noteId: number, invoke: ACInvoke = ac): Promise<unknown> {
  return invoke("guiBrowse", { query: `nid:${noteId}` });
}
