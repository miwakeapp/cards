import { assertEquals, assertRejects } from "@std/assert";
import * as path from "@std/path";
import { ensureLatestFurigana } from "../src/furigana_download.ts";
import { readRuntimeResourceManifest } from "../src/resource_manifest.ts";
import { resourcePaths } from "../src/resource_paths.ts";

async function withTemporaryResources(
  run: (furiganaPath: string, manifestPath: string) => Promise<void>,
): Promise<void> {
  const directory = path.join(
    import.meta.dirname!,
    "..",
    "generated",
    "test",
    `furigana-${crypto.randomUUID()}`,
  );
  const furiganaPath = path.join(directory, "jmdict_furigana.json");
  const manifestPath = path.join(directory, "manifest.json");
  const originalFuriganaPath = resourcePaths.jmdictFurigana;
  const originalManifestPath = resourcePaths.runtimeManifest;
  const originalFetch = globalThis.fetch;
  resourcePaths.jmdictFurigana = furiganaPath;
  resourcePaths.runtimeManifest = manifestPath;

  try {
    await run(furiganaPath, manifestPath);
  } finally {
    globalThis.fetch = originalFetch;
    resourcePaths.jmdictFurigana = originalFuriganaPath;
    resourcePaths.runtimeManifest = originalManifestPath;
    await Deno.remove(directory, { recursive: true }).catch(() => {});
  }
}

Deno.test("ensureLatestFurigana manages the downloaded artifact end to end", async () => {
  await withTemporaryResources(async (furiganaPath, manifestPath) => {
    const validSource = "1;食.べる;た.べる\n2;大人.買.い;おとな.が.い\n";
    globalThis.fetch = () => Promise.resolve(new Response("# no records\n"));
    await assertRejects(() => ensureLatestFurigana(), Error, "contains no records");

    globalThis.fetch = () =>
      Promise.resolve(
        new Response(validSource, {
          headers: { etag: 'W/"first"', "last-modified": "Wed, 15 Jul 2026 00:00:00 GMT" },
        }),
      );

    const first = await ensureLatestFurigana();
    assertEquals(first.action, "downloaded");
    assertEquals(first.current.entryCount, 2);
    assertEquals(JSON.parse(await Deno.readTextFile(furiganaPath)), {
      "1|食べる|たべる": "食[た]べる",
      "2|大人買い|おとながい": "大人[おとな] 買[が]い",
    });
    const manifest = await readRuntimeResourceManifest(manifestPath);
    assertEquals(manifest.resources.furigana?.etag, 'W/"first"');
    assertEquals(manifest.resources.furigana?.entryCount, 2);
    assertEquals(manifest.resources.furigana?.formatVersion, 4);

    let conditionalHeaders: Headers | undefined;
    globalThis.fetch = (_input, init) => {
      conditionalHeaders = new Headers(init?.headers);
      return Promise.resolve(new Response(null, { status: 304 }));
    };
    const current = await ensureLatestFurigana();
    assertEquals(current.action, "already-current");
    assertEquals(conditionalHeaders?.get("if-none-match"), 'W/"first"');

    const expandedSource = validSource + "3;走.る;はし.る\n";
    globalThis.fetch = () => Promise.resolve(new Response(expandedSource));
    await assertRejects(
      () => ensureLatestFurigana({ force: true }),
      Error,
      "add, remove, or change 50.0%",
    );
    assertEquals(Object.keys(JSON.parse(await Deno.readTextFile(furiganaPath))).length, 2);

    const accepted = await ensureLatestFurigana({ force: true, acceptLargeChange: true });
    assertEquals(accepted.action, "downloaded");
    assertEquals(accepted.current.entryCount, 3);

    globalThis.fetch = () => Promise.resolve(new Response("malformed\n"));
    await assertRejects(() => ensureLatestFurigana({ force: true }));
    assertEquals(Object.keys(JSON.parse(await Deno.readTextFile(furiganaPath))).length, 3);

    globalThis.fetch = () => {
      throw new Error("offline mode unexpectedly fetched");
    };
    const offline = await ensureLatestFurigana({ offline: true });
    assertEquals(offline.action, "offline");
    assertEquals(offline.current.entryCount, 3);
  });
});

Deno.test("ensureLatestFurigana inventories an existing artifact in offline mode", async () => {
  await withTemporaryResources(async (furiganaPath, manifestPath) => {
    await Deno.mkdir(path.dirname(furiganaPath), { recursive: true });
    await Deno.writeTextFile(
      furiganaPath,
      JSON.stringify({ "1|食べる|たべる": "食[た]べる" }),
    );

    const result = await ensureLatestFurigana({ offline: true });
    assertEquals(result.action, "offline");
    assertEquals(result.current.entryCount, 1);
    assertEquals(result.current.formatVersion, 0);
    assertEquals(result.current.artifact, "jmdict_furigana.json");
    assertEquals(
      (await readRuntimeResourceManifest(manifestPath)).resources.furigana,
      result.current,
    );
  });
});
