/**
 * JMDict entry IDs used by `card_creator`'s `formatReadingForAnki()` tests.
 *
 * These entries also determine which upstream placement records belong in the compact furigana
 * fixture.
 */
export const FURIGANA_TEST_IDS: ReadonlySet<string> = new Set([
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
  "1032910", // ＯＢ, JMDict reading includes a separator omitted by Lorenzi
  "1427810", // 張子のトラ, literal kana differs in script from JMDict reading
  "2195830", // ドン引き, canonical and search-only readings differ in kana script
  "2238240", // アクの強い, literal kana differs in script from JMDict reading
]);

/**
 * JMDict entry IDs used by `card_creator` tests.
 *
 * `createCard()` formats the reading for many of these entries, so their upstream placement
 * records also belong in the compact furigana fixture.
 */
export const CARD_CREATOR_TEST_IDS: ReadonlySet<string> = new Set([
  "1000110", // ＣＤプレーヤー, non-Han furigana
  "1006690", // そこそこ, sense-specific suffix usage
  "1158110", // 異名, reading restrictions
  "1205330", // 恰好悪い, intentionally missing furigana placement data
  "1207650", // かけがえのない, kana-only context behavior
  "1209590", // 瓦解
  "1217700", // 頑張る, multiple marked inflections
  "1225260", // まがい, polyfunctional noun/suffix sense
  "1311110", // 私, search-only reading with unambiguous one-kanji furigana
  "1322660", // 社, single-kanji furigana fallback
  "1414110", // 大小
  "1416140", // 叩きつける, source ruby on an inflected form
  "1424660", // 中枢, source ruby uses full-size kana
  "1447690", // 東京, partial source ruby
  "1486050", // 微塵, source ebook uses adjacent ruby elements
  "1504680", // 焚き火, source ebook partially annotates the spelling
  "1533460", // 面子, source ruby uses hiragana for a katakana reading
  "1574430", // 餃子, complex multi-component source ruby
  "1576750", // 黄昏, whole-spelling gikun fallback
  "1580650", // 人人, source ruby on a repeated base
  "1581200", // 曽, prefix
  "1632080", // 炬, gikun fallback
  "1855690", // 等々, suffix notation before multi-kanji furigana
  "2013080", // 歿する, reading and sense restrictions
  "2077160", // 艘, counter
  "2434300", // 潔癖症, source ebook uses full-size kana in partial ruby
]);

/**
 * JMDict entry IDs used by Animecards converter integration tests which reach `createCard()`.
 *
 * These tests exercise the complete conversion boundary, so their upstream placement records
 * belong in the furigana fixture just as the direct `card_creator` test records do.
 */
export const ANIMECARDS_CONVERTER_TEST_IDS: ReadonlySet<string> = new Set([
  "1313600", // 事もなげに
  "1565480", // 嗅ぐ
  "1597200", // 頼る
  "2188630", // 見当もつかない
  "2548280", // のしのしと歩く
]);

/** Entry IDs whose placement records are copied into `test/fixtures/jmdict_furigana.json`. */
export const FURIGANA_FIXTURE_IDS: ReadonlySet<string> = new Set([
  ...FURIGANA_TEST_IDS,
  ...CARD_CREATOR_TEST_IDS,
  ...ANIMECARDS_CONVERTER_TEST_IDS,
]);
