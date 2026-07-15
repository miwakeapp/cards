import { assertEquals, assertStringIncludes } from "@std/assert";
import { applyRestrictionReason } from "../src/client/apply_policy.ts";

Deno.test("applyRestrictionReason: unrestricted full scans can apply", () => {
  assertEquals(applyRestrictionReason({ dryRun: false, limit: undefined }), undefined);
});

Deno.test("applyRestrictionReason: limited scans explain why Apply is disabled", () => {
  const reason = applyRestrictionReason({ dryRun: false, limit: 50 });

  assertStringIncludes(reason!, "--limit");
  assertStringIncludes(reason!, "complete scan");
  assertStringIncludes(reason!, "Restart without --limit");
});
