/**
 * A persistent or ephemeral store for completed generation results.
 *
 * Cache keys are opaque to implementations. Generation operations construct content-addressed
 * keys from their complete request. Code using this interface independently can use
 * {@link generationCacheKey} when it needs the same canonical hashing behavior.
 *
 * `undefined` is reserved for cache misses and must not be stored as a value.
 *
 * @typeParam Value The validated generation result stored by this cache.
 */
export interface GenerationCache<Value = unknown> {
  /** Returns the stored result, or `undefined` when `key` has not been cached. */
  get(key: string): Promise<Value | undefined>;

  /** Stores `value`, replacing any result already associated with `key`. */
  set(key: string, value: Value): Promise<void>;
}

/**
 * An ephemeral {@link GenerationCache} backed by a `Map`.
 *
 * This is useful for tests and for preventing duplicate calls within a single process. Use the
 * file-cache subpath when results need to survive process restarts.
 */
export class MemoryGenerationCache<Value = unknown> implements GenerationCache<Value> {
  readonly #values = new Map<string, Value>();

  /** Returns the stored result, or `undefined` when `key` has not been cached. */
  get(key: string): Promise<Value | undefined> {
    return Promise.resolve(this.#values.get(key));
  }

  /** Stores `value`, replacing any result already associated with `key`. */
  set(key: string, value: Value): Promise<void> {
    if (value === undefined) {
      return Promise.reject(
        new TypeError("Generation cache values must not be undefined; undefined represents a miss"),
      );
    }

    this.#values.set(key, value);
    return Promise.resolve();
  }
}

/**
 * Creates a lowercase hexadecimal SHA-256 cache key from canonical JSON content.
 *
 * Object keys are sorted recursively, while array order is preserved. Consequently, objects with
 * the same JSON content produce the same key regardless of insertion order. Values that JSON
 * cannot represent unambiguously—such as `undefined`, non-finite numbers, sparse arrays,
 * non-plain objects, and cyclic structures—are rejected instead of being silently discarded or
 * coerced.
 */
export async function generationCacheKey(content: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalGenerationJSON(content));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Canonical JSON representation used internally for collision-free synchronous coordination. */
export function canonicalGenerationJSON(value: unknown): string {
  return canonicalGenerationJSONValue(value, new Set());
}

function canonicalGenerationJSONValue(value: unknown, ancestors: Set<object>): string {
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);

    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot create a generation cache key from non-finite number ${value}`);
      }
      if (Object.is(value, -0)) {
        throw new TypeError("Cannot create a generation cache key from negative zero");
      }
      return JSON.stringify(value);

    case "object":
      if (value === null) {
        return "null";
      }
      return canonicalJSONObject(value, ancestors);

    case "bigint":
    case "function":
    case "symbol":
    case "undefined":
      throw new TypeError(
        `Cannot create a generation cache key from a value of type ${typeof value}`,
      );
  }
}

function canonicalJSONObject(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) {
    throw new TypeError("Cannot create a generation cache key from a cyclic structure");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; ++index) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("Cannot create a generation cache key from a sparse array");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, index)!;
        if (!descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(
            "Cannot create a generation cache key from an array with nonstandard elements",
          );
        }
        items.push(canonicalGenerationJSONValue(descriptor.value, ancestors));
      }
      const expectedKeys = new Set(["length", ...items.keys().map(String)]);
      if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
        throw new TypeError(
          "Cannot create a generation cache key from an array with extra properties",
        );
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Cannot create a generation cache key from non-plain object ${
          Object.prototype.toString.call(value)
        }`,
      );
    }

    const properties = Reflect.ownKeys(value).map((key) => {
      if (typeof key !== "string") {
        throw new TypeError(
          "Cannot create a generation cache key from an object with symbol properties",
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(
          "Cannot create a generation cache key from an object with nonstandard properties",
        );
      }
      return [key, descriptor.value] as const;
    }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([
      key,
      propertyValue,
    ]) => `${JSON.stringify(key)}:${canonicalGenerationJSONValue(propertyValue, ancestors)}`);
    return `{${properties.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
