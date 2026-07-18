import { assertEquals, assertThrows } from "@std/assert";
import { parseApplyArguments } from "./apply.ts";

Deno.test("parseApplyArguments accepts the required manifest positional argument", () => {
  const options = parseApplyArguments([
    "generated/conversion.json",
    "--anki-connect-url=http://SurfacePro11:8765",
  ]);

  assertEquals(options.manifestPath, "generated/conversion.json");
  assertEquals(options.ankiConnectURL, "http://SurfacePro11:8765");
  assertEquals(options.write, false);
  assertEquals(options.reset, false);
});

Deno.test("parseApplyArguments accepts an explicit scheduling reset", () => {
  const options = parseApplyArguments(["generated/conversion.json", "--reset", "--write"]);

  assertEquals(options.reset, true);
  assertEquals(options.write, true);
});

Deno.test("parseApplyArguments rejects unknown flags", () => {
  assertThrows(
    () => parseApplyArguments(["generated/conversion.json", "--surprise"]),
    Error,
    "Unknown argument: --surprise",
  );
});
