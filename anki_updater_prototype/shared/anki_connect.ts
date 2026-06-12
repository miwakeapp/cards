export type ACParams = Record<string, unknown>;

export async function ac<T = unknown>(
  action: string,
  params: ACParams = {},
): Promise<T> {
  const body = { action, version: 6, params };
  const resp = await fetch("http://127.0.0.1:8765", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.error) throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
  return json.result as T;
}
