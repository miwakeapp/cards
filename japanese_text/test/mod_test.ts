import { assertEquals } from "@std/assert";
import { toHiragana } from "japanese_text";

Deno.test("toHiragana converts katakana without changing the original orthography otherwise", () => {
  assertEquals(toHiragana("面子メンツ・ゲームー"), "面子めんつ・げーむー");
});
