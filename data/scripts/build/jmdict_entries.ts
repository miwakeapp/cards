import { emptyDir } from "@std/fs/empty-dir";
import * as path from "@std/path";
import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { resourcePaths } from "../../src/resource_paths.ts";

const dataDir = path.resolve(import.meta.dirname!, "../..");
const jmdictFilename = resourcePaths.jmdict;
const entriesDirectory = resourcePaths.preextractedJMDictEntries;
const snapshotFilename = resourcePaths.jmdictSnapshot;

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
  "1399910", // 搔き集める, search-only kanji spelling
  "1686540", // 種つけ, search-only kanji spelling
  "1049180", // コーヒー
  "1080510", // テレビ
  "1000100", // ＡＢＣ順
  "1000110", // ＣＤプレーヤー
  "2643730", // えんじ色
  "1913350", // やぶ蚊, ambiguous kana-normalized records
]);

// IDs used by card_creator tests
const CARD_CREATOR_TEST_IDS = new Set([
  "1414110", // 大小
  "1209590", // 瓦解
  "1322660", // 社, source ruby is ambiguous between repeated occurrences
  "1416140", // 叩きつける, source ruby on an inflected form
  "1424660", // 中枢, source ruby uses full-size kana
  "1574430", // 餃子, source ruby uses a search-only reading
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

  for await (const entry of Deno.readDir(evalInputsDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      const content = await Deno.readTextFile(path.join(evalInputsDir, entry.name));
      const input = JSON.parse(content) as { jmdictId: string };
      ids.add(input.jmdictId);
    }
  }

  return ids;
}

const evalInputIds = await loadEvalInputIds();

const preextractedIds = new Set([
  ...JMDICT_TO_HTML_TEST_IDS,
  ...FURIGANA_TEST_IDS,
  ...CARD_CREATOR_TEST_IDS,
  ...FEW_SHOT_IDS,
  ...evalInputIds,
]);

console.log(`Looking for ${preextractedIds.size} entries...`);
console.log(`  - jmdict_to_html tests: ${JMDICT_TO_HTML_TEST_IDS.size}`);
console.log(`  - furigana tests: ${FURIGANA_TEST_IDS.size}`);
console.log(`  - card_creator tests: ${CARD_CREATOR_TEST_IDS.size}`);
console.log(`  - few-shot examples: ${FEW_SHOT_IDS.size}`);
console.log(`  - eval inputs: ${evalInputIds.size}`);

const jmdictText = await Deno.readTextFile(jmdictFilename);
const jmdict = JSON.parse(jmdictText) as JMdict;

const words = jmdict.words.filter((word) => preextractedIds.has(word.id));
const foundIds = new Set(words.map((word) => word.id));
if (foundIds.size !== preextractedIds.size) {
  const missing = [...preextractedIds].filter((id) => !foundIds.has(id));
  throw new Error(`Some IDs were not found in JMDict: ${missing.join(", ")}`);
}

await emptyDir(entriesDirectory);
await Promise.all([
  ...words.map((word) => {
    const filename = path.join(entriesDirectory, `${word.id}.json`);
    return Deno.writeTextFile(filename, JSON.stringify(word, undefined, 2) + "\n");
  }),
  Deno.writeTextFile(
    snapshotFilename,
    JSON.stringify(
      {
        source: "https://github.com/scriptin/jmdict-simplified",
        version: jmdict.version,
        dictDate: jmdict.dictDate,
      },
      undefined,
      2,
    ) + "\n",
  ),
]);

console.log(`Extracted ${words.length} entries to ${entriesDirectory}`);
