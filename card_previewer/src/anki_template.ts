export function applyAnkiFuriganaFilter(value: string): string {
  return value.replaceAll("&nbsp;", " ").replace(
    / ?([^ >]+?)\[(.+?)\]/gu,
    (match, base: string, annotation: string) => {
      if (annotation.startsWith("sound:")) {
        return match;
      }
      return `<ruby><rb>${base}</rb><rt>${annotation}</rt></ruby>`;
    },
  );
}

export function renderAnkiTemplate(
  template: string,
  fields: Readonly<Record<string, string>>,
): string {
  let rendered = template;
  const sectionPattern = /\{\{([#^])([^{}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/gu;
  let previous: string;

  do {
    previous = rendered;
    rendered = rendered.replace(
      sectionPattern,
      (_match, marker: "#" | "^", rawName: string, contents: string) => {
        const value = fields[rawName.trim()] ?? "";
        const include = marker === "#" ? value.length > 0 : value.length === 0;
        return include ? contents : "";
      },
    );
  } while (rendered !== previous);

  return rendered.replace(
    /\{\{(?:(furigana):)?([^{}]+)\}\}/gu,
    (_match, filter: string | undefined, rawName: string) => {
      const value = fields[rawName.trim()] ?? "";
      return filter === "furigana" ? applyAnkiFuriganaFilter(value) : value;
    },
  );
}
