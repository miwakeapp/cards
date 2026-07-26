# Card Field Generation

Provides the shared, evaluated AI pipeline for resolving card fields that a caller cannot determine reliably from source data and JMDict alone.

The package owns the canonical prompt, structured output schemas, semantic output validation, few-shot examples, supported model registry, and minimized-context threshold. `generateCardFields()` runs the combined operation. `generateSenseAndHintFields()` reuses its exact sense-and-hint wording and projects the same examples to those outputs for callers, such as `card_updater`, that do not need reading, context, or source generation. The focused operation requires the exact selected JMDict kana form and the sense numbers compatible with its spelling and reading, so the model cannot reconsider impossible senses.

Both operations return the same validated sense-selection union. `applicableSenses: null` is terminal and carries no speculative card fields. An empty array canonically means every compatible sense applies and has no hint. A nonempty array is a proper subset of the compatible senses and always has a short hint containing the recognition target.

Callers remain responsible for adapting generated fields to their workflows and for detecting stale deterministic evidence before passing fully decided input to `card_creator`.
