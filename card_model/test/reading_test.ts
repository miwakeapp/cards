import { assertEquals } from "@std/assert";
import { decorateReadingAlternative, formatReading, parseReading } from "card_model/reading";

Deno.test("formatReading keeps one reading plain and lists multiple readings", () => {
  assertEquals(formatReading(["裏[うら] 面[めん]"]), "裏[うら] 面[めん]");
  assertEquals(
    formatReading(["裏[うら] 面[めん]", "裏[り] 面[めん]"]),
    "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
  );
  assertEquals(
    formatReading(["お 浸[ひた]し", "お 浸[した]し"]),
    "<ul><li>お 浸[ひた]し</li><li>お 浸[した]し</li></ul>",
  );
  assertEquals(
    formatReading(["<字>[じ]&", "<字>[し]&"]),
    "<ul><li>&lt;字&gt;[じ]&amp;</li><li>&lt;字&gt;[し]&amp;</li></ul>",
  );
});

Deno.test("decorateReadingAlternative separates only an initial ruby base", () => {
  assertEquals(
    decorateReadingAlternative("三[ざん] 昧[まい]", "～", ""),
    "～ 三[ざん] 昧[まい]",
  );
  assertEquals(
    decorateReadingAlternative("を 食[た]べる", "～", ""),
    "～を 食[た]べる",
  );
  assertEquals(decorateReadingAlternative("曽[そう]", "", "～"), "曽[そう]～");
});

Deno.test("parseReading handles plain and list representations", () => {
  assertEquals(parseReading("裏[うら] 面[めん]", "裏面"), [
    { formatted: "裏[うら] 面[めん]", kanaReading: "うらめん" },
  ]);
  assertEquals(
    parseReading(
      "<ul><li>裏[うら] 面[めん]</li><li>裏[り] 面[めん]</li></ul>",
      "裏面",
    ),
    [
      { formatted: "裏[うら] 面[めん]", kanaReading: "うらめん" },
      { formatted: "裏[り] 面[めん]", kanaReading: "りめん" },
    ],
  );
});

Deno.test("parseReading preserves HTML entities and internal middle dots", () => {
  assertEquals(parseReading("&lt;字&gt;[じ]&amp;", "&lt;字&gt;&amp;"), [
    { formatted: "<字>[じ]&", kanaReading: "じ&" },
  ]);
  assertEquals(
    parseReading(
      "<ul><li>瓩[キロ・グラム]</li><li>瓩[キログラム]</li></ul>",
      "瓩",
    ),
    [
      { formatted: "瓩[キロ・グラム]", kanaReading: "キロ・グラム" },
      { formatted: "瓩[キログラム]", kanaReading: "キログラム" },
    ],
  );
});

Deno.test("parseReading accepts zero-surface furigana inside a complete spelling", () => {
  assertEquals(parseReading("気[き] [っ] 風[ぷ]", "気風"), [
    { formatted: "気[き] [っ] 風[ぷ]", kanaReading: "きっぷ" },
  ]);
});

Deno.test("parseReading rejects malformed fields and noncanonical HTML", () => {
  assertEquals(parseReading("", "明日"), null);
  assertEquals(parseReading("食[た]べる", "喋る"), null);
  assertEquals(parseReading("食[]べる", "食べる"), null);
  assertEquals(parseReading("<ul><li>明日[あした]</li></ul>", "明日"), null);
  assertEquals(
    parseReading("<ul><li>明日[あした]</li><li>別日[あす]</li></ul>", "明日"),
    null,
  );
  assertEquals(
    parseReading("<ul class=readings><li>明日[あした]</li><li>明日[あす]</li></ul>", "明日"),
    null,
  );
  assertEquals(
    parseReading("<ul><li><b>明日</b>[あした]</li><li>明日[あす]</li></ul>", "明日"),
    null,
  );
});
