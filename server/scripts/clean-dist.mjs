import { rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(serverRoot, "dist");
const relativeOutput = relative(serverRoot, outputPath);

if (!relativeOutput || relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
  throw new Error("Refusing to clean a build path outside the server directory");
}

await rm(outputPath, { recursive: true, force: true });
