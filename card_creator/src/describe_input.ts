/** Formats a numeric input without JSON's lossy conversion of non-finite values to `null`. */
export function describeNumber(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

/** Formats a numeric-array input without losing non-finite values. */
export function describeNumbers(values: readonly number[]): string {
  return `[${values.map(describeNumber).join(", ")}]`;
}
