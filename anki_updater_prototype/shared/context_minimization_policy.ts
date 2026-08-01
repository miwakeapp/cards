import { ankiFuriganaToSurface, renderMarkedContextText } from "card_resolution";

const MINIMIZED_CONTEXT_LENGTH_THRESHOLD = 50;

function visibleCardFrontText(context: string): string {
  return ankiFuriganaToSurface(renderMarkedContextText(context));
}

/** Prototype acquisition policy for when a full context is long enough to merit AI shortening. */
export function needsAIMinimizedContext(context: string): boolean {
  const compactVisibleText = visibleCardFrontText(context).replace(/\s+/gu, "");
  return [...compactVisibleText].length > MINIMIZED_CONTEXT_LENGTH_THRESHOLD;
}
