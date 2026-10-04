import type { JMdictWord } from "@scriptin/jmdict-simplified-types";
import { renderDictionaryField, splitDictionaryField } from "card_model/dictionary";
import { formatKey, type Key } from "card_model/keys";
import type { AnalyzedCard } from "./analyze.ts";
import { alignSenses, parseRenderedEntry } from "./entry_text.ts";
import { parseCardReadingAlternatives, validateCardReading } from "./reading_validation.ts";

/**
 * Finds a uniquely supported successor for a removed spelling or reading on a single-entry card.
 * Gloss containment is evidence of dictionary reorganization, not proof of semantic equivalence:
 * the existing context-based sense/hint operation and explicit review still gate application.
 */
export async function proposeEntryMigration(
  card: AnalyzedCard,
  entries: ReadonlyMap<string, JMdictWord>,
): Promise<AnalyzedCard | null> {
  const key = card.parsedKey;
  if (
    card.verdict !== "exception" ||
    !["spelling-removed", "invalid-reading"].includes(card.reason) ||
    key === null || key.usages.length !== 1 || card.latestWord === null
  ) return null;

  const oldHTML = splitDictionaryField(card.note.fields.dictionary, key)?.get(
    key.usages[0].jmdictId,
  );
  if (oldHTML === undefined) return null;
  const oldParsed = parseRenderedEntry(oldHTML);
  if (![...oldParsed.kanjiForms, ...oldParsed.kanaForms].includes(key.spelling)) return null;
  const oldTargets = key.usages[0].senseNumbers ?? oldParsed.senses.map((s) => s.number);
  if (oldTargets.length === 0 || oldTargets.some((n) => oldParsed.senses[n - 1] === undefined)) {
    return null;
  }

  // A malformed or originally unsupported Reading is not evidence that JMDict split an entry.
  // In particular, do not "repair" explanatory ruby by finding an unrelated current entry.
  if (oldParsed.kanjiForms.includes(key.spelling)) {
    const readings = parseCardReadingAlternatives(
      card.note.fields.reading,
      card.note.fields.recognitionTarget || key.spelling,
      key.spelling,
    );
    if (readings === null || readings.some((r) => !oldParsed.kanaForms.includes(r.kanaReading))) {
      return null;
    }
    if (
      card.reason === "invalid-reading" &&
      readings.every((r) => card.latestWord!.kana.some((k) => k.text === r.kanaReading))
    ) return null;
  } else if (card.note.fields.reading !== "") return null;

  const matches: AnalyzedCard[] = [];
  for (const word of entries.values()) {
    if (word.id === card.latestWord.id) continue;
    if (![...word.kanji, ...word.kana].some((f) => f.text === key.spelling)) continue;
    const latestEntryHTML = renderDictionaryField([word]);
    const newParsed = parseRenderedEntry(latestEntryHTML);
    const mappedTargets: number[] = [];
    for (const n of oldTargets) {
      const oldGlosses = oldParsed.senses[n - 1].glosses;
      const counterparts = newParsed.senses.filter((s) => {
        const a = new Set(oldGlosses);
        const b = new Set(s.glosses);
        return a.size > 0 && b.size > 0 &&
          ([...a].every((g) => b.has(g)) || [...b].every((g) => a.has(g)));
      });
      if (counterparts.length === 1) mappedTargets.push(counterparts[0].number);
    }
    if (
      mappedTargets.length !== oldTargets.length ||
      new Set(mappedTargets).size !== mappedTargets.length
    ) continue;
    const proposedKey = formatKey(key.spelling, [{
      jmdictId: word.id,
      senseNumbers: mappedTargets,
      totalSenses: word.sense.length,
    }]);
    const destinationKey: Key = {
      spelling: key.spelling,
      usages: [{ jmdictId: word.id, senseNumbers: mappedTargets }],
    };
    const reading = await validateCardReading({
      key: destinationKey,
      recognitionTarget: card.note.fields.recognitionTarget,
      reading: card.note.fields.reading,
      entries,
    });
    if (reading.error !== null) continue;
    matches.push({
      ...card,
      verdict: "retarget",
      reason: "entry-migration",
      detail:
        `The removed form has a uniquely supported successor in JMDict entry ${word.id} (previously ${card.latestWord.id}). Review the context-based sense selection before moving the card.`,
      latestWord: word,
      latestEntryHTML,
      oldParsed,
      newParsed,
      alignment: alignSenses(oldParsed.senses, newParsed.senses),
      targetSenseNumbers: oldTargets,
      mappedTargetSenses: mappedTargets.toSorted((a, b) => a - b),
      proposedKey,
      proposedReading: reading.proposedReading,
      acceptedKanaReadings: reading.acceptedKanaReadings,
      senseViews: newParsed.senses.map((s) => ({
        number: s.number,
        text: s.text,
        wasTargeted: mappedTargets.includes(s.number),
        isNew: !mappedTargets.includes(s.number),
      })),
      changeChips: [{
        kind: "entry-info",
        label: "entry",
        text: `${card.latestWord.id} → ${word.id}`,
      }],
      needsAI: true,
    });
  }
  return matches.length === 1 ? matches[0] : null;
}
