# Card Field Generation

Provides the shared, evaluated AI pipeline for resolving card fields that a caller cannot determine reliably from source data and JMDict alone.

The package owns the canonical prompts, structured output schemas, semantic output validation, few-shot examples, supported model registry, and minimized-context threshold. `generateCardFields()` runs the combined legacy operation. Focused operations expose the same tuned wording when a caller needs only one decision:

- `generateSenseAndHintFields()` selects compatible senses and a disambiguating hint.
- `generateMinimizedContext()` shortens an already-resolved full context.
- `generateTargetInContext()` locates an unresolved inflected surface form.
- `generateContrastiveHint()` tries to distinguish an entry already selected by reading evidence from other same-spelling entries.

Each operation accepts only the evidence needed for that decision and validates the structured output before returning it.

The combined and sense-and-hint operations return the same validated sense-selection union. `applicableSenses: null` is terminal and carries no speculative card fields. An empty array canonically means every compatible sense applies and has no hint. A nonempty array is a proper subset of the compatible senses and always has a short hint containing the recognition target.

Callers remain responsible for adapting generated fields to their workflows and for detecting stale deterministic evidence before passing fully decided input to `card_creator`.
