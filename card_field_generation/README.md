# Card Field Generation

Provides the shared, evaluated AI pipeline for resolving card fields that a caller cannot determine reliably from source data and JMDict alone.

The package owns the canonical prompt, structured output schemas, few-shot examples, supported model registry, and minimized-context threshold. `generateCardFields()` runs the combined operation. `generateSenseAndHintFields()` reuses its exact sense-and-hint wording and projects the same examples to those outputs for callers, such as `card_updater`, that do not need reading, context, or source generation.

Callers remain responsible for validating and adapting generated fields to their workflows before passing fully decided input to `card_creator`.
