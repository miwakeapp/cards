import * as path from "@std/path";
import {
  BUNPRO_SAMPLE_GRAMMAR_POINT_URL,
  BUNPRO_SITEMAP_URL,
  bunproBuildIdFromHTML,
  type BunproExampleCorpus,
  type BunproGrammarPoint,
  bunproGrammarPointFromPageProps,
  bunproGrammarPointURLsFromSitemap,
} from "../../src/bunpro.ts";
import { resourcePaths } from "../../src/resource_paths.ts";

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 8;
const EXPECTED_LOGGED_OUT_SAMPLE_COUNT = 12;
// Increment whenever parsing changes so resumable downloads cannot reuse stale derived records.
const CACHE_VERSION = 1;

interface CachedGrammarPoint {
  cacheVersion: number;
  buildId: string;
  url: string;
  grammarPoint: BunproGrammarPoint;
}

async function fetchText(url: string): Promise<string> {
  let finalError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; ++attempt) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "miwakeapp-cards-source-corpus-downloader/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      finalError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 4 ** (attempt - 1)));
      }
    }
  }
  throw new Error(`Failed to download ${url}`, { cause: finalError });
}

async function grammarPoint(
  buildId: string,
  canonicalURL: string,
): Promise<BunproGrammarPoint> {
  const slug = decodeURIComponent(new URL(canonicalURL).pathname.slice("/grammar_points/".length));
  const encodedSlug = encodeURIComponent(slug);
  const dataURL = `https://bunpro.jp/_next/data/${
    encodeURIComponent(buildId)
  }/en/grammar_points/${encodedSlug}.json?slug=${encodedSlug}`;
  const payload = JSON.parse(await fetchText(dataURL)) as { pageProps?: unknown };
  try {
    return bunproGrammarPointFromPageProps(payload.pageProps, canonicalURL);
  } catch (error) {
    throw new Error(`Failed to parse Bunpro grammar point ${canonicalURL}`, { cause: error });
  }
}

async function loadCache(
  cachePath: string,
  buildId: string,
): Promise<Map<string, BunproGrammarPoint>> {
  let content: string;
  try {
    content = await Deno.readTextFile(cachePath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return new Map();
    throw error;
  }
  return new Map(
    content.trim().split("\n").filter(Boolean).map((line) => {
      const cached = JSON.parse(line) as CachedGrammarPoint;
      return cached.cacheVersion === CACHE_VERSION && cached.buildId === buildId
        ? [cached.url, cached.grammarPoint] as const
        : undefined;
    }).filter((entry): entry is readonly [string, BunproGrammarPoint] => entry !== undefined),
  );
}

console.log("Checking Bunpro's logged-out example payload...");
const sampleHTML = await fetchText(BUNPRO_SAMPLE_GRAMMAR_POINT_URL);
const buildId = bunproBuildIdFromHTML(sampleHTML);
const sample = await grammarPoint(buildId, BUNPRO_SAMPLE_GRAMMAR_POINT_URL);
if (sample.examples.length !== EXPECTED_LOGGED_OUT_SAMPLE_COUNT) {
  throw new Error(
    `Expected ${EXPECTED_LOGGED_OUT_SAMPLE_COUNT} logged-out examples for ${sample.url}, but found ${sample.examples.length}. Authenticated cookies may now be required.`,
  );
}
console.log(`Found all ${sample.examples.length} examples without authentication.`);

const sitemap = await fetchText(BUNPRO_SITEMAP_URL);
const urls = bunproGrammarPointURLsFromSitemap(sitemap);
console.log(`Downloading ${urls.length} grammar points from Bunpro build ${buildId}...`);

const outputPath = resourcePaths.bunproExamples;
const cachePath = `${outputPath}.cache.jsonl`;
await Deno.mkdir(path.dirname(outputPath), { recursive: true });
const cache = await loadCache(cachePath, buildId);
if (cache.size > 0) console.log(`Reusing ${cache.size} cached grammar points.`);
for (let index = 0; index < urls.length; index += CONCURRENCY) {
  const batchURLs = urls.slice(index, index + CONCURRENCY);
  const missingURLs = batchURLs.filter((url) => !cache.has(url));
  const downloaded = await Promise.all(
    missingURLs.map((url) => grammarPoint(buildId, url)),
  );
  if (downloaded.length > 0) {
    const records = downloaded.map((point, downloadedIndex): CachedGrammarPoint => ({
      cacheVersion: CACHE_VERSION,
      buildId,
      url: missingURLs[downloadedIndex],
      grammarPoint: point,
    }));
    await Deno.writeTextFile(
      cachePath,
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      { append: true },
    );
    for (const record of records) cache.set(record.url, record.grammarPoint);
  }
  const processed = Math.min(index + CONCURRENCY, urls.length);
  if (processed % 80 === 0 || processed === urls.length) {
    console.log(`  Processed ${processed}/${urls.length}`);
  }
}
const grammarPoints = urls.map((url) => cache.get(url)!);
grammarPoints.sort((left, right) => left.id - right.id);

const corpus: BunproExampleCorpus = {
  schemaVersion: 1,
  fetchedAt: new Date().toISOString(),
  buildId,
  sourceURL: BUNPRO_SITEMAP_URL,
  grammarPoints,
};
const temporaryPath = `${outputPath}.${crypto.randomUUID()}.download`;
await Deno.writeTextFile(temporaryPath, `${JSON.stringify(corpus, undefined, 2)}\n`);
await Deno.rename(temporaryPath, outputPath);
console.log(
  `Saved ${
    grammarPoints.reduce((sum, point) => sum + point.examples.length, 0)
  } examples to ${outputPath}.`,
);
