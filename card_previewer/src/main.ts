import { serveDir } from "@std/http/file-server";
import * as path from "@std/path";

const CLIENT_DIRECTORY = path.resolve(import.meta.dirname!, "client");
const BUILD_DIRECTORY = path.resolve(import.meta.dirname!, "../build");
const MODEL_DIRECTORY = path.resolve(
  import.meta.dirname!,
  "../../card_model/assets",
);
const hostname = Deno.env.get("HOST") ?? "127.0.0.1";
const port = Number(Deno.env.get("PORT") ?? 8000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`Invalid PORT value: ${Deno.env.get("PORT")}`);
}

Deno.serve({ hostname, port }, (request) => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/model/front.html") {
    return serveModelFile("front.html", "text/html; charset=utf-8");
  }
  if (pathname === "/model/back.html") {
    return serveModelFile("back.html", "text/html; charset=utf-8");
  }
  if (pathname === "/model/styles_prefix.css") {
    return serveModelFile("styles_prefix.css", "text/css; charset=utf-8");
  }
  if (pathname === "/model/minimal.css") {
    return serveModelFile("minimal.css", "text/css; charset=utf-8");
  }
  if (pathname === "/model/NotoSerifJP-VariableFont_wght.ttf") {
    return serveModelFile("NotoSerifJP-VariableFont_wght.ttf", "font/ttf");
  }

  const fsRoot = pathname === "/dictionary_preview.js" ||
      pathname === "/card_preview.js" ||
      pathname.startsWith("/data/")
    ? BUILD_DIRECTORY
    : CLIENT_DIRECTORY;
  return serveDir(request, {
    fsRoot,
    quiet: true,
    showDirListing: false,
    headers: ["cache-control: no-store"],
  });
});

async function serveModelFile(filename: string, contentType: string): Promise<Response> {
  const contents = await Deno.readFile(path.join(MODEL_DIRECTORY, filename));
  return new Response(contents, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
    },
  });
}
