import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeRoot = resolve(repositoryRoot, "packages", "st-live-bridge");
const manifestPath = resolve(bridgeRoot, "manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const requiredStrings = ["display_name", "js", "author", "version", "homePage"];

for (const field of requiredStrings) {
  if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
    throw new Error(`Live Bridge manifest field ${field} must be a non-empty string`);
  }
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error("Live Bridge manifest version must use x.y.z format");
}

if (!Array.isArray(manifest.requires) || !Array.isArray(manifest.optional)) {
  throw new Error("Live Bridge manifest requires and optional must be arrays");
}

if (!Number.isInteger(manifest.loading_order)) {
  throw new Error("Live Bridge manifest loading_order must be an integer");
}

if (manifest.homePage !== "https://github.com/kalinote/SPB-live-bridge") {
  throw new Error("Live Bridge manifest homePage must point to the published extension repository");
}

if (manifest.auto_update !== false) {
  throw new Error("Live Bridge auto_update must remain false while Preset Studio manages updates");
}

await access(resolve(bridgeRoot, manifest.js));
await access(resolve(bridgeRoot, "README.md"));

console.log(`Validated Preset Studio Live Bridge ${manifest.version}`);
