import { assertEquals } from "@std/assert";
import { markResolvedContextTargetWithinAnchor } from "./anchored_context.ts";

Deno.test("markResolvedContextTargetWithinAnchor preserves lexical occurrence identity", async () => {
  const fullContext = "彼の考えとは異なるが、結果はこうなる。";
  const evidenceContext = `前にもそうなると思った。\n\n${fullContext}\n\n後でもそうなる。`;

  assertEquals(
    await markResolvedContextTargetWithinAnchor(
      evidenceContext,
      fullContext,
      "なる",
      ["v5r"],
    ),
    "前にもそうなると思った。\n\n彼の考えとは異なるが、結果はこう<mark>なる</mark>。\n\n" +
      "後でもそうなる。",
  );
});
