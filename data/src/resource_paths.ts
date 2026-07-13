import { join, resolve } from "@std/path";

const packageDirectory = resolve(import.meta.dirname!, "..");
const generatedDirectory = join(packageDirectory, "generated");
const jmdictResourcesDirectory = join(packageDirectory, "resources", "jmdict");

// Tests substitute only the compact checked furigana fixture; all other data remains canonical.
export const resourcePaths = {
  jmdict: join(generatedDirectory, "jmdict_eng.json"),
  jmdictFurigana: join(generatedDirectory, "jmdict_furigana.json"),
  rarityDatabase: join(generatedDirectory, "rarity.sqlite3"),
  nwjcSurface1Gram: join(generatedDirectory, "nwjc", "NWJC-surface-1gram.txt"),
  bccwjLUW2: join(
    generatedDirectory,
    "bccwj",
    "BCCWJ_frequencylist_luw2_ver1_1.tsv",
  ),
  jmdictTags: join(jmdictResourcesDirectory, "tags.json"),
  jmdictSnapshot: join(jmdictResourcesDirectory, "snapshot.json"),
  preextractedJMDictEntries: join(jmdictResourcesDirectory, "entries"),
};
