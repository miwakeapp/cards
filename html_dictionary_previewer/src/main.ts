import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";

const CLIENT_DIRECTORY = path.resolve(import.meta.dirname!, "client");
const BUILD_DIRECTORY = path.resolve(import.meta.dirname!, "../build");

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, (request) => {
  const pathname = new URL(request.url).pathname;
  const fsRoot = pathname === "/main.js" || pathname.startsWith("/data/")
    ? BUILD_DIRECTORY
    : CLIENT_DIRECTORY;
  return serveDir(request, {
    fsRoot,
    quiet: true,
    showDirListing: false,
    headers: ["cache-control: no-store"],
  });
});
