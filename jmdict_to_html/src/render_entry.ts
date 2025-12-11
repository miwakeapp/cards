import type {
  JMdictKana,
  JMdictKanji,
  JMdictLanguageSource,
  JMdictSense,
  JMdictWord,
  Tag,
  Xref,
} from "@scriptin/jmdict-simplified-types";
import { iso6392BTo1 } from "iso-639-2";
import { escape } from "@std/html";
import { equal } from "@std/assert";

import {
  field as expandField,
  misc as expandMisc,
  partOfSpeech as expandPartOfSpeech,
  tag as expandTag,
} from "./jmdict_tag_expansions.ts";

export type { JMdictWord };

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
    className: "language-source",
    getItems: (sense) => sense.languageSource.map((source) => renderLanguageSource(source)),
  },
  {
    className: "dialect",
    getItems: (sense) =>
      sense.dialect.map((tag) => `<li class="${tag}">${escape(expandTag(tag as Tag))}</li>`),
  },
  {
    className: "misc",
    getItems: (sense) =>
      sense.misc.map((tag) =>
        `<li class="${tag}">${wrapJapaneseText(expandMisc(tag as Tag))}</li>`
      ),
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
    className: "info",
    getItems: (sense) =>
      sense.info.filter(Boolean).map((text) => `<li>${wrapJapaneseText(text)}</li>`),
  },
];

type SectionComputation = {
  descriptor: SectionDescriptor;
  perSenseItems: string[][];
  shared: boolean;
};

export function renderEntry(word: JMdictWord): string {
  const senses = word.sense;
  const sharedParts = computeSharedPartOfSpeech(senses);
  const sharedSet = new Set(sharedParts);
  const sectionComputations = computeSectionComputations(senses);
  const senseItems = senses.map((sense, index) =>
    renderSense(sense, sharedSet, sectionComputations, index)
  );

  const sections: string[] = [];

  const kanjiSection = renderForms(word.kanji, "kanji");
  if (kanjiSection) {
    sections.push(kanjiSection);
  }

  const kanaSection = renderForms(word.kana, "kana");
  if (kanaSection) {
    sections.push(kanaSection);
  }

  if (sharedParts.length > 0) {
    const items = sharedParts.map((tag) => renderPartOfSpeechItem(tag));
    sections.push(renderList("ul", "part-of-speech", items));
  }

  if (senseItems.length > 0) {
    sections.push(renderList("ol", "senses", senseItems));
  }

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

  const glosses = sense.gloss;
  if (glosses.length > 0) {
    const items = glosses.map((gloss) => `<li>${escape(gloss.text)}</li>`);
    blocks.push(renderList("ul", "glosses", items));
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
    return `<li class="${tag}">${wrapJapaneseText(description)}</li>`;
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
  const languageTag = iso6392BTo1[source.lang]!;
  const suffix = source.text ? `: ${renderLanguageSpan(source.text, languageTag)}` : "";
  return `<li class="lang-${source.lang}">${base}${qualifierText}${suffix}</li>`;
}

function renderReference(entry: Xref): string {
  const [target] = entry;
  let hrefTarget = target;
  let sense: number | undefined;

  if (entry.length === 3) {
    const [, reading, index] = entry;
    hrefTarget = reading;
    sense = index;
  } else if (entry.length === 2) {
    const [, second] = entry;
    if (typeof second === "string") {
      hrefTarget = second;
    } else {
      sense = second;
    }
  }

  let label = `<a href="https://takoboto.jp/?q=${encodeURIComponent(hrefTarget)}" lang="ja">${
    escape(target)
  }</a>`;
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
  return SECTION_DESCRIPTORS.map((descriptor) => {
    const perSenseItems = senses.map((sense) => descriptor.getItems(sense));
    const shared = perSenseItems[0].length > 0 &&
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

function describeLanguage(code: string): string {
  const formatter = new Intl.DisplayNames(["en"], { type: "language" });
  return formatter.of(iso6392BTo1[code])!;
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
