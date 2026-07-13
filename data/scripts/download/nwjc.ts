import * as path from "@std/path";
import { unzipSync } from "fflate";
import { resourcePaths } from "../../src/resource_paths.ts";

const nwjcSurface1GramURL =
  "https://github.com/masayu-a/NWJC/raw/master/NWJC-n-gram/NWJC-surface-1gram.zip";
const outputFilename = resourcePaths.nwjcSurface1Gram;
const outputDir = path.dirname(outputFilename);
const temporaryFilename = `${outputFilename}.download`;

console.log(`Downloading from: ${nwjcSurface1GramURL}`);

const response = await fetch(nwjcSurface1GramURL);
if (!response.ok) {
  throw new Error(`Failed to download NWJC surface 1-gram data: ${response.statusText}`);
}

const archive = await response.bytes();
console.log(`Downloaded ${(archive.length / 1024 / 1024).toFixed(2)} MB. Extracting...`);

const files = unzipSync(archive);
const targetFile = files["NWJC-surface-1gram.txt"];
if (!targetFile) {
  throw new Error("Could not find NWJC-surface-1gram.txt in the downloaded archive.");
}

await Deno.mkdir(outputDir, { recursive: true });
await Deno.writeFile(temporaryFilename, targetFile);
await Deno.rename(temporaryFilename, outputFilename);

console.log(`Saved to ${outputFilename} (${(targetFile.length / 1024 / 1024).toFixed(2)} MB)`);
