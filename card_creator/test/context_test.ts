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

Deno.test("processContextHTML uses unannotated okurigana to correct incidental ruby", async () => {
  const readings = new Map<string, readonly string[]>([
    ["則る", ["のっとる"]],
    ["突く", ["つつく"]],
  ]);
  const options = {
    resolveRubyReadings: (spelling: string) => Promise.resolve(readings.get(spelling) ?? []),
  };
  // 『辞書を編む』 uses full-size kana in partial ruby; the following particle is not
  // part of the spelling. Correct only what dictionary evidence supports.
  assertEquals(
    await processContextHTML(
      "ルールに<ruby>則<rt>のつと</rt></ruby>ることはもちろんだし、<mark>にこやか</mark>に接する。",
      "にこやか",
      ["にこやか"],
      options,
    ),
    "ルールに 則[のっと]ることはもちろんだし、<mark>にこやか</mark>に接する。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>則<rt>のつと</rt>る</ruby>ことはもちろんだし、<mark>にこやか</mark>に接する。",
      "にこやか",
      ["にこやか"],
      options,
    ),
    "則[のっと]ることはもちろんだし、<mark>にこやか</mark>に接する。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>則<rt>のつと</rt></ruby>った。<mark>にこやか</mark>。",
      "にこやか",
      ["にこやか"],
      options,
    ),
    "則[のつと]った。<mark>にこやか</mark>。",
  );
  assertEquals(
    await processContextHTML(
      "<ruby>突<rt>つつ</rt></ruby>く。<mark>にこやか</mark>。",
      "にこやか",
      ["にこやか"],
      options,
    ),
    "突[つつ]く。<mark>にこやか</mark>。",
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
