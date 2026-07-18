import type { SourceFieldMapping } from "./types.ts";

export interface SourceFieldOverrides {
  word?: string;
  sentence?: string;
  glossary?: string;
  reading?: string;
  source?: string;
  sourceURL?: string;
}

const FIELD_ALIASES = {
  word: ["Word", "Expression", "Recognition target"],
  sentence: ["Sentence", "Context"],
  glossary: ["Glossary", "Definition", "Definitions"],
  reading: ["Reading"],
  source: ["Source"],
  sourceURL: ["Source URL", "SourceURL"],
} as const;

function findField(
  availableFields: string[],
  requestedName: string | undefined,
  aliases: readonly string[],
  required: boolean,
  role: string,
): string | null {
  const lookup = new Map(availableFields.map((name) => [name.toLocaleLowerCase(), name]));
  if (requestedName !== undefined) {
    const exact = lookup.get(requestedName.toLocaleLowerCase());
    if (exact === undefined) {
      throw new Error(
        `The ${role} field "${requestedName}" does not exist. Available fields: ${
          availableFields.join(", ")
        }`,
      );
    }
    return exact;
  }

  for (const alias of aliases) {
    const match = lookup.get(alias.toLocaleLowerCase());
    if (match !== undefined) {
      return match;
    }
  }

  if (required) {
    throw new Error(
      `Could not identify the ${role} field. Pass --${role}-field=NAME. Available fields: ${
        availableFields.join(", ")
      }`,
    );
  }
  return null;
}

/** Resolves common Animecards field names while supporting explicit overrides. */
export function resolveSourceFields(
  availableFields: string[],
  overrides: SourceFieldOverrides = {},
): SourceFieldMapping {
  return {
    word: findField(availableFields, overrides.word, FIELD_ALIASES.word, true, "word")!,
    sentence: findField(
      availableFields,
      overrides.sentence,
      FIELD_ALIASES.sentence,
      true,
      "sentence",
    )!,
    glossary: findField(
      availableFields,
      overrides.glossary,
      FIELD_ALIASES.glossary,
      false,
      "glossary",
    ),
    reading: findField(
      availableFields,
      overrides.reading,
      FIELD_ALIASES.reading,
      false,
      "reading",
    ),
    source: findField(
      availableFields,
      overrides.source,
      FIELD_ALIASES.source,
      false,
      "source",
    ),
    sourceURL: findField(
      availableFields,
      overrides.sourceURL,
      FIELD_ALIASES.sourceURL,
      false,
      "source-url",
    ),
  };
}
