import { assertEquals } from "@std/assert";
import { createACInvoke } from "../src/anki.ts";

Deno.test("createACInvoke: sends requests to the selected URL", async () => {
  let requestedURL: string | undefined;
  let requestedBody: BodyInit | null | undefined;
  const fetchImplementation = ((input: string | URL | Request, init?: RequestInit) => {
    requestedURL = String(input);
    requestedBody = init?.body;
    return Promise.resolve(Response.json({ result: 6, error: null }));
  }) as typeof fetch;
  const invoke = createACInvoke("http://surfacepro11:8765", fetchImplementation);

  const result = await invoke<number>("version");

  assertEquals(result, 6);
  assertEquals(requestedURL, "http://surfacepro11:8765");
  assertEquals(requestedBody, JSON.stringify({ action: "version", version: 6, params: {} }));
});
