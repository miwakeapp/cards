import { assert, assertEquals, assertThrows } from "@std/assert";
import { iso6392 } from "iso-639-2";

import { resolveJMDictLanguage } from "../src/jmdict_language.ts";

Deno.test("resolveJMDictLanguage maps representative ISO 639-2/B codes", () => {
  const cases = [
    ["eng", { bcp47Tag: "en", englishName: "English" }],
    ["ger", { bcp47Tag: "de", englishName: "German" }],
    ["chi", { bcp47Tag: "zh", englishName: "Chinese" }],
    ["ain", { bcp47Tag: "ain", englishName: "Ainu" }],
    ["haw", { bcp47Tag: "haw", englishName: "Hawaiian" }],
    ["div", { bcp47Tag: "dv", englishName: "Divehi" }],
    ["kir", { bcp47Tag: "ky", englishName: "Kyrgyz" }],
    ["mao", { bcp47Tag: "mi", englishName: "Māori" }],
    ["sot", { bcp47Tag: "st", englishName: "Southern Sotho" }],
    ["tgl", { bcp47Tag: "tl", englishName: "Filipino" }],
  ] as const;

  for (const [code, expected] of cases) {
    assertEquals(resolveJMDictLanguage(code), expected);
  }
});

Deno.test("resolveJMDictLanguage maps every current ISO 639-2/B code", () => {
  for (const language of iso6392.filter(({ iso6392B }) => /^[a-z]{3}$/u.test(iso6392B))) {
    const resolved = resolveJMDictLanguage(language.iso6392B);
    assertEquals(
      resolved.bcp47Tag,
      language.iso6391 ?? language.iso6392T ?? language.iso6392B,
    );
    assert(resolved.englishName.length > 0);
  }
});

Deno.test("resolveJMDictLanguage maps JMDict's withdrawn Croatian code", () => {
  assertEquals(resolveJMDictLanguage("scr"), {
    bcp47Tag: "hr",
    englishName: "Croatian",
  });
});

Deno.test("resolveJMDictLanguage rejects codes outside JMDict's input contract", () => {
  for (const code of ["", "en", "deu", "ENG", "qaa-qtz", "scc", "not-a-language"]) {
    assertThrows(
      () => resolveJMDictLanguage(code),
      TypeError,
      `Unsupported JMDict ISO 639-2/B language source code: ${JSON.stringify(code)}`,
    );
  }
});
