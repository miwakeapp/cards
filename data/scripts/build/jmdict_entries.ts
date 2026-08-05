import { emptyDir } from "@std/fs/empty-dir";
import * as path from "@std/path";
import type { JMdict } from "@scriptin/jmdict-simplified-types";
import { resourcePaths } from "../../src/resource_paths.ts";
import {
  ANIMECARDS_CONVERTER_TEST_IDS,
  CARD_CREATOR_TEST_IDS,
  FURIGANA_TEST_IDS,
} from "./jmdict_test_fixture_ids.ts";

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
  "1080510", // テレビ, program/programme glosses
  "1375040", // 勢い, vigor/vigour glosses
  "1424660", // 中心, center/centre glosses
  "1485470", // 飛行機, airplane/aeroplane glosses
  "1495000", // 下手, several British/American gloss pairs
  "1496680", // 婦人科, gynecology/gynaecology glosses
  "1533460", // 面子, honor/honour glosses
  "1584090", // 抱く, harbor/harbour glosses
]);

// IDs used by the shared Miwake Cards preview fixtures.
const MIWAKE_CARDS_PREVIEW_FIXTURE_IDS = new Set([
  "1000100", // ＡＢＣ順, full-width Latin ruby
  "1000230", // あかん, dialect + variants
  "1014630", // アウター, antonym + abbreviation
  "1061000", // シノニム, related references
  "1122910", // ホルモン, language source + dialect
  "1158110", // 異名, reading restrictions
  "1178920", // 於いて, search-only forms
  "1211360", // 堪忍袋の緒が切れる, long mixed-furigana wrapping
  "1358280", // 食べる, short ruby baseline
  "1414110", // 大小, many senses
  "1574430", // 餃子, multi-component source ruby
  "1590470", // 画期的, multiple forms
  "1591900", // 綺麗, card template interactions
  "1604990", // 目にあう, many written forms
  "1632080", // 松明, whole-word gikun
  "1855690", // 等々, suffix marker + repetition
  "2013080", // 没する, form restrictions + verb types
  "2030540", // 狂喜乱舞, simple dense compound
  "2228700", // 彼岸桜, shared tags
  "2861582", // トスアップ, shared field + language source
]);

// Load the generated consumer manifest without teaching this foundational package the eval schema
// or requiring the consumer package to exist in order to rebuild data resources.
async function loadCardFieldGenerationEvalIds(): Promise<Set<string>> {
  const manifestPath = path.resolve(
    dataDir,
    "resources/jmdict/card_field_generation_eval_entry_ids.json",
  );
  const value: unknown = JSON.parse(await Deno.readTextFile(manifestPath));
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== "string" || !/^\d+$/u.test(id)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${manifestPath} must contain unique decimal-string JMDict IDs`);
  }
  return new Set(value);
}

const cardFieldGenerationEvalIds = await loadCardFieldGenerationEvalIds();

const preextractedIds = new Set([
  ...JMDICT_TO_HTML_TEST_IDS,
  ...FURIGANA_TEST_IDS,
  ...CARD_CREATOR_TEST_IDS,
  ...MIWAKE_CARDS_PREVIEW_FIXTURE_IDS,
  ...ANIMECARDS_CONVERTER_TEST_IDS,
  ...cardFieldGenerationEvalIds,
]);

console.log(`Looking for ${preextractedIds.size} entries...`);
console.log(`  - jmdict_to_html tests: ${JMDICT_TO_HTML_TEST_IDS.size}`);
console.log(`  - furigana tests: ${FURIGANA_TEST_IDS.size}`);
console.log(`  - card_creator tests: ${CARD_CREATOR_TEST_IDS.size}`);
console.log(`  - Miwake Cards preview fixtures: ${MIWAKE_CARDS_PREVIEW_FIXTURE_IDS.size}`);
console.log(`  - Animecards converter tests: ${ANIMECARDS_CONVERTER_TEST_IDS.size}`);
console.log(`  - card-field generation eval inputs: ${cardFieldGenerationEvalIds.size}`);

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
