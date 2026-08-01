import { assertEquals } from "@std/assert";
import { ankiFuriganaToSurface } from "../src/anki_furigana.ts";

Deno.test("ankiFuriganaToSurface projects one annotation to visible text", () => {
  assertEquals(ankiFuriganaToSurface("揺蕩[たゆた]いながら"), "揺蕩いながら");
  assertEquals(ankiFuriganaToSurface("食べ[たべ]る"), "食べる");
});

Deno.test("ankiFuriganaToSurface removes control spaces between annotations", () => {
  assertEquals(ankiFuriganaToSurface("餃[ぎょう] 子[ざ]"), "餃子");
  assertEquals(ankiFuriganaToSurface("青い 瞳[ひとみ]"), "青い瞳");
});

Deno.test("ankiFuriganaToSurface preserves ordinary bracketed prose", () => {
  assertEquals(ankiFuriganaToSurface("説明[補足]"), "説明[補足]");
  assertEquals(ankiFuriganaToSurface("array[index]"), "array[index]");
  assertEquals(ankiFuriganaToSurface("［補足］"), "［補足］");
});
