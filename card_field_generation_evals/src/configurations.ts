import {
  effectiveReasoningEffort,
  type ModelId,
  PRODUCTION_GENERATION_CONFIGURATIONS,
  type ReasoningEffort,
} from "card_field_generation/model-presets";
import type { EvalModelConfiguration, EvalOperation } from "./types.ts";

/** One concrete model setting applied only to the named focused operation. */
export interface EvalOperationConfiguration extends EvalModelConfiguration {
  operation: EvalOperation;
}

/**
 * Builds the model matrix for each operation.
 *
 * An omitted dimension retains that operation's configured production setting. Explicit model or
 * effort lists replace only their corresponding dimension, allowing broad comparisons without
 * accidentally replacing the other production default.
 */
export function evalOperationConfigurations(
  operations: readonly EvalOperation[],
  modelIds?: readonly ModelId[],
  reasoningEfforts?: readonly ReasoningEffort[],
): EvalOperationConfiguration[] {
  const configurations = operations.flatMap((operation) => {
    const production = PRODUCTION_GENERATION_CONFIGURATIONS[operation];
    const operationModels = modelIds ?? [production.modelId];
    const operationEfforts = reasoningEfforts ?? [production.reasoningEffort];
    return operationModels.flatMap((modelId) =>
      operationEfforts.map((requestedEffort) => ({
        operation,
        modelId,
        reasoningEffort: effectiveReasoningEffort(modelId, requestedEffort),
      }))
    );
  });
  return [
    ...new Map(
      configurations.map((configuration) => [
        `${configuration.operation}\0${configuration.modelId}\0${configuration.reasoningEffort}`,
        configuration,
      ]),
    ).values(),
  ];
}
