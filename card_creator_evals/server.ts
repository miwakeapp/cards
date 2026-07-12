import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";

const PACKAGE_DIRECTORY = import.meta.dirname!;

Deno.serve({ hostname: "127.0.0.1", port: 8000 }, async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/") {
    return Response.redirect(new URL("/src/", url), 307);
  }
  if (url.pathname === "/api/inputs") {
    return Response.json(await directoryNames("inputs", "files"));
  }
  if (url.pathname === "/api/runs") {
    return Response.json(await directoryNames("runs", "directories"));
  }
  const staticDirectory = ["src", "inputs", "goldens", "runs"].find((directory) =>
    url.pathname === `/${directory}` || url.pathname.startsWith(`/${directory}/`)
  );
  if (staticDirectory === undefined) {
    return new Response("Not found", { status: 404 });
  }
  return serveDir(request, {
    fsRoot: PACKAGE_DIRECTORY,
    quiet: true,
    showDirListing: false,
    showDotfiles: false,
    headers: ["cache-control: no-store"],
  });
});

async function directoryNames(
  relativePath: string,
  kind: "files" | "directories",
): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(path.join(PACKAGE_DIRECTORY, relativePath))) {
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
