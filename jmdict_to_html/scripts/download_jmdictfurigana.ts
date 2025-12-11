import * as path from "@std/path";
import { extract as extractZip } from "@quentinadam/zip";

const jmdictFuriganaReleasesURL =
  "https://api.github.com/repos/Doublevil/JmdictFurigana/releases/latest";
const jmdictFuriganaFilename = path.resolve(import.meta.dirname!, "../src/jmdict_furigana.json");

// Get the latest release metadata from GitHub API
const releaseResponse = await fetch(jmdictFuriganaReleasesURL);
if (!releaseResponse.ok) {
  throw new Error(`Failed to fetch release info: ${releaseResponse.statusText}`);
}

const releaseData = await releaseResponse.json();

const targetAsset = releaseData.assets.find((asset: { name: string }) =>
  asset.name === "JmdictFurigana.json.zip"
);
if (!targetAsset) {
  throw new Error("Could not find the JmdictFurigana.json.zip asset in the latest release.");
}

const downloadURL = targetAsset.browser_download_url;
console.log(`Found asset: ${targetAsset.name}`);
console.log(`Downloading from: ${downloadURL}`);

const fileResponse = await fetch(downloadURL);
if (!fileResponse.ok) {
  throw new Error(`Failed to download the asset: ${fileResponse.statusText}`);
}
const fileData = await fileResponse.bytes();

console.log("Downloaded the asset. Extracting...");
const unzipped = await extractZip(fileData);
if (unzipped.length !== 1) {
  throw new Error("Expected the zip file to contain exactly one file.");
}

await Deno.writeFile(jmdictFuriganaFilename, unzipped[0].data);
console.log(`Downloaded and saved as ${jmdictFuriganaFilename}`);
