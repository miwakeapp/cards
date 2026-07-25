import { assertEquals } from "@std/assert";
import { processContextHTML } from "../src/context.ts";

Deno.test("processContextHTML corrects unmarked full-size kana using JMDict readings", async () => {
  const readings = new Map<string, readonly string[]>([
    ["赦", ["しゃ"]],
  ]);

  assertEquals(
    await processContextHTML(
      "<ruby>容<rt>よう</rt>赦<rt>しや</rt></ruby>なく<mark>大小</mark>を見る。",
      "大小",
      "だいしょう",
      (spelling) => Promise.resolve(readings.get(spelling) ?? []),
    ),
    "容[よう] 赦[しゃ]なく<mark>大小</mark>を見る。",
  );
});

Deno.test("processContextHTML preserves dictionary readings with genuine full-size kana", async () => {
  const readings = new Map<string, readonly string[]>([
    ["貸家", ["かしや", "かしいえ"]],
    ["松田", ["まつだ"]],
  ]);

  assertEquals(
    await processContextHTML(
      "<ruby>貸家<rt>かしや</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      "だいしょう",
      (spelling) => Promise.resolve(readings.get(spelling) ?? []),
    ),
    "貸家[かしや]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>松田<rt>マツダ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      "だいしょう",
      (spelling) => Promise.resolve(readings.get(spelling) ?? []),
    ),
    "松田[マツダ]の<mark>大小</mark>を見る。",
  );
});

Deno.test("processContextHTML corrects foreign and explanatory unmarked ruby", async () => {
  assertEquals(
    await processContextHTML(
      "<ruby>さや<rt>ポツド</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      "だいしょう",
      () => Promise.resolve([]),
    ),
    "さや[ポッド]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>貨物輸送用鳥足<rt>チキンレツグ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      "だいしょう",
      () => Promise.resolve([]),
    ),
    "貨物輸送用鳥足[チキンレッグ]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>賢い消費者<rt>スマート・コンシユーマ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      "だいしょう",
      () => Promise.resolve([]),
    ),
    "賢い消費者[スマート・コンシューマ]の<mark>大小</mark>を見る。",
  );
});
