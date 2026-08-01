/**
 * Maps inputs with bounded concurrency while preserving input order.
 *
 * A rejected operation stops workers from claiming more inputs. Requests already in flight are
 * allowed to settle before the rejection is propagated, so callers can persist their results.
 */
export async function mapConcurrent<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  let aborted = false;
  let rejected = false;
  let rejection: unknown;

  async function worker(): Promise<void> {
    while (!aborted && nextIndex < inputs.length) {
      const index = nextIndex++;
      try {
        results[index] = await operation(inputs[index], index);
      } catch (error) {
        aborted = true;
        if (!rejected) {
          rejected = true;
          rejection = error;
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      () => worker(),
    ),
  );
  if (rejected) throw rejection;
  return results;
}
