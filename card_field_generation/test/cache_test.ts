import { assertEquals, assertRejects } from "@std/assert";
import { generationCacheKey, MemoryGenerationCache } from "../src/cache.ts";

Deno.test("MemoryGenerationCache distinguishes misses and replaces stored results", async () => {
  const cache = new MemoryGenerationCache<{ hint: string }>();

  assertEquals(await cache.get("unknown"), undefined);

  await cache.set("same-input", { hint: "first" });
  assertEquals(await cache.get("same-input"), { hint: "first" });

  await cache.set("same-input", { hint: "replacement" });
  assertEquals(await cache.get("same-input"), { hint: "replacement" });
});

Deno.test("MemoryGenerationCache reserves undefined for misses", async () => {
  const cache = new MemoryGenerationCache<string | undefined>();

  await assertRejects(
    () => cache.set("ambiguous", undefined),
    TypeError,
    "undefined represents a miss",
  );
  assertEquals(await cache.get("ambiguous"), undefined);
});

Deno.test("generationCacheKey hashes recursively canonicalized JSON", async () => {
  const first = {
    operation: "sense-and-hint",
    input: {
      senses: [3, 1],
      target: "由来",
    },
  };
  const reordered = {
    input: {
      target: "由来",
      senses: [3, 1],
    },
    operation: "sense-and-hint",
  };

  assertEquals(await generationCacheKey(first), await generationCacheKey(reordered));
  assertEquals(
    await generationCacheKey({ b: 2, a: 1 }),
    "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

Deno.test("generationCacheKey preserves meaningful JSON distinctions", async () => {
  const ordered = await generationCacheKey({ values: ["a", "b"] });

  assertEquals(ordered === await generationCacheKey({ values: ["b", "a"] }), false);
  assertEquals(ordered === await generationCacheKey({ values: ["a", "b"], extra: null }), false);
  assertEquals(await generationCacheKey(null) === await generationCacheKey("null"), false);
});

Deno.test("generationCacheKey rejects ambiguous non-JSON input", async () => {
  await assertRejects(
    () => generationCacheKey({ omitted: undefined }),
    TypeError,
    "type undefined",
  );
  await assertRejects(
    () => generationCacheKey([, "present"]),
    TypeError,
    "sparse array",
  );
  await assertRejects(
    () => generationCacheKey(Number.NaN),
    TypeError,
    "non-finite number",
  );
  await assertRejects(
    () => generationCacheKey(new Date("2026-07-29T00:00:00Z")),
    TypeError,
    "non-plain object",
  );

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  await assertRejects(
    () => generationCacheKey(cyclic),
    TypeError,
    "cyclic structure",
  );
});
