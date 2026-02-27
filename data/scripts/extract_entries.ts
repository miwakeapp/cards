import * as path from "@std/path";
import type { JMdict } from "@scriptin/jmdict-simplified-types";

const dataDir = path.resolve(import.meta.dirname!, "..");
const jmdictFilename = path.join(dataDir, "jmdict_eng.json");
const entriesDir = path.join(dataDir, "entries");

// IDs used by jmdict_to_html tests
const JMDICT_TO_HTML_TEST_IDS = new Set([
  "2030540", // 狂喜乱舞, simple entry
  "1414110", // 大小, one reading, multiple senses, per-sense tags
  "1590470", // 画期的, multiple readings, one sense
  "1000230", // あかん, dialect + misc/info
  "1014630", // アウター, antonyms + abbr sense
  "1061000", // シノニム, related sense references + fields
  "1122910", // ホルモン, language source + dialect sense
  "1158110", // 異名, reading restrictions + fields
  "1632080", // 松明, gikun + kanji tags
  "2013080", // 没する, applies-to restrictions + vt/vi mix
  "1178920", // 於いて, shared info + related sense references
  "2228700", // 彼岸桜, shared related tags + mixed misc
  "2861582", // トスアップ, shared field + language source
  "1604990", // 目にあう, lots of forms
]);

// IDs used by jmdict_to_html formatReadingForAnki tests
const FURIGANA_TEST_IDS = new Set([
  "2252350", // 大人買い
  "1217700", // 頑張る
  "1358280", // 食べる
  "1402540", // 走る
  "1464530", // 日本語
  "1447690", // 東京
  "1485470", // 飛行機
  "1361590", // 新幹線
  "1370420", // 図書館
  "1413260", // 大学生
  "1591900", // きれい
  "1374550", // すごい
  "1049180", // コーヒー
  "1080510", // テレビ
  "1000100", // ＡＢＣ順
  "1000110", // ＣＤプレーヤー
]);

// IDs used by card_creator few-shot examples
const FEW_SHOT_IDS = new Set([
  "1497700", // 父方
  "1529950", // 無垢
  "1512230", // 返上
  "1403360", // 増幅
  "2258260", // ハンダ付け
  "2007360", // 後ろめたい
]);

// Dynamically load IDs from card_creator eval inputs
async function loadEvalInputIds(): Promise<Set<string>> {
  const evalInputsDir = path.resolve(dataDir, "../card_creator_evals/inputs");
  const ids = new Set<string>();

  try {
    for await (const entry of Deno.readDir(evalInputsDir)) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        const content = await Deno.readTextFile(path.join(evalInputsDir, entry.name));
        const input = JSON.parse(content) as { jmdictId: string };
        ids.add(input.jmdictId);
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
    console.warn("No eval inputs directory found, skipping eval input IDs");
  }

  return ids;
}

const evalInputIds = await loadEvalInputIds();

const allTestIds = new Set([
  ...JMDICT_TO_HTML_TEST_IDS,
  ...FURIGANA_TEST_IDS,
  ...FEW_SHOT_IDS,
  ...evalInputIds,
]);

console.log(`Looking for ${allTestIds.size} entries...`);
console.log(`  - jmdict_to_html tests: ${JMDICT_TO_HTML_TEST_IDS.size}`);
console.log(`  - furigana tests: ${FURIGANA_TEST_IDS.size}`);
console.log(`  - few-shot examples: ${FEW_SHOT_IDS.size}`);
console.log(`  - eval inputs: ${evalInputIds.size}`);

const jmdictText = await Deno.readTextFile(jmdictFilename);
const jmdict = JSON.parse(jmdictText) as JMdict;

// Ensure output directory exists
await Deno.mkdir(entriesDir, { recursive: true });

const promises: Promise<void>[] = [];
const foundIds = new Set<string>();

for (const word of jmdict.words) {
  if (allTestIds.has(word.id)) {
    const filename = path.resolve(entriesDir, `${word.id}.json`);
    const contents = JSON.stringify(word, undefined, 2) + "\n";
    promises.push(Deno.writeTextFile(filename, contents));
    foundIds.add(word.id);
  }
}

await Promise.all(promises);

if (foundIds.size !== allTestIds.size) {
  const missing = [...allTestIds].filter((id) => !foundIds.has(id));
  console.error(`Some IDs were not found in JMdict: ${missing.join(", ")}`);
  Deno.exit(1);
}

console.log(`Extracted ${foundIds.size} entries to ${entriesDir}`);
