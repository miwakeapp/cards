import { assertEquals } from "@std/assert";
import { type ACInvoke, createACInvoke, openNotesInAnki } from "../src/anki.ts";

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

Deno.test("openNotesInAnki searches for one note", async () => {
  const calls: Array<{ action: string; params: unknown }> = [];
  const invoke: ACInvoke = <T>(action: string, params?: Record<string, unknown>) => {
    calls.push({ action, params });
    return Promise.resolve(undefined as T);
  };
  await openNotesInAnki([123], invoke);

  assertEquals(calls, [{ action: "guiBrowse", params: { query: "nid:123" } }]);
});

Deno.test("openNotesInAnki combines notes in one browser search", async () => {
  const calls: Array<{ action: string; params: unknown }> = [];
  const invoke: ACInvoke = <T>(action: string, params?: Record<string, unknown>) => {
    calls.push({ action, params });
    return Promise.resolve(undefined as T);
  };
  await openNotesInAnki([123, 456, 789], invoke);

  assertEquals(calls, [{
    action: "guiBrowse",
    params: { query: "nid:123 or nid:456 or nid:789" },
  }]);
});
