import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MANAGED_SOURCE_PATHS = [
  "preset.settings.json",
  "preset.prompt-fields.json",
  "extensions",
  "prompts",
  "regex",
  "scripts",
  "project.json",
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  const retryable = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
  let delay = 15;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 6 || !retryable.has(code)) throw error;
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delay));
      delay *= 2;
    }
  }
}

async function installPreparedPath(source: string, destination: string): Promise<void> {
  try {
    await renameWithRetry(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!new Set(["EPERM", "EACCES", "ENOTSUP"]).has(code)) throw error;
    // Some Windows-backed workspace volumes allow moving the current tree to
    // backup but reject installing a prepared directory with rename. The
    // project lock and backup still give operation-level rollback; project.json
    // remains the final commit marker.
    await cp(source, destination, { recursive: true, force: false });
    await rm(source, { recursive: true, force: true });
  }
}

async function moveCurrentToBackup(source: string, destination: string): Promise<void> {
  try {
    await renameWithRetry(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!new Set(["EPERM", "EACCES", "ENOTSUP"]).has(code)) throw error;
    await cp(source, destination, { recursive: true, force: false });
    await rm(source, { recursive: true, force: true });
  }
}

export async function stageManagedSources(projectRoot: string, stagedRoot: string): Promise<void> {
  await mkdir(stagedRoot, { recursive: true });
  for (const managedPath of MANAGED_SOURCE_PATHS) {
    const source = join(projectRoot, managedPath);
    if (!await pathExists(source)) continue;
    await cp(source, join(stagedRoot, managedPath), { recursive: true, force: false });
  }
}

export async function installManagedSources(
  projectRoot: string,
  stagedRoot: string,
  backupRoot: string,
): Promise<void> {
  await mkdir(backupRoot, { recursive: true });
  const originalPaths = new Set<string>();
  const installedPaths = new Set<string>();
  const preparedPaths = new Map<string, string>();

  try {
    // On Windows, moving a directory from the workspace staging root into a
    // watched project directory can fail with EPERM. Prepare hidden siblings
    // inside the project first, then the final rename stays within one parent
    // directory and remains atomic.
    for (const managedPath of MANAGED_SOURCE_PATHS) {
      const stagedPath = join(stagedRoot, managedPath);
      if (!await pathExists(stagedPath)) continue;
      const preparedPath = join(projectRoot, `.${managedPath}.${randomUUID()}.next`);
      await cp(stagedPath, preparedPath, { recursive: true, force: false });
      preparedPaths.set(managedPath, preparedPath);
    }

    for (const managedPath of MANAGED_SOURCE_PATHS) {
      const currentPath = join(projectRoot, managedPath);
      const backupPath = join(backupRoot, managedPath);
      if (await pathExists(currentPath)) {
        await mkdir(resolve(backupPath, ".."), { recursive: true });
        await moveCurrentToBackup(currentPath, backupPath);
        originalPaths.add(managedPath);
      }
      const preparedPath = preparedPaths.get(managedPath);
      if (preparedPath) {
        installedPaths.add(managedPath);
        await installPreparedPath(preparedPath, currentPath);
      }
    }
  } catch (error) {
    for (const managedPath of [...MANAGED_SOURCE_PATHS].reverse()) {
      const currentPath = join(projectRoot, managedPath);
      const backupPath = join(backupRoot, managedPath);
      if (installedPaths.has(managedPath)) {
        await rm(currentPath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (originalPaths.has(managedPath) && await pathExists(backupPath)) {
        await installPreparedPath(backupPath, currentPath).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    await Promise.all(
      [...preparedPaths.values()].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined)),
    );
  }
}
