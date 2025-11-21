import type {
  JMdictKana,
  JMdictKanji,
  JMdictLanguageSource,
  JMdictSense,
  JMdictWord,
  Tag,
} from "@scriptin/jmdict-simplified-types";
import { escape } from "@std/html";
import { equal } from "@std/assert";

import {
  field as expandField,
  misc as expandMisc,
  partOfSpeech as expandPartOfSpeech,
  tag as expandTag,
} from "./jmdict_tag_expansions.mts";

type SectionDescriptor = {
  className: string;
  tag?: "ul" | "ol";
  getItems(sense: JMdictSense): string[];
};

const SECTION_DESCRIPTORS: SectionDescriptor[] = [
  {
    className: "applies-to kanji",
    getItems: (sense) =>
      filterSpecificValues(sense.appliesToKanji).map((text) =>
        `<li>${renderJapaneseSpan(text)}</li>`
      ),
  },
  {
    className: "applies-to kana",
    getItems: (sense) =>
      filterSpecificValues(sense.appliesToKana).map((text) =>
        `<li>${renderJapaneseSpan(text)}</li>`
      ),
  },
  {
    className: "field",
    getItems: (sense) =>
      sense.field.map((tag) => `<li class="${tag}">${escape(expandField(tag as Tag))}</li>`),
  },
  {
    className: "dialect",
    getItems: (sense) =>
      sense.dialect.map((tag) => `<li class="${tag}">${escape(expandTag(tag as Tag))}</li>`),
  },
  {
    className: "related",
    getItems: (sense) => sense.related.map((entry) => renderReference(entry)),
  },
  {
    className: "antonyms",
    getItems: (sense) => sense.antonym.map((entry) => renderReference(entry)),
  },
  {
    className: "misc",
    getItems: (sense) =>
      sense.misc.map((tag) =>
        `<li class="${tag}">${wrapJapaneseText(expandMisc(tag as Tag))}</li>`
      ),
  },
  {
    className: "info",
    getItems: (sense) =>
      sense.info.filter(Boolean).map((text) => `<li>${wrapJapaneseText(text)}</li>`),
  },
  {
    className: "language-source",
    getItems: (sense) => sense.languageSource.map((source) => renderLanguageSource(source)),
  },
];

type SectionComputation = {
  descriptor: SectionDescriptor;
  perSenseItems: string[][];
  shared: boolean;
};

export default function jmdictWordToHTML(word: JMdictWord): string {
  const senses = word.sense;
  const sharedParts = computeSharedPartOfSpeech(senses);
  const sharedSet = new Set(sharedParts);
  const sections: string[] = [];

  if (sharedParts.length > 0) {
    const items = sharedParts.map((tag) => renderPartOfSpeechItem(tag));
    sections.push(renderList("ul", "part-of-speech", items));
  }

  const sectionComputations = computeSectionComputations(senses);

  for (const result of sectionComputations) {
    if (result.shared && result.perSenseItems[0]?.length) {
      sections.push(
        renderList(
          result.descriptor.tag ?? "ul",
          result.descriptor.className,
          result.perSenseItems[0],
        ),
      );
    }
  }

  const senseItems = senses.map((sense, index) =>
    renderSense(sense, sharedSet, sectionComputations, index)
  );
  if (senseItems.length > 0) {
    sections.push(renderList("ol", "senses", senseItems));
  }

  const kanjiSection = renderForms(word.kanji, "kanji");
  if (kanjiSection) {
    sections.push(kanjiSection);
  }

  const kanaSection = renderForms(word.kana, "kana");
  if (kanaSection) {
    sections.push(kanaSection);
  }

  return sections.filter(Boolean).join("\n");
}

function computeSharedPartOfSpeech(senses: JMdictSense[]): string[] {
  if (senses.length === 0) {
    return [];
  }

  const [first, ...rest] = senses;
  const initial = new Set(first.partOfSpeech);

  for (const sense of rest) {
    const tags = new Set(sense.partOfSpeech);
    for (const value of [...initial]) {
      if (!tags.has(value)) {
        initial.delete(value);
      }
    }
    if (initial.size === 0) {
      break;
    }
  }

  return first.partOfSpeech.filter((tag) => initial.has(tag));
}

function renderSense(
  sense: JMdictSense,
  sharedSet: Set<string>,
  sectionComputations: SectionComputation[],
  senseIndex: number,
): string {
  const blocks: string[] = [];
  const partTags = sense.partOfSpeech.filter((tag) => !sharedSet.has(tag));
  if (partTags.length > 0) {
    const items = partTags.map((tag) => renderPartOfSpeechItem(tag));
    blocks.push(renderList("ul", "part-of-speech", items));
  }

  for (const computation of sectionComputations) {
    if (computation.shared) {
      continue;
    }
    const items = computation.perSenseItems[senseIndex];
    if (items.length > 0) {
      blocks.push(
        renderList(computation.descriptor.tag ?? "ul", computation.descriptor.className, items),
      );
    }
  }

  const glosses = sense.gloss;
  if (glosses.length > 0) {
    const items = glosses.map((gloss) => `<li>${escape(gloss.text)}</li>`);
    blocks.push(renderList("ul", "glosses", items));
  }

  const content = blocks.map((block) => indentBlock(block, 1)).join("\n");
  if (!content) {
    return "<li></li>";
  }
  return `<li>\n${content}\n</li>`;
}

function renderForms(forms: Array<JMdictKanji | JMdictKana>, kind: "kanji" | "kana"): string {
  if (forms.length === 0) {
    return "";
  }

  const items = forms.map((form) => renderFormItem(form));
  return renderList("ul", `forms ${kind}`, items);
}

function renderFormItem(form: JMdictKanji | JMdictKana): string {
  const classNames: string[] = [];
  const tags = form.tags;
  if (form.common) {
    classNames.push("common");
  }
  for (const tag of tags) {
    classNames.push(`tag-${tag}`);
  }
  const classAttr = classNames.length > 0 ? ` class="${classNames.join(" ")}"` : "";
  if (tags.length === 0) {
    return `<li${classAttr}>${renderJapaneseSpan(form.text)}</li>`;
  }

  const items = tags.map((tag) => {
    const description = expandTag(tag as Tag);
    const label = description.includes("<") ? description : escape(description);
    return `<li class="${tag}">${label}</li>`;
  });
  const tagList = renderList("ul", "tags", items);
  return `<li${classAttr}>\n  ${renderJapaneseSpan(form.text)}\n${indentBlock(tagList, 1)}\n</li>`;
}

function renderPartOfSpeechItem(tag: string): string {
  return `<li class="${tag}">${expandPartOfSpeech(tag as Tag)}</li>`;
}

function renderLanguageSource(source: JMdictLanguageSource): string {
  const base = escape(describeLanguage(source.lang));
  const qualifiers: string[] = [];
  if (source.wasei) {
    qualifiers.push("wasei");
  }
  // We intentionally drop the "full" flag to keep the rendered text concise.
  const qualifierText = qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : "";
  const languageTag = normalizeLanguageTag(source.lang);
  const suffix = source.text ? `: ${renderLanguageSpan(source.text, languageTag)}` : "";
  return `<li class="lang-${source.lang}">${base}${qualifierText}${suffix}</li>`;
}

function renderReference(entry: (string | number)[]): string {
  const [target, sense] = entry;
  let label = renderJapaneseSpan(String(target));
  if (typeof sense === "number") {
    label += ` (sense ${sense})`;
  }
  return `<li>${label}</li>`;
}

function filterSpecificValues(values?: string[]): string[] {
  if (!values) {
    return [];
  }
  const filtered = values.filter((value) => value && value !== "*");
  return filtered;
}

function renderList(tag: "ul" | "ol", className: string, items: string[]): string {
  if (items.length === 0) {
    return "";
  }
  const inner = items.map((item) => indentBlock(item, 1)).join("\n");
  return `<${tag} class="${className}">\n${inner}\n</${tag}>`;
}

function computeSectionComputations(senses: JMdictSense[]): SectionComputation[] {
  if (senses.length === 0) {
    return [];
  }
  const hasMultipleSenses = senses.length > 1;
  return SECTION_DESCRIPTORS.map((descriptor) => {
    const perSenseItems = senses.map((sense) => descriptor.getItems(sense));
    const shared = hasMultipleSenses &&
      perSenseItems[0].length > 0 &&
      perSenseItems.every((items) => equal(items, perSenseItems[0]));
    return { descriptor, perSenseItems, shared };
  });
}

function indentBlock(block: string, level: number): string {
  const indent = "  ".repeat(level);
  return block.split("\n").map((line) => `${indent}${line}`).join("\n");
}

function renderLanguageSpan(text: string, lang: string): string {
  return `<span lang="${escape(lang)}">${escape(text)}</span>`;
}

function renderJapaneseSpan(text: string): string {
  return renderLanguageSpan(text, "ja");
}

/**
 * Mapping of JMdict language codes to a display name and BCP 47 tag.
 * Tuple format: [displayName, bcp47Tag].
 */
const LANGUAGE_METADATA: Record<string, [string, string]> = {
  ara: ["Arabic", "ar"],
  deu: ["German", "de"],
  eng: ["English", "en"],
  fre: ["French", "fr"],
  fra: ["French", "fr"],
  ger: ["German", "de"],
  ita: ["Italian", "it"],
  kor: ["Korean", "ko"],
  lat: ["Latin", "la"],
  por: ["Portuguese", "pt"],
  rus: ["Russian", "ru"],
  spa: ["Spanish", "es"],
  zho: ["Chinese", "zh"],
};

function describeLanguage(code: string): string {
  return (LANGUAGE_METADATA[code]?.[0]) ?? code;
}

function normalizeLanguageTag(code: string): string {
  return (LANGUAGE_METADATA[code]?.[1]) ?? code;
}

function wrapJapaneseText(text: string): string {
  const pattern =
    /([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\u30FC\u30FB\u3005-\u3007\u301C]+)/gu;
  let lastIndex = 0;
  let result = "";

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > lastIndex) {
      result += escape(text.slice(lastIndex, index));
    }
    result += renderJapaneseSpan(match[0]);
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    result += escape(text.slice(lastIndex));
  }

  return result;
}
