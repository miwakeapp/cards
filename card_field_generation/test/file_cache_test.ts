import { assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { JSONLGenerationCache } from "../src/file_cache.ts";

const TEMP_DIRECTORY = path.resolve(import.meta.dirname!, "../generated/test");

await Deno.mkdir(TEMP_DIRECTORY, { recursive: true });

Deno.test("JSONLGenerationCache loads lazily and uses the final duplicate record", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    const cache = new JSONLGenerationCache<{ hint: string }>(filePath);

    await Deno.writeTextFile(
      filePath,
      [
        JSON.stringify({ key: "duplicate", value: { hint: "old" } }),
        "",
        JSON.stringify({ key: "other", value: { hint: "unrelated" } }),
        JSON.stringify({ key: "duplicate", value: { hint: "new" } }),
        "",
      ].join("\n"),
    );

    assertEquals(await cache.get("duplicate"), { hint: "new" });
    assertEquals(await cache.get("other"), { hint: "unrelated" });
    assertEquals(await cache.get("missing"), undefined);
  });
});

Deno.test("JSONLGenerationCache creates parents and persists appended results", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "nested", "cache.jsonl");
    const cache = new JSONLGenerationCache<number>(filePath);

    assertEquals(await cache.get("missing"), undefined);
    await cache.set("first", 1);
    await cache.set("first", 2);
    await cache.set("second", 3);

    const reloaded = new JSONLGenerationCache<number>(filePath);
    assertEquals(await reloaded.get("first"), 2);
    assertEquals(await reloaded.get("second"), 3);

    const records = (await Deno.readTextFile(filePath)).trimEnd().split("\n").map((line) =>
      JSON.parse(line)
    );
    assertEquals(records, [
      { key: "first", value: 1 },
      { key: "first", value: 2 },
      { key: "second", value: 3 },
    ]);
  });
});

Deno.test("JSONLGenerationCache serializes concurrent operations in invocation order", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    const cache = new JSONLGenerationCache<number>(filePath);

    const writes = Array.from({ length: 50 }, (_, value) => cache.set("shared", value));
    const finalRead = cache.get("shared");
    await Promise.all(writes);

    assertEquals(await finalRead, 49);
    assertEquals(await new JSONLGenerationCache<number>(filePath).get("shared"), 49);

    const records = (await Deno.readTextFile(filePath)).trimEnd().split("\n").map((line) =>
      JSON.parse(line)
    );
    assertEquals(
      records,
      Array.from({ length: 50 }, (_, value) => ({ key: "shared", value })),
    );
  });
});

Deno.test("JSONLGenerationCache reports malformed records and retries loading", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    await Deno.writeTextFile(
      filePath,
      `${JSON.stringify({ key: "valid", value: 1 })}\nnot JSON\n`,
    );
    const cache = new JSONLGenerationCache<number>(filePath);

    await assertRejects(
      () => cache.get("valid"),
      SyntaxError,
      `${filePath}:2`,
    );

    await Deno.writeTextFile(filePath, `${JSON.stringify({ key: "valid", value: 2 })}\n`);
    assertEquals(await cache.get("valid"), 2);
  });
});

Deno.test("JSONLGenerationCache ignores and repairs an interrupted final append", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    await Deno.writeTextFile(
      filePath,
      `${JSON.stringify({ key: "complete", value: 1 })}\n{"key":"interrupted","value":`,
    );
    const cache = new JSONLGenerationCache<number>(filePath);

    assertEquals(await cache.get("complete"), 1);
    assertEquals(await cache.get("interrupted"), undefined);

    await cache.set("after-recovery", 2);
    assertEquals(await new JSONLGenerationCache<number>(filePath).get("complete"), 1);
    assertEquals(await new JSONLGenerationCache<number>(filePath).get("after-recovery"), 2);
    assertEquals(
      (await Deno.readTextFile(filePath)).split("\n").filter(Boolean).map((line) =>
        JSON.parse(line)
      ),
      [
        { key: "complete", value: 1 },
        { key: "after-recovery", value: 2 },
      ],
    );
  });
});

Deno.test("JSONLGenerationCache appends safely after a valid unterminated record", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    await Deno.writeTextFile(filePath, JSON.stringify({ key: "existing", value: 1 }));
    const cache = new JSONLGenerationCache<number>(filePath);

    assertEquals(await cache.get("existing"), 1);
    await cache.set("appended", 2);

    const reloaded = new JSONLGenerationCache<number>(filePath);
    assertEquals(await reloaded.get("existing"), 1);
    assertEquals(await reloaded.get("appended"), 2);
  });
});

Deno.test("JSONLGenerationCache rejects complete or interior corruption", async () => {
  await withTempDirectory(async (directory) => {
    const completeFinalPath = path.join(directory, "complete-final.jsonl");
    await Deno.writeTextFile(completeFinalPath, "not JSON\n");
    await assertRejects(
      () => new JSONLGenerationCache(completeFinalPath).get("anything"),
      SyntaxError,
      `${completeFinalPath}:1`,
    );

    const interiorPath = path.join(directory, "interior.jsonl");
    await Deno.writeTextFile(
      interiorPath,
      `not JSON\n${JSON.stringify({ key: "complete", value: 1 })}`,
    );
    await assertRejects(
      () => new JSONLGenerationCache(interiorPath).get("complete"),
      SyntaxError,
      `${interiorPath}:1`,
    );

    const structurallyInvalidFinalPath = path.join(directory, "invalid-final.jsonl");
    await Deno.writeTextFile(structurallyInvalidFinalPath, '{"key":1,"value":2}');
    await assertRejects(
      () => new JSONLGenerationCache(structurallyInvalidFinalPath).get("anything"),
      SyntaxError,
      `${structurallyInvalidFinalPath}:1`,
    );
  });
});

Deno.test("JSONLGenerationCache rejects lossy JavaScript values and recovers", async (test) => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    const cache = new JSONLGenerationCache<unknown>(filePath);

    const sparseArray = [1, 2];
    delete sparseArray[0];
    const arrayWithProperty = [1, 2] as number[] & { extra?: string };
    arrayWithProperty.extra = "lost";
    const symbolProperty = { ordinary: true } as Record<PropertyKey, unknown>;
    symbolProperty[Symbol("lost")] = true;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "value", { enumerable: true, get: () => 1 });
    const nonEnumerable = {} as Record<string, unknown>;
    Object.defineProperty(nonEnumerable, "value", { enumerable: false, value: 1 });
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ["undefined", undefined],
      ["bigint", 1n],
      ["function", () => undefined],
      ["nested-undefined", { nested: { omitted: undefined } }],
      ["nested-function", { nested: [() => undefined] }],
      ["date", { nested: new Date("2026-07-30T00:00:00Z") }],
      ["nan", { nested: Number.NaN }],
      ["positive-infinity", { nested: Number.POSITIVE_INFINITY }],
      ["negative-infinity", { nested: Number.NEGATIVE_INFINITY }],
      ["negative-zero", { nested: -0 }],
      ["sparse-array", sparseArray],
      ["array-property", arrayWithProperty],
      ["map", { nested: new Map([["lost", true]]) }],
      ["symbol-property", symbolProperty],
      ["accessor", accessor],
      ["non-enumerable", nonEnumerable],
      ["cyclic", cyclic],
    ];
    for (const [name, value] of cases) {
      await test.step(name, async () => {
        await assertRejects(
          () => cache.set(name, value),
          TypeError,
          name === "undefined" ? "undefined represents a miss" : "not lossless JSON",
        );
      });
    }

    await cache.set("valid", { hint: "works afterward" });
    assertEquals(await cache.get("valid"), { hint: "works afterward" });
  });
});

Deno.test("JSONLGenerationCache returns serialized value semantics before and after restart", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    const cache = new JSONLGenerationCache<Record<string, unknown>>(filePath);
    const original = Object.assign(Object.create(null), {
      nested: [null, true, 1.25, "日本語"],
      object: { second: 2, first: 1 },
    });

    await cache.set("value", original);
    const immediate = await cache.get("value");
    const reopened = await new JSONLGenerationCache<Record<string, unknown>>(filePath).get("value");

    assertEquals(immediate, reopened);
    assertEquals(Object.getPrototypeOf(immediate!), Object.prototype);
    original.object.first = 99;
    assertEquals(await cache.get("value"), reopened);
  });
});

Deno.test("JSONLGenerationCache preserves an ordinary generation cache record", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "cache.jsonl");
    const cache = new JSONLGenerationCache(filePath);
    const record = {
      formatVersion: 1,
      rawOutput: { outcome: "selected", senseNumbers: [1] },
      modelConfigurationId: "mock-model@low",
      provenance: {
        generatedAt: "2026-07-30T00:00:00.000Z",
        validationVersion: 1,
        attempts: [{
          number: 1,
          modelConfigurationId: "mock-model@low",
          responseModelId: "mock-model-2026-07-30",
          responseId: "response-1",
          promptFingerprint: "prompt-hash",
          latencyMilliseconds: 10,
          usage: {
            inputTokens: 100,
            noCacheInputTokens: 80,
            cacheReadInputTokens: 20,
            cacheWriteInputTokens: 0,
            providerUsageInconsistent: true,
            outputTokens: 10,
            reasoningOutputTokens: 2,
          },
        }],
        latencyMilliseconds: 12,
        usage: {
          inputTokens: 100,
          noCacheInputTokens: 80,
          cacheReadInputTokens: 20,
          cacheWriteInputTokens: 0,
          providerUsageInconsistent: true,
          outputTokens: 10,
          reasoningOutputTokens: 2,
        },
        fingerprints: {
          basePrompt: "base",
          stablePrompt: "stable",
          schema: "schema",
          configuration: "configuration",
        },
      },
    };

    await cache.set("generation", record);

    assertEquals(await cache.get("generation"), record);
    assertEquals(await new JSONLGenerationCache(filePath).get("generation"), record);
  });
});

Deno.test("JSONLGenerationCache reloads after a filesystem write failure", async () => {
  await withTempDirectory(async (directory) => {
    const blockedParentPath = path.join(directory, "blocked-parent");
    const filePath = path.join(blockedParentPath, "cache.jsonl");
    await Deno.writeTextFile(blockedParentPath, "not a directory");
    const cache = new JSONLGenerationCache<number>(filePath);

    await assertRejects(() => cache.set("failed", 1));

    // A real append failure can leave an interrupted JSON record behind. Recreate that state
    // explicitly after the portable `mkdir()` failure above; the same cache instance must reload
    // the file instead of trusting the state from before its failed write.
    await Deno.remove(blockedParentPath);
    await Deno.mkdir(blockedParentPath);
    await Deno.writeTextFile(
      filePath,
      `${JSON.stringify({ key: "complete", value: 2 })}\n{"key":"interrupted","value":`,
    );

    await cache.set("after-recovery", 3);

    assertEquals(await cache.get("complete"), 2);
    assertEquals(await cache.get("failed"), undefined);
    assertEquals(await cache.get("after-recovery"), 3);
    assertEquals(
      (await Deno.readTextFile(filePath)).split("\n").filter(Boolean).map((line) =>
        JSON.parse(line)
      ),
      [
        { key: "complete", value: 2 },
        { key: "after-recovery", value: 3 },
      ],
    );
  });
});

async function withTempDirectory(callback: (directory: string) => Promise<void>): Promise<void> {
  const directory = await Deno.makeTempDir({
    dir: TEMP_DIRECTORY,
    prefix: "generation-cache-",
  });
  try {
    await callback(directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
