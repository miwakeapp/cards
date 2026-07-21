import type { JMdictWord as ExternalJMDictWord } from "@scriptin/jmdict-simplified-types";

/**
 * The JMDict word type used at Miwake Cards package boundaries.
 *
 * The `@internal` annotation works around Deno documentation lint treating the re-exported npm
 * type as private; this alias is still the public type used by Miwake Cards packages.
 *
 * @internal
 */
export type JMDictWord = ExternalJMDictWord;
