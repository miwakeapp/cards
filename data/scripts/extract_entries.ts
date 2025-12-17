import * as path from "@std/path";
import type { JMdict } from "@scriptin/jmdict-simplified-types";

const jmdictFilename = path.resolve(import.meta.dirname!, "../jmdict_eng.json");
const entriesDir = path.resolve(import.meta.dirname!, "../entries");

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

const CARD_CREATOR_EVAL_IDS = new Set([
  "2116100", // 土いじり
  "1497700", // 父方
  "2177740", // 願わくば
  "1207650", // かけがえのない
  "2258260", // ハンダ付け
  "1529950", // 無垢
  "1512230", // 返上
  "1403360", // 増幅
  "1204030", // 外泊
  "1641190", // 目減り
]);

const allTestIds = new Set([...JMDICT_TO_HTML_TEST_IDS, ...CARD_CREATOR_EVAL_IDS]);

console.log(`Looking for ${allTestIds.size} entries...`);

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
