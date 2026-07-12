import { join } from "@std/path";

// Tests substitute only the compact checked furigana fixture; all other data remains canonical.
export const resourcePaths = {
  jmdictFurigana: join(import.meta.dirname!, "jmdict_furigana.json"),
};
