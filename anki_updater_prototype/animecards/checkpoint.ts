import type { ConversionManifest } from "./types.ts";

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Creates a stage checkpoint tied to every field in its input manifest. */
export async function createCheckpointManifest(
  input: ConversionManifest,
): Promise<ConversionManifest> {
  const checkpoint = structuredClone(input);
  checkpoint.inputManifestFingerprint = await fingerprint(input);
  return checkpoint;
}

/** Ensures that a stage never resumes output produced from a since-edited input manifest. */
export async function checkpointMatchesInput(
  input: ConversionManifest,
  checkpoint: ConversionManifest,
): Promise<boolean> {
  return checkpoint.inputManifestFingerprint === await fingerprint(input);
}
