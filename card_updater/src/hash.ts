import { encodeHex } from "@std/encoding/hex";

/** Hashes a JSON-serializable value to a hex SHA-256 string. */
export async function sha256OfJSON(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return encodeHex(await crypto.subtle.digest("SHA-256", bytes));
}
