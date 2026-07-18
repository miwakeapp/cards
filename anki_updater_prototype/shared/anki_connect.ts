export type ACParams = Record<string, unknown>;

export type ACInvoke = <T = unknown>(action: string, params?: ACParams) => Promise<T>;

export const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";
export const DEFAULT_ANKI_CONNECT_TIMEOUT_MS = 30_000;

export function createACInvoke(
  ankiConnectURL = DEFAULT_ANKI_CONNECT_URL,
  fetchImplementation: typeof fetch = fetch,
  requestTimeoutMilliseconds = DEFAULT_ANKI_CONNECT_TIMEOUT_MS,
): ACInvoke {
  return async <T = unknown>(action: string, params: ACParams = {}): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImplementation(ankiConnectURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, version: 6, params }),
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "TimeoutError") {
        throw new Error(
          `AnkiConnect request ${action} timed out after ${requestTimeoutMilliseconds} ms at ${ankiConnectURL}.`,
          { cause },
        );
      }
      throw new Error(
        `Could not reach AnkiConnect at ${ankiConnectURL}. Is Anki running with AnkiConnect installed?`,
        { cause },
      );
    }

    if (!response.ok) {
      throw new Error(`AnkiConnect returned HTTP ${response.status} for ${action}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
    }
    return json.result as T;
  };
}

export const ac = createACInvoke();
