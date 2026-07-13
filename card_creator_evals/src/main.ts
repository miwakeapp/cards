import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";

const PACKAGE_DIRECTORY = path.resolve(import.meta.dirname!, "..");
const CLIENT_DIRECTORY = path.join(PACKAGE_DIRECTORY, "src", "client");
const BUILD_DIRECTORY = path.join(PACKAGE_DIRECTORY, "build");
const GENERATED_DIRECTORY = path.join(PACKAGE_DIRECTORY, "generated");

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/inputs") {
    return Response.json(await directoryNames(path.join(PACKAGE_DIRECTORY, "inputs"), "files"));
  }
  if (url.pathname === "/api/runs") {
    return Response.json(
      await directoryNames(path.join(GENERATED_DIRECTORY, "runs"), "directories"),
    );
  }

  const fsRoot = url.pathname === "/main.js"
    ? BUILD_DIRECTORY
    : url.pathname === "/inputs" || url.pathname.startsWith("/inputs/") ||
        url.pathname === "/goldens" || url.pathname.startsWith("/goldens/")
    ? PACKAGE_DIRECTORY
    : url.pathname === "/runs" || url.pathname.startsWith("/runs/")
    ? GENERATED_DIRECTORY
    : CLIENT_DIRECTORY;
  return serveDir(request, {
    fsRoot,
    quiet: true,
    showDirListing: false,
    showDotfiles: false,
    headers: ["cache-control: no-store"],
  });
});

async function directoryNames(
  directory: string,
  kind: "files" | "directories",
): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(directory)) {
      if (kind === "files" ? entry.isFile : entry.isDirectory) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  return names.sort();
}
