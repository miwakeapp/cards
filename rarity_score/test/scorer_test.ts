import { assertAlmostEquals, assertEquals, assertStrictEquals } from "@std/assert";
import { type RarityLookup, scoreRecognitionTargetWithLookup } from "../src/scorer.ts";

const TEST_NWJC_TOKEN_TOTAL = 1_000_000;

Deno.test("cleans recognition-target HTML without treating escaped text as markup", async () => {
  const seenTargets: string[] = [];
  const lookup: RarityLookup = {
    nwjcSurface1Gram: (target) => {
      seenTargets.push(target);
      return Promise.resolve(null);
    },
    bccwjLUW2Lemma: () => Promise.resolve(null),
  };

  await scoreRecognitionTargetWithLookup("<b>身&nbsp;内</b>", lookup);
  await scoreRecognitionTargetWithLookup("&lt;b&gt;", lookup);
  await scoreRecognitionTargetWithLookup("&amp;lt;", lookup);
  assertEquals(seenTargets, ["身\u00a0内", "<b>", "&lt;"]);
});

Deno.test("uses NWJC when it supplies stronger evidence of commonness", async () => {
  const lookup: RarityLookup = {
    nwjcSurface1Gram: (target) => {
      assertStrictEquals(target, "身 内");
      return Promise.resolve({ count: 398, tokenTotal: TEST_NWJC_TOKEN_TOTAL });
    },
    bccwjLUW2Lemma: () => Promise.resolve({ totalPMW: 0.001 }),
  };

  const rarity = await scoreRecognitionTargetWithLookup("<b>身 内</b>", lookup);
  assertAlmostEquals(rarity!, 11.251461599078905);
});

Deno.test("uses BCCWJ when it supplies stronger evidence despite an NWJC hit", async () => {
  const lookup: RarityLookup = {
    nwjcSurface1Gram: () => Promise.resolve({ count: 1, tokenTotal: 1_000_000_000 }),
    bccwjLUW2Lemma: () => Promise.resolve({ totalPMW: 10 }),
  };

  assertAlmostEquals((await scoreRecognitionTargetWithLookup("一度", lookup))!, 31.25);
});

Deno.test("converts BCCWJ PMW frequency when NWJC misses", async () => {
  const lookup: RarityLookup = {
    nwjcSurface1Gram: () => Promise.resolve(null),
    bccwjLUW2Lemma: (target) => {
      assertStrictEquals(target, "玄妙");
      return Promise.resolve({ totalPMW: 0.024 });
    },
  };

  const rarity = await scoreRecognitionTargetWithLookup("玄妙", lookup);
  assertAlmostEquals(rarity!, 63.99735947860492);
});

Deno.test("score anchors and clamping are stable", async () => {
  assertAlmostEquals(await scoreBCCWJZipf(6.5), 0);
  assertAlmostEquals(await scoreBCCWJZipf(-1.5), 100);
  assertAlmostEquals(await scoreBCCWJZipf(8), 0);
  assertAlmostEquals(await scoreBCCWJZipf(-3), 100);
});

Deno.test("returns null rarity when no source matches", async () => {
  const lookup: RarityLookup = {
    nwjcSurface1Gram: () => Promise.resolve(null),
    bccwjLUW2Lemma: () => Promise.resolve(null),
  };

  assertStrictEquals(await scoreRecognitionTargetWithLookup("not-in-fixture", lookup), null);
});

Deno.test("returns null rarity for an empty target without querying sources", async () => {
  const lookup: RarityLookup = {
    nwjcSurface1Gram: () => {
      throw new Error("NWJC should not be queried for an empty target");
    },
    bccwjLUW2Lemma: () => {
      throw new Error("BCCWJ should not be queried for an empty target");
    },
  };

  assertStrictEquals(await scoreRecognitionTargetWithLookup(" <b> </b> ", lookup), null);
});

async function scoreBCCWJZipf(zipf: number): Promise<number> {
  const lookup: RarityLookup = {
    nwjcSurface1Gram: () => Promise.resolve(null),
    bccwjLUW2Lemma: () => Promise.resolve({ totalPMW: 10 ** zipf / 1_000 }),
  };
  return (await scoreRecognitionTargetWithLookup("target", lookup))!;
}
