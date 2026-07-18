import { iso6392, type Language as ISO6392Language } from "iso-639-2";

/** Language metadata suitable for rendering a JMDict loanword source in HTML. */
export interface JMDictLanguage {
  /** The canonical primary-language subtag to use in an HTML `lang` attribute. */
  readonly bcp47Tag: string;
  /** An English display name for the language. */
  readonly englishName: string;
}

const ENGLISH_LANGUAGE_DISPLAY_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none",
});

function languageMetadata(language: ISO6392Language): JMDictLanguage {
  // RFC 5646 uses the ISO 639-1 code when one exists. Otherwise it uses
  // the terminology code when the ISO 639-2/B and ISO 639-2/T codes differ.
  const bcp47Tag = language.iso6391 ?? language.iso6392T ?? language.iso6392B;

  // CLDR's display names are generally better UI labels than ISO 639-2's catalog names:
  // `mi` becomes “Māori” instead of “Maori”, `ky` becomes “Kyrgyz” instead of
  // “Kirghiz; Kyrgyz”, and `st` becomes “Southern Sotho” instead of “Sotho, Southern”.
  // Some valid tags, including `ain`, are absent from the runtime's locale data, so the
  // ISO name remains a necessary deterministic fallback.
  return Object.freeze({
    bcp47Tag,
    englishName: ENGLISH_LANGUAGE_DISPLAY_NAMES.of(bcp47Tag) ?? language.name,
  });
}

const JMDICT_LANGUAGE_RECORDS = [
  ...iso6392
    // `qaa-qtz` is an ISO 639-2 reserved range, not a code JMDict can use or a BCP 47 tag.
    .filter((language) => /^[a-z]{3}$/u.test(language.iso6392B)),
  // JMDict still contains `scr`, an ISO 639-2/B code withdrawn in favor of `hrv` in 2008.
  { name: "Croatian", iso6392B: "scr", iso6392T: "hrv", iso6391: "hr" },
] satisfies ISO6392Language[];

const LANGUAGES_BY_JMDICT_CODE = new Map<string, JMDictLanguage>(
  JMDICT_LANGUAGE_RECORDS.map((language) => [
    language.iso6392B,
    languageMetadata(language),
  ]),
);

/** Resolves JMDict's ISO 639-2/B source-language code to deterministic HTML metadata. */
export function resolveJMDictLanguage(code: string): JMDictLanguage {
  const language = LANGUAGES_BY_JMDICT_CODE.get(code);
  if (language === undefined) {
    throw new TypeError(
      `Unsupported JMDict ISO 639-2/B language source code: ${JSON.stringify(code)}`,
    );
  }
  return language;
}
