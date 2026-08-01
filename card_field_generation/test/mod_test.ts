import { assertEquals } from "@std/assert";

Deno.test({
  name: "package root exposes lightweight utilities without runtime read permission",
  permissions: { read: false, sys: ["hostname"] },
  async fn() {
    const { MemoryGenerationCache } = await import("card_field_generation");
    const cache = new MemoryGenerationCache<string>();

    await cache.set("key", "value");

    assertEquals(await cache.get("key"), "value");
  },
});
