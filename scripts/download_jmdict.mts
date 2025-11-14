import * as path from "@std/path";
import { extract as extractZip } from "@quentinadam/zip";
import type { JMdict } from "@scriptin/jmdict-simplified-types";

const jmdictReleasesURL = "https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest";
const jmdictFilename = path.resolve(import.meta.dirname!, "jmdict_eng.json");

const testIds = new Set([
  "2030540", // 狂喜乱舞, simple entry
  "1414110", // 大小, one reading, multiple senses, per-sense tags
  "1590470", // 画期的, multiple readings, one sense
]);

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

const jmdictText = new TextDecoder().decode(unzipped[0].data);
const jmdict = JSON.parse(jmdictText) as JMdict;

const promises = [];
const foundIds = new Set<string>();
for (const word of jmdict.words) {
  if (testIds.has(word.id)) {
    const filename = path.resolve(import.meta.dirname!, `../test/inputs/${word.id}.json`);
    promises.push(Deno.writeTextFile(filename, JSON.stringify(word, undefined, 2)));
    foundIds.add(word.id);
  }
}

if (promises.length !== testIds.size) {
  throw new Error(
    "Some test IDs were not found in the downloaded JMdict:" +
      [...testIds.difference(foundIds)].join(", "),
  );
}
await Promise.all(promises);
