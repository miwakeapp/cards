import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";

const STATIC_DIRECTORY = path.resolve(import.meta.dirname!, "src");

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, (request) =>
  serveDir(request, {
    fsRoot: STATIC_DIRECTORY,
    quiet: true,
    showDirListing: false,
    headers: ["cache-control: no-store"],
  }));
