import { assertEquals } from "@std/assert";
import { furiganaToRuby } from "../src/anki_furigana.ts";

Deno.test("furiganaToRuby renders adjacent Anki annotations without control spaces", () => {
  assertEquals(
    furiganaToRuby("餃[ぎょう] 子[ざ]"),
    "<ruby>餃<rt>ぎょう</rt></ruby><ruby>子<rt>ざ</rt></ruby>",
  );
  assertEquals(
    furiganaToRuby("食べ[たべ]る"),
    "<ruby>食べ<rt>たべ</rt></ruby>る",
  );
});

Deno.test("furiganaToRuby preserves escaped text and non-reading brackets", () => {
  assertEquals(furiganaToRuby("説明[補足]"), "説明[補足]");
  assertEquals(furiganaToRuby("&lt; 猫[ねこ]&gt;"), "&lt;<ruby>猫<rt>ねこ</rt></ruby>&gt;");
});
