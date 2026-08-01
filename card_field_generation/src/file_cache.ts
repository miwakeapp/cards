/**
 * Deno file-backed generation-result caching for command-line tools and evaluation harnesses.
 *
 * @module
 */

import { dirname } from "@std/path";
import { canonicalGenerationJSON, type GenerationCache } from "./cache.ts";

interface CacheRecord<Value> {
  key: string;
  value: Value;
}

/**
 * An append-only JSON Lines {@link GenerationCache}.
 *
 * The file is read lazily on the first operation. Repeated keys are expected in an append-only
 * cache, and the final record wins. Operations made through one instance are serialized, so
 * concurrent writes cannot interleave and a later operation observes every earlier successful
 * write. A syntactically incomplete final record without a terminating newline is treated as an
 * interrupted append and replaced by the next write; complete malformed records and interior
 * corruption are rejected. Separate instances or processes writing to the same file are not
 * coordinated.
 *
 * The parent directory is created on the first write. Values must be losslessly representable as
 * JSON data, and `undefined` is reserved for cache misses. A successful write stores the parsed
 * JSON value in memory, so reads have the same semantics before and after process restart.
 */
export class JSONLGenerationCache<Value = unknown> implements GenerationCache<Value> {
  readonly #filePath: string;
  readonly #values = new Map<string, Value>();
  #loaded = false;
  #operationTail: Promise<void> = Promise.resolve();
  #truncateBeforeNextWrite: number | undefined;
  #prependNewlineBeforeNextWrite = false;

  /** Creates a cache whose records are stored at `filePath`. */
  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  /** Returns the final stored result for `key`, or `undefined` when it has not been cached. */
  get(key: string): Promise<Value | undefined> {
    return this.#enqueue(async () => {
      await this.#load();
      return this.#values.get(key);
    });
  }

  /** Appends `value` to the cache and makes it visible to subsequent operations. */
  set(key: string, value: Value): Promise<void> {
    return this.#enqueue(async () => {
      await this.#load();
      const serialized = serializeRecord(key, value);
      try {
        await Deno.mkdir(dirname(this.#filePath), { recursive: true });
        if (this.#truncateBeforeNextWrite !== undefined) {
          await Deno.truncate(this.#filePath, this.#truncateBeforeNextWrite);
          this.#truncateBeforeNextWrite = undefined;
        }
        await Deno.writeTextFile(
          this.#filePath,
          `${this.#prependNewlineBeforeNextWrite ? "\n" : ""}${serialized.line}\n`,
          {
            append: true,
            create: true,
          },
        );
      } catch (error) {
        // A failed append is allowed to have written a partial final record. Forget both the
        // loaded values and any planned repair so the next operation re-reads the actual file and
        // discovers the new truncation boundary before attempting another append.
        this.#invalidateLoadedState();
        throw error;
      }
      this.#prependNewlineBeforeNextWrite = false;
      this.#values.set(key, serialized.value);
    });
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operationTail.then(operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #invalidateLoadedState(): void {
    this.#values.clear();
    this.#loaded = false;
    this.#truncateBeforeNextWrite = undefined;
    this.#prependNewlineBeforeNextWrite = false;
  }

  async #load(): Promise<void> {
    if (this.#loaded) {
      return;
    }

    let contents: string;
    try {
      contents = await Deno.readTextFile(this.#filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        this.#loaded = true;
        return;
      }
      throw error;
    }

    const loadedValues = new Map<string, Value>();
    const lines = contents.split("\n");
    const hasTerminatingNewline = contents.endsWith("\n");
    let lineStart = 0;
    for (let index = 0; index < lines.length; ++index) {
      const line = lines[index];
      if (line.trim() === "") {
        lineStart += line.length + 1;
        continue;
      }

      let record: CacheRecord<Value>;
      try {
        record = parseRecord<Value>(line, this.#filePath, index + 1);
      } catch (error) {
        const isUnterminatedFinalLine = index === lines.length - 1 && !hasTerminatingNewline;
        // An append can be interrupted after writing only part of its final JSON record. Ignore
        // that tail, but remember its byte offset so the next write replaces rather than embeds it.
        // A complete malformed line—and corruption anywhere before the tail—remains fatal.
        if (isUnterminatedFinalLine && error instanceof JSONRecordParseError) {
          this.#truncateBeforeNextWrite = new TextEncoder().encode(
            contents.slice(0, lineStart),
          ).length;
          break;
        }
        throw error;
      }
      loadedValues.set(record.key, record.value);
      lineStart += line.length + 1;
    }

    this.#values.clear();
    for (const [key, value] of loadedValues) {
      this.#values.set(key, value);
    }
    if (this.#truncateBeforeNextWrite === undefined) {
      this.#prependNewlineBeforeNextWrite = contents.length > 0 && !hasTerminatingNewline;
    }
    this.#loaded = true;
  }
}

function serializeRecord<Value>(key: string, value: Value): { line: string; value: Value } {
  if (value === undefined) {
    throw new TypeError(
      "Generation cache values must not be undefined; undefined represents a miss",
    );
  }

  try {
    const line = canonicalGenerationJSON({ key, value });
    const record = JSON.parse(line) as CacheRecord<Value>;
    return { line, value: record.value };
  } catch (error) {
    throw new TypeError(
      `Generation cache value for key ${JSON.stringify(key)} is not lossless JSON`,
      {
        cause: error,
      },
    );
  }
}

function parseRecord<Value>(
  line: string,
  filePath: string,
  lineNumber: number,
): CacheRecord<Value> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new JSONRecordParseError(filePath, lineNumber, error);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof Reflect.get(parsed, "key") !== "string" ||
    !Object.hasOwn(parsed, "value")
  ) {
    throw invalidRecordError(filePath, lineNumber);
  }

  return parsed as unknown as CacheRecord<Value>;
}

class JSONRecordParseError extends SyntaxError {
  constructor(filePath: string, lineNumber: number, cause: unknown) {
    super(`Invalid generation cache record at ${filePath}:${lineNumber}`, { cause });
    this.name = "JSONRecordParseError";
  }
}

function invalidRecordError(filePath: string, lineNumber: number, cause?: unknown): SyntaxError {
  return new SyntaxError(
    `Invalid generation cache record at ${filePath}:${lineNumber}`,
    cause === undefined ? undefined : { cause },
  );
}
