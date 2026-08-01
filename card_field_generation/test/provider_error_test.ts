import { assertEquals } from "@std/assert";
import { isAIQuotaError } from "../src/provider_error.ts";

Deno.test("isAIQuotaError recognizes provider quota failures", () => {
  for (
    const error of [
      "You exceeded your current quota. Check your plan and billing details.",
      { code: "insufficient_quota" },
      new Error("Spend-based rate limit reached"),
      new Error("Your credit balance is too low"),
      new Error("Payment required"),
      new Error("request failed", { cause: new Error("credit balance is too low") }),
    ]
  ) {
    assertEquals(isAIQuotaError(error), true);
  }
  for (
    const error of [
      new Error("Invalid JSON response"),
      new Error("RESOURCE_EXHAUSTED: quota exceeded"),
      {
        statusCode: 429,
        status: "RESOURCE_EXHAUSTED",
        message:
          "Quota exceeded for quota metric Generate requests per minute per project per model",
      },
      new Error("Quota has been exceeded for this project"),
    ]
  ) {
    assertEquals(isAIQuotaError(error), false);
  }
});
