import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ApiError } from "./errors.js";

export const EXTENSION_ARCHIVE_FILENAME = "preset-studio-bridge.zip";
export const EXTENSION_ARCHIVE_DIRECTORY = "preset-studio-bridge";
export const EXTENSION_FILES = ["manifest.json", "index.js", "style.css", "README.md"] as const;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function unavailable(file: string): ApiError {
  return new ApiError(
    503,
    "EXTENSION_ARCHIVE_UNAVAILABLE",
    "SillyTavern Bridge extension files are unavailable in this deployment",
    { file },
  );
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function buildExtensionArchive(extensionRoot: string): Promise<Buffer> {
  const entries: Record<string, Uint8Array> = {};
  let totalBytes = 0;

  for (const file of EXTENSION_FILES) {
    const absolutePath = join(extensionRoot, file);
    let content: Buffer;
    try {
      const metadata = await lstat(absolutePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new ApiError(
          500,
          "EXTENSION_ARCHIVE_INVALID",
          "SillyTavern Bridge extension contains an invalid packaged file",
          { file },
        );
      }
      if (metadata.size > MAX_FILE_BYTES) {
        throw new ApiError(
          500,
          "EXTENSION_ARCHIVE_INVALID",
          "SillyTavern Bridge extension file exceeds the packaging limit",
          { file, maxBytes: MAX_FILE_BYTES },
        );
      }
      content = await readFile(absolutePath);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (isFileSystemError(error)) throw unavailable(file);
      throw error;
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ApiError(
        500,
        "EXTENSION_ARCHIVE_INVALID",
        "SillyTavern Bridge extension exceeds the total packaging limit",
        { maxBytes: MAX_TOTAL_BYTES },
      );
    }
    entries[`${EXTENSION_ARCHIVE_DIRECTORY}/${file}`] = content;
  }

  return Buffer.from(zipSync(entries, { level: 9 }));
}
