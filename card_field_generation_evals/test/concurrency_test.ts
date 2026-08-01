import { assertEquals, assertRejects } from "@std/assert";
import { mapConcurrent } from "../src/concurrency.ts";

Deno.test("mapConcurrent preserves input order", async () => {
  assertEquals(
    await mapConcurrent([3, 1, 2], 2, async (value) => {
      await Promise.resolve();
      return value * 2;
    }),
    [6, 2, 4],
  );
});

Deno.test("mapConcurrent stops workers from claiming inputs after a rejection", async () => {
  const blockedRequest = Promise.withResolvers<void>();
  const started: number[] = [];
  const result = mapConcurrent([0, 1, 2, 3], 2, async (_value, index) => {
    started.push(index);
    if (index === 0) throw new Error("quota exhausted");
    await blockedRequest.promise;
    return index;
  });

  await Promise.resolve();
  assertEquals(started, [0, 1]);

  blockedRequest.resolve();
  await assertRejects(() => result, Error, "quota exhausted");
  assertEquals(started, [0, 1]);
});
