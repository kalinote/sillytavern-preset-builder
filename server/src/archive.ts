import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { atomicWriteFile } from "./atomic.js";
import { ApiError } from "./errors.js";

export interface ArchiveLimits {
  maxArchiveBytes: number;
  maxUnpackedBytes: number;
  maxFileBytes: number;
  maxEntries: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxUnpackedBytes: 256 * 1024 * 1024,
  maxFileBytes: 128 * 1024 * 1024,
  maxEntries: 10_000,
};

interface ArchivePath {
  path: string;
  isDirectory: boolean;
  collisionKey: string;
}

interface ArchiveEntry {
  path: string;
  absolutePath: string;
  isDirectory: boolean;
  size: number;
  mtime: Date;
  mode: number;
}

function archiveError(code: string, message: string, details?: unknown): ApiError {
  return new ApiError(422, code, message, details);
}

function normalizeArchivePath(rawName: string): ArchivePath {
  if (!rawName || rawName.length > 1024 || rawName.includes("\0") || rawName.includes("\\")) {
    throw archiveError("INVALID_ARCHIVE_PATH", "ZIP contains an invalid entry path", { path: rawName.slice(0, 120) });
  }
  const isDirectory = rawName.endsWith("/");
  const path = isDirectory ? rawName.slice(0, -1) : rawName;
  if (!path || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    throw archiveError("INVALID_ARCHIVE_PATH", "ZIP entry must use a relative project path", { path: rawName });
  }
  const segments = path.split("/");
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.length > 255 ||
        /[<>:"|?*\u0000-\u001f]/.test(segment) ||
        /[. ]$/.test(segment) ||
        windowsReserved.test(segment),
    )
  ) {
    throw archiveError("INVALID_ARCHIVE_PATH", "ZIP entry path is unsafe on supported platforms", { path: rawName });
  }
  const normalized = segments.join("/").normalize("NFC");
  return {
    path: normalized,
    isDirectory,
    collisionKey: normalized.toLocaleLowerCase("en-US"),
  };
}

function assertNoPathConflict(
  entry: ArchivePath,
  known: Map<string, { isDirectory: boolean; path: string }>,
): void {
  const existing = known.get(entry.collisionKey);
  if (existing) {
    throw archiveError("DUPLICATE_ARCHIVE_PATH", "ZIP contains duplicate or case-colliding paths", {
      first: existing.path,
      second: entry.path,
    });
  }
  const segments = entry.collisionKey.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const ancestor = known.get(segments.slice(0, index).join("/"));
    if (ancestor && !ancestor.isDirectory) {
      throw archiveError("ARCHIVE_PATH_CONFLICT", "ZIP contains a file used as a parent directory", {
        file: ancestor.path,
        child: entry.path,
      });
    }
  }
  if (!entry.isDirectory) {
    const prefix = `${entry.collisionKey}/`;
    for (const [key, candidate] of known) {
      if (key.startsWith(prefix)) {
        throw archiveError("ARCHIVE_PATH_CONFLICT", "ZIP contains a file that conflicts with a directory", {
          file: entry.path,
          child: candidate.path,
        });
      }
    }
  }
  known.set(entry.collisionKey, { isDirectory: entry.isDirectory, path: entry.path });
}

function destinationPath(root: string, path: string): string {
  const candidate = resolve(root, ...path.split("/"));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw archiveError("INVALID_ARCHIVE_PATH", "ZIP entry escapes the staging directory", { path });
  }
  return candidate;
}

export async function extractProjectArchive(
  archive: Uint8Array,
  stagingRoot: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<{ files: number; directories: number; unpackedBytes: number }> {
  if (archive.byteLength > limits.maxArchiveBytes) {
    throw new ApiError(413, "ARCHIVE_TOO_LARGE", "Project archive exceeds the compressed size limit", {
      limit: limits.maxArchiveBytes,
      actual: archive.byteLength,
    });
  }
  if (archive.byteLength < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) {
    throw archiveError("INVALID_PROJECT_ARCHIVE", "Uploaded file is not a ZIP archive");
  }

  await mkdir(stagingRoot, { recursive: true });
  const paths = new Map<string, { isDirectory: boolean; path: string }>();
  const writes: Promise<void>[] = [];
  let entries = 0;
  let files = 0;
  let directories = 0;
  let unpackedBytes = 0;
  let declaredBytes = 0;
  let fatalError: unknown;

  const fail = (error: unknown): void => {
    if (fatalError === undefined) fatalError = error;
  };

  const unzipper = new Unzip((file) => {
    if (fatalError !== undefined) return;
    let archivePath: ArchivePath;
    try {
      entries += 1;
      if (entries > limits.maxEntries) {
        throw new ApiError(413, "ARCHIVE_ENTRY_LIMIT", "Project archive contains too many entries", {
          limit: limits.maxEntries,
        });
      }
      archivePath = normalizeArchivePath(file.name);
      assertNoPathConflict(archivePath, paths);
      if (file.originalSize !== undefined) {
        if (file.originalSize > limits.maxFileBytes) {
          throw new ApiError(413, "ARCHIVE_FILE_TOO_LARGE", "A project archive entry exceeds the file size limit", {
            path: archivePath.path,
            limit: limits.maxFileBytes,
            actual: file.originalSize,
          });
        }
        declaredBytes += file.originalSize;
        if (declaredBytes > limits.maxUnpackedBytes) {
          throw new ApiError(413, "ARCHIVE_UNPACKED_TOO_LARGE", "Project archive exceeds the unpacked size limit", {
            limit: limits.maxUnpackedBytes,
          });
        }
      }
      const absolutePath = destinationPath(stagingRoot, archivePath.path);
      if (archivePath.isDirectory) {
        directories += 1;
        writes.push(mkdir(absolutePath, { recursive: true }).then(() => undefined));
        file.ondata = (error) => {
          if (error) fail(archiveError("INVALID_PROJECT_ARCHIVE", "Failed to read ZIP directory entry"));
        };
        file.start();
        return;
      }

      files += 1;
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      file.ondata = (error, data, final) => {
        if (error) {
          fail(archiveError("INVALID_PROJECT_ARCHIVE", "Failed to decompress a ZIP entry", { path: archivePath.path }));
          return;
        }
        if (fatalError !== undefined) return;
        fileBytes += data.byteLength;
        unpackedBytes += data.byteLength;
        if (fileBytes > limits.maxFileBytes) {
          fail(new ApiError(413, "ARCHIVE_FILE_TOO_LARGE", "A project archive entry exceeds the file size limit", {
            path: archivePath.path,
            limit: limits.maxFileBytes,
          }));
          file.terminate();
          return;
        }
        if (unpackedBytes > limits.maxUnpackedBytes) {
          fail(new ApiError(413, "ARCHIVE_UNPACKED_TOO_LARGE", "Project archive exceeds the unpacked size limit", {
            limit: limits.maxUnpackedBytes,
          }));
          file.terminate();
          return;
        }
        if (data.byteLength > 0) chunks.push(Buffer.from(data));
        if (final) {
          if (file.originalSize !== undefined && fileBytes !== file.originalSize) {
            fail(archiveError("INVALID_PROJECT_ARCHIVE", "ZIP entry size does not match its metadata", {
              path: archivePath.path,
            }));
            return;
          }
          writes.push(atomicWriteFile(absolutePath, Buffer.concat(chunks, fileBytes)));
        }
      };
      file.start();
    } catch (error) {
      fail(error);
      try {
        file.terminate();
      } catch {
        // The decoder may not have been started yet.
      }
    }
  });
  unzipper.register(UnzipInflate);

  try {
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < archive.byteLength; offset += chunkSize) {
      if (fatalError !== undefined) break;
      const end = Math.min(offset + chunkSize, archive.byteLength);
      unzipper.push(archive.subarray(offset, end), end === archive.byteLength);
    }
  } catch (error) {
    fail(archiveError("INVALID_PROJECT_ARCHIVE", "Unable to parse project ZIP", {
      cause: error instanceof Error ? error.message : String(error),
    }));
  }

  const writeResults = await Promise.allSettled(writes);
  const failedWrite = writeResults.find((result) => result.status === "rejected");
  if (fatalError !== undefined) throw fatalError;
  if (failedWrite?.status === "rejected") throw failedWrite.reason;
  if (!paths.has("project.json") || paths.get("project.json")?.isDirectory) {
    throw archiveError("PROJECT_MANIFEST_REQUIRED", "Project ZIP root must contain project.json");
  }
  return { files, directories, unpackedBytes };
}

async function collectProjectEntries(
  projectRoot: string,
  limits: ArchiveLimits,
): Promise<ArchiveEntry[]> {
  const output: ArchiveEntry[] = [];
  let totalBytes = 0;

  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (/^\..+\.tmp$/.test(child.name)) continue;
      const absolutePath = join(directory, child.name);
      const details = await lstat(absolutePath);
      if (details.isSymbolicLink()) {
        throw new ApiError(422, "SYMLINK_NOT_ALLOWED", "Symbolic links cannot be included in a project archive", {
          path: relative(projectRoot, absolutePath).split(sep).join("/"),
        });
      }
      const path = relative(projectRoot, absolutePath).split(sep).join("/");
      if (!details.isDirectory() && !details.isFile()) continue;
      if (output.length + 1 > limits.maxEntries) {
        throw new ApiError(413, "ARCHIVE_ENTRY_LIMIT", "Project contains too many entries to archive", {
          limit: limits.maxEntries,
        });
      }
      if (details.isFile()) {
        if (details.size > limits.maxFileBytes) {
          throw new ApiError(413, "ARCHIVE_FILE_TOO_LARGE", "A project file exceeds the archive size limit", {
            path,
            limit: limits.maxFileBytes,
            actual: details.size,
          });
        }
        totalBytes += details.size;
        if (totalBytes > limits.maxUnpackedBytes) {
          throw new ApiError(413, "ARCHIVE_UNPACKED_TOO_LARGE", "Project exceeds the archive unpacked size limit", {
            limit: limits.maxUnpackedBytes,
          });
        }
      }
      output.push({
        path,
        absolutePath,
        isDirectory: details.isDirectory(),
        size: details.isFile() ? details.size : 0,
        mtime: details.mtime,
        mode: details.mode,
      });
      if (details.isDirectory()) await visit(absolutePath);
    }
  };

  await visit(projectRoot);
  return output;
}

function zipMtime(value: Date): Date {
  const earliest = new Date(1980, 0, 1);
  return value < earliest ? earliest : value;
}

export async function createProjectArchive(
  projectRoot: string,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<Buffer> {
  const entries = await collectProjectEntries(projectRoot, limits);
  if (!entries.some((entry) => entry.path === "project.json" && !entry.isDirectory)) {
    throw archiveError("PROJECT_MANIFEST_REQUIRED", "Project root does not contain project.json");
  }
  const chunks: Buffer[] = [];
  let compressedBytes = 0;
  let callbackError: unknown;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveDone = resolvePromise;
    rejectDone = rejectPromise;
  });
  const zip = new Zip((error, data, final) => {
    if (error) {
      callbackError = error;
      rejectDone(error);
      return;
    }
    if (callbackError !== undefined) return;
    compressedBytes += data.byteLength;
    if (compressedBytes > limits.maxArchiveBytes) {
      callbackError = new ApiError(413, "ARCHIVE_TOO_LARGE", "Generated project archive exceeds the size limit", {
        limit: limits.maxArchiveBytes,
      });
      rejectDone(callbackError);
      return;
    }
    if (data.byteLength > 0) chunks.push(Buffer.from(data));
    if (final) resolveDone();
  });

  try {
    for (const entry of entries) {
      if (callbackError !== undefined) throw callbackError;
      if (entry.isDirectory) {
        const directory = new ZipPassThrough(`${entry.path}/`);
        directory.mtime = zipMtime(entry.mtime);
        directory.os = 3;
        directory.attrs = ((entry.mode & 0xffff) << 16) | 0x10;
        zip.add(directory);
        directory.push(new Uint8Array(0), true);
        continue;
      }

      const file = new ZipDeflate(entry.path, { level: 6 });
      file.mtime = zipMtime(entry.mtime);
      file.os = 3;
      file.attrs = (entry.mode & 0xffff) << 16;
      zip.add(file);
      for await (const chunk of createReadStream(entry.absolutePath, { highWaterMark: 256 * 1024 })) {
        if (callbackError !== undefined) throw callbackError;
        file.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), false);
      }
      file.push(new Uint8Array(0), true);
    }
    zip.end();
    await done;
    return Buffer.concat(chunks, compressedBytes);
  } catch (error) {
    zip.terminate();
    throw error;
  }
}
