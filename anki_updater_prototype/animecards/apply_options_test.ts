import { assertEquals } from "@std/assert";
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
  assertEquals(options.tags, []);
});

Deno.test("parseApplyArguments accepts an explicit scheduling reset", () => {
  const options = parseApplyArguments(["generated/conversion.json", "--reset", "--write"]);

  assertEquals(options.reset, true);
  assertEquals(options.write, true);
});

Deno.test("parseApplyArguments accepts and deduplicates tags", () => {
  const options = parseApplyArguments([
    "generated/conversion.json",
    "--tag=2026-07-22-batch",
    "--tag=2026-07-22-batch",
    "--tag",
    "review",
  ]);

  assertEquals(options.tags, ["2026-07-22-batch", "review"]);
});

Deno.test("parseApplyArguments rejects tags containing whitespace", () => {
  let message = "";
  try {
    parseApplyArguments(["generated/conversion.json", "--tag=review batch"]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(message, "--tag values must be nonempty Anki tags without whitespace: review batch");
});

Deno.test("parseApplyArguments ignores unrecognized arguments", () => {
  const options = parseApplyArguments([
    "generated/conversion.json",
    "extra.json",
    "--surprise",
  ]);

  assertEquals(options.manifestPath, "generated/conversion.json");
});
