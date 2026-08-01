/**
 * Deterministic recognition-target resolution and structured context markup for Miwake Card
 * acquisition pipelines.
 *
 * @module
 */

export { ankiFuriganaToSurface } from "./anki_furigana.ts";
export {
  markContextTargetOccurrences,
  markContextTargets,
  markedContextHasRuby,
} from "./context.ts";
export {
  markedContextTextTemplate,
  renderMarkedContextText,
  renderMinimizedContextText,
} from "./minimization.ts";
export type { MarkedContextTextTemplate } from "./minimization.ts";
export { findSourceUnsupportedHiraganaWords } from "./lexical_grounding.ts";
export { resolveContextTarget } from "./resolved_context.ts";
export type { ResolvedContextTarget } from "./resolved_context.ts";
export {
  buildSpellingIndex,
  deriveLookupSpellings,
  findEntriesBySpelling,
  findSurfaceFormOccurrencesForLookupSpelling,
  findSurfaceFormsForLookupSpelling,
  isGeneratedSurfaceFormForLookupSpelling,
} from "./recognition_target.ts";
export type { SpellingIndex, SurfaceFormLookupOptions } from "./recognition_target.ts";
export type { RenderedTextOccurrence } from "./rendered_text.ts";
export { findAllEntriesBySpelling } from "./spelling_index.ts";
