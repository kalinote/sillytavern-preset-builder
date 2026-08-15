import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ApiError } from "./errors.js";

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{5,79}$/;

export function assertProjectId(value: string): string {
  if (!PROJECT_ID_PATTERN.test(value)) {
    throw new ApiError(400, "INVALID_PROJECT_ID", "Invalid project id");
  }
  return value;
}

export function normalizeProjectFilePath(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ApiError(400, "INVALID_PATH", "File path contains invalid URL encoding");
  }

  const normalized = decoded.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    decoded.includes("\0") ||
    isAbsolute(decoded) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ApiError(400, "INVALID_PATH", "File path must be a safe project-relative path");
  }
  return segments.join("/");
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot));
}

export async function resolveInsideProject(projectRoot: string, relativePath: string): Promise<string> {
  const safeRelativePath = normalizeProjectFilePath(relativePath);
  const absoluteRoot = resolve(projectRoot);
  const candidate = resolve(absoluteRoot, safeRelativePath);
  if (!isInside(absoluteRoot, candidate)) {
    throw new ApiError(400, "INVALID_PATH", "Resolved path escapes the project directory");
  }

  // Reject any existing symlink component. This prevents a project package or a
  // manually mounted workspace from redirecting reads/writes outside the project.
  const segments = safeRelativePath.split("/");
  let cursor = absoluteRoot;
  for (const segment of segments.slice(0, -1)) {
    cursor = resolve(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) {
        throw new ApiError(400, "SYMLINK_NOT_ALLOWED", "Symbolic links are not allowed in projects");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }

  try {
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink()) {
      throw new ApiError(400, "SYMLINK_NOT_ALLOWED", "Symbolic links are not allowed in projects");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  // Resolve the root when possible so a workspace root symlink remains usable,
  // while individual project entries remain protected by the checks above.
  await realpath(absoluteRoot).catch(() => absoluteRoot);
  return candidate;
}

export function safeExportStem(value: string): string {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "preset";
}
