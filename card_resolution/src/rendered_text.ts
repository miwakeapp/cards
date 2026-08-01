/**
 * One occurrence in rendered base text.
 *
 * `start` and `end` are UTF-16 offsets, matching JavaScript string indexing. For an HTML
 * fragment, they refer to its rendered text after element attributes and ruby annotations have
 * been omitted.
 */
export interface RenderedTextOccurrence {
  /** Inclusive UTF-16 offset where the occurrence begins. */
  readonly start: number;
  /** Exclusive UTF-16 offset where the occurrence ends. */
  readonly end: number;
  /** Exact text between `start` and `end`. */
  readonly surface: string;
}
