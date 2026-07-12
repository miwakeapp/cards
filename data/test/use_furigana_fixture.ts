import { join } from "@std/path";
import { resourcePaths } from "../resource_paths.ts";

resourcePaths.jmdictFurigana = join(import.meta.dirname!, "fixtures", "jmdict_furigana.json");
