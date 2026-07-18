import { assertEquals, assertRejects } from "@std/assert";
import { createACInvoke } from "./anki_connect.ts";

Deno.test("createACInvoke sends requests to the selected AnkiConnect URL", async () => {
  let requestedURL: string | undefined;
  let requestedBody: BodyInit | null | undefined;
  const fetchImplementation = ((input: string | URL | Request, init?: RequestInit) => {
    requestedURL = String(input);
    requestedBody = init?.body;
    return Promise.resolve(Response.json({ result: 6, error: null }));
  }) as typeof fetch;
  const invoke = createACInvoke("http://surfacepro11:8765", fetchImplementation);

  assertEquals(await invoke<number>("version"), 6);
  assertEquals(requestedURL, "http://surfacepro11:8765");
  assertEquals(requestedBody, JSON.stringify({ action: "version", version: 6, params: {} }));
});

Deno.test("createACInvoke times out an unavailable AnkiConnect host", async () => {
  const fetchImplementation =
    ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
  const invoke = createACInvoke("http://surfacepro11:8765", fetchImplementation, 10);

  await assertRejects(
    () => invoke("version"),
    Error,
    "AnkiConnect request version timed out after 10 ms",
  );
});
