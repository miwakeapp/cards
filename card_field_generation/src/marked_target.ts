import {
  ankiFuriganaToSurface,
  isGeneratedSurfaceFormForLookupSpelling,
  type MarkedContextTextTemplate,
  markedContextTextTemplate,
} from "card_resolution";
import type { JMDictWord } from "data";

interface MarkedTargetValidationFields {
  context: string;
  entry: string;
  recognitionTarget: string;
  senseNumbers: string;
}

function isMarkedAdjectiveStemBeforeSou(
  template: MarkedContextTextTemplate,
  id: number,
  surface: string,
  recognitionTarget: string,
  partOfSpeech: readonly string[],
): boolean {
  if (
    !partOfSpeech.includes("adj-i") ||
    !recognitionTarget.endsWith("い") ||
    surface !== recognitionTarget.slice(0, -1)
  ) {
    return false;
  }

  const closingSentinel = `⟪/target:${id}⟫`;
  const closingIndex = template.text.indexOf(closingSentinel);
  if (closingIndex === -1) {
    throw new Error(`Marked target ${id} is missing its closing sentinel`);
  }
  const followingText = template.text.slice(closingIndex + closingSentinel.length);
  return /^そう(?:な|に|だ|で|です|だった|でした|では|じゃ|$|[、。！？])/u.test(followingText);
}

/**
 * Parses a marked context and verifies that every mark identifies the selected JMDict spelling.
 *
 * Acquisition pipelines normally place marks deterministically, but this package treats them as a
 * semantic input boundary: sending an unrelated marked word to a model would make both its decision
 * and any source-grounding validation meaningless. Inflected surfaces are accepted using the
 * part-of-speech tags from the senses relevant to the operation.
 */
export function validatedMarkedTargetTemplate(
  context: string,
  recognitionTarget: string,
  entry: JMDictWord,
  senseNumbers: readonly number[],
  fields: MarkedTargetValidationFields,
): MarkedContextTextTemplate {
  const template = markedContextTextTemplate(context);
  const partOfSpeech = [
    ...new Set(
      senseNumbers.flatMap((senseNumber) => entry.sense[senseNumber - 1]?.partOfSpeech ?? []),
    ),
  ];

  let promptText = "";
  let sourceIndex = 0;
  const promptTargets = template.targets.map(({ id, surface: sourceSurface, html }) => {
    // Bracket furigana is textual syntax, so the generic context renderer preserves it for
    // minimization. Sense and hint generation already receive the resolved JMDict reading, so hide
    // readings from their entire semantic prompt. In particular, a marked reading must never leak
    // onto a card front through a generated hint.
    const surface = ankiFuriganaToSurface(sourceSurface);
    const openingSentinel = `⟪target:${id}⟫`;
    const closingSentinel = `⟪/target:${id}⟫`;
    const targetStart = template.text.indexOf(openingSentinel, sourceIndex);
    const targetEnd = template.text.indexOf(closingSentinel, targetStart + openingSentinel.length);
    if (targetStart === -1 || targetEnd === -1) {
      throw new Error(`Marked target ${id} is missing from its rendered context`);
    }
    promptText += ankiFuriganaToSurface(template.text.slice(sourceIndex, targetStart));
    promptText += `${openingSentinel}${surface}${closingSentinel}`;
    sourceIndex = targetEnd + closingSentinel.length;
    if (
      surface === recognitionTarget ||
      isGeneratedSurfaceFormForLookupSpelling(surface, recognitionTarget, {
        partOfSpeech,
      }) ||
      // Some source cards mark only an i-adjective stem and leave the productive `そう` ending
      // outside the mark. Accept that precise boundary without permitting arbitrary partial words.
      isMarkedAdjectiveStemBeforeSou(
        template,
        id,
        surface,
        recognitionTarget,
        partOfSpeech,
      )
    ) {
      return { id, surface, html };
    }

    throw new Error(
      `${fields.context} <mark> occurrence ${id} has visible surface ${JSON.stringify(surface)}, ` +
        `which does not equal ${fields.recognitionTarget} ${
          JSON.stringify(recognitionTarget)
        } and ` +
        `is not a permitted inflection under ${fields.senseNumbers} ${
          JSON.stringify(senseNumbers)
        } from ${fields.entry} with id ${JSON.stringify(entry.id)}`,
    );
  });
  promptText += ankiFuriganaToSurface(template.text.slice(sourceIndex));

  const [firstTarget, ...remainingTargets] = promptTargets;
  if (firstTarget === undefined) throw new Error("Marked context unexpectedly has no targets");
  return {
    text: promptText,
    targets: [firstTarget, ...remainingTargets],
  };
}
