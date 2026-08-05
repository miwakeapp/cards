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
      ["だいしょう"],
      { resolveRubyReadings: (spelling) => Promise.resolve(readings.get(spelling) ?? []) },
    ),
    "容[よう] 赦[しゃ]なく<mark>大小</mark>を見る。",
  );
});

Deno.test("processContextHTML accepts marked ruby matching any accepted reading", async () => {
  assertEquals(
    await processContextHTML(
      "明日は<mark><ruby>明日<rt>あす</rt></ruby></mark>にしよう。",
      "明日",
      ["あした", "あす"],
    ),
    "明日は<mark>明日[あす]</mark>にしよう。",
  );
});

Deno.test("processContextHTML precisely places the matching accepted reading", async () => {
  assertEquals(
    await processContextHTML(
      "<mark><ruby>大人<rt>だいじん</rt></ruby></mark>らしく振る舞う。",
      "大人",
      ["おとな", "だいじん"],
      {
        formattedTargetReadings: new Map([
          ["おとな", "大人[おとな]"],
          ["だいじん", "大[だい] 人[じん]"],
        ]),
      },
    ),
    "<mark>大[だい] 人[じん]</mark>らしく振る舞う。",
  );
});

Deno.test("processContextHTML corrects split compound ruby using the compound's reading", async () => {
  const readings = new Map<string, readonly string[]>([
    ["無慮", ["むりょ"]],
    ["貸家", ["かしや", "かしいえ"]],
  ]);
  const resolveReadings = (spelling: string) => Promise.resolve(readings.get(spelling) ?? []);

  assertEquals(
    await processContextHTML(
      "<ruby>無<rt>む</rt>慮<rt>りよ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      ["だいしょう"],
      { resolveRubyReadings: resolveReadings },
    ),
    "無[む] 慮[りょ]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>貸<rt>か</rt>家<rt>しや</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      ["だいしょう"],
      { resolveRubyReadings: resolveReadings },
    ),
    "貸[か] 家[しや]の<mark>大小</mark>を見る。",
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
      ["だいしょう"],
      { resolveRubyReadings: (spelling) => Promise.resolve(readings.get(spelling) ?? []) },
    ),
    "貸家[かしや]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>松田<rt>マツダ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      ["だいしょう"],
      { resolveRubyReadings: (spelling) => Promise.resolve(readings.get(spelling) ?? []) },
    ),
    "松田[マツダ]の<mark>大小</mark>を見る。",
  );
});

Deno.test("processContextHTML corrects foreign and explanatory unmarked ruby", async () => {
  assertEquals(
    await processContextHTML(
      "<ruby>さや<rt>ポツド</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      ["だいしょう"],
      { resolveRubyReadings: () => Promise.resolve([]) },
    ),
    "さや[ポッド]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>貨物輸送用鳥足<rt>チキンレツグ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      ["だいしょう"],
      { resolveRubyReadings: () => Promise.resolve([]) },
    ),
    "貨物輸送用鳥足[チキンレッグ]の<mark>大小</mark>を見る。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>賢い消費者<rt>スマート・コンシユーマ</rt></ruby>の<mark>大小</mark>を見る。",
      "大小",
      ["だいしょう"],
      { resolveRubyReadings: () => Promise.resolve([]) },
    ),
    "賢い消費者[スマート・コンシューマ]の<mark>大小</mark>を見る。",
  );
});
