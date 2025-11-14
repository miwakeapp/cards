import { extract as extractZip } from "@quentinadam/zip";

const jmdictReleasesURL = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";
const jmdictFilename = "jmdict_eng.json";

// Get the latest release metadata from GitHub API
const releaseResponse = await fetch(jmdictReleasesURL);
if (!releaseResponse.ok) {
  throw new Error(`Failed to fetch release info: ${releaseResponse.statusText}`);
}

const releaseData = await releaseResponse.json();

// Example name: "jmdict-eng-3.6.1+20241216123416.json.zip"
const targetAsset = releaseData.assets.find((asset: { name: string }) =>
  asset.name.startsWith("jmdict-eng-") && asset.name.endsWith(".json.zip")
);
if (!targetAsset) {
  throw new Error("Could not find the jmdict-eng JSON zip asset in the latest release.");
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

await Deno.writeFile(jmdictFilename, unzipped[0].data);
console.log(`Downloaded and saved as ${jmdictFilename}`);
