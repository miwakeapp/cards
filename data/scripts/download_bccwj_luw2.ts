import * as path from "@std/path";
import { unzipSync } from "fflate";

const bccwjLUW2URL =
  "https://repository.ninjal.ac.jp/record/3231/files/BCCWJ_frequencylist_luw2_ver1_1.zip";
const expectedSHA256 = "9d73dc2962353f29610bd1175112a822b2cf4e0615fe6cde792d26038846313c";
const outputDir = path.resolve(import.meta.dirname!, "../bccwj");
const outputFilename = path.join(outputDir, "BCCWJ_frequencylist_luw2_ver1_1.tsv");
const temporaryFilename = `${outputFilename}.download`;

console.log(`Downloading from: ${bccwjLUW2URL}`);

const response = await fetch(bccwjLUW2URL);
if (!response.ok) {
  throw new Error(`Failed to download BCCWJ LUW2 data: ${response.statusText}`);
}

const archive = await response.bytes();
const actualSHA256 = new Uint8Array(await crypto.subtle.digest("SHA-256", archive)).toHex();
if (actualSHA256 !== expectedSHA256) {
  throw new Error(
    `BCCWJ archive checksum mismatch: expected ${expectedSHA256}, got ${actualSHA256}`,
  );
}
console.log(`Downloaded ${(archive.length / 1024 / 1024).toFixed(2)} MB. Extracting...`);

const files = unzipSync(archive);
const targetFile = files["BCCWJ_frequencylist_luw2_ver1_1.tsv"];
if (!targetFile) {
  throw new Error("Could not find BCCWJ_frequencylist_luw2_ver1_1.tsv in the archive.");
}

await Deno.mkdir(outputDir, { recursive: true });
await Deno.writeFile(temporaryFilename, targetFile);
await Deno.rename(temporaryFilename, outputFilename);

console.log(`Saved to ${outputFilename} (${(targetFile.length / 1024 / 1024).toFixed(2)} MB)`);
