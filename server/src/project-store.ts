import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  createProjectArchive,
  DEFAULT_ARCHIVE_LIMITS,
  extractProjectArchive,
  type ArchiveLimits,
} from "./archive.js";
import { atomicWriteFile } from "./atomic.js";
import { buildPresetProject } from "./builder.js";
import { ApiError } from "./errors.js";
import { firstSemanticDifference, isJsonObject, semanticEqual, stableSha256, stringifyJson } from "./json.js";
import { assertProjectId, resolveInsideProject, safeExportStem } from "./safety.js";
import { createBlankPreset, splitPresetProject } from "./splitter.js";
import type {
  BuildResult,
  ImportProjectInput,
  JsonObject,
  ProjectFile,
  ProjectFileEntry,
  ProjectManifest,
  ProjectSummary,
} from "./types.js";

const MAX_FILE_BYTES = 128 * 1024 * 1024;

function toSummary(manifest: ProjectManifest): ProjectSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    source: manifest.source.type,
    targetPresetName: manifest.targetPresetName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };
}

function validateLabel(value: string | undefined, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ApiError(400, "INVALID_INPUT", `${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ApiError(400, "INVALID_INPUT", `${label} is too long`);
  return trimmed;
}

export class ProjectStore {
  readonly workspaceRoot: string;
  readonly archiveLimits: ArchiveLimits;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(workspaceRoot: string, archiveLimits: Partial<ArchiveLimits> = {}) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.archiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...archiveLimits };
  }

  async initialize(): Promise<void> {
    await mkdir(this.workspaceRoot, { recursive: true });
  }

  private projectRoot(projectId: string): string {
    return join(this.workspaceRoot, assertProjectId(projectId));
  }

  private async allocateProjectId(excludedId?: string): Promise<string> {
    for (;;) {
      const candidate = `project-${randomUUID()}`;
      if (candidate === excludedId) continue;
      try {
        await stat(join(this.workspaceRoot, candidate));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
        throw error;
      }
    }
  }

  private async withProjectLock<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    const tail = previous.then(() => current);
    this.queues.set(projectId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.queues.get(projectId) === tail) this.queues.delete(projectId);
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.initialize();
    const entries = await readdir(this.workspaceRoot, { withFileTypes: true });
    const projects: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const manifest = await this.readManifest(join(this.workspaceRoot, entry.name));
        projects.push(toSummary(manifest));
      } catch {
        // A directory without a committed project.json is an incomplete import,
        // not a discoverable project.
      }
    }
    projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return projects;
  }

  async createEmptyProject(input: { name?: string; version?: string } = {}): Promise<ProjectManifest> {
    const name = validateLabel(input.name, "name", 120);
    const version = validateLabel(input.version, "version", 80);
    return this.importProject({
      sourceType: "empty",
      preset: createBlankPreset(),
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
    });
  }

  async importProject(input: ImportProjectInput): Promise<ProjectManifest> {
    const name = validateLabel(input.name, "name", 120);
    const version = validateLabel(input.version, "version", 80);
    const sourcePresetName = validateLabel(input.sourcePresetName, "sourcePresetName", 120);
    const sourceStVersion = validateLabel(input.sourceStVersion, "sourceStVersion", 80);
    if (!isJsonObject(input.preset)) throw new ApiError(422, "INVALID_PRESET", "Preset JSON root must be an object");
    await this.initialize();
    const id = `project-${randomUUID()}`;
    const projectRoot = this.projectRoot(id);

    return this.withProjectLock(id, async () => {
      try {
        const normalizedInput: ImportProjectInput = {
          preset: input.preset,
          sourceType: input.sourceType ?? "uploaded-json",
          ...(name !== undefined ? { name } : {}),
          ...(version !== undefined ? { version } : {}),
          ...(sourcePresetName !== undefined ? { sourcePresetName } : {}),
          ...(sourceStVersion !== undefined ? { sourceStVersion } : {}),
        };
        const manifest = await splitPresetProject(projectRoot, id, normalizedInput);
        const built = await buildPresetProject(projectRoot);
        if (!semanticEqual(input.preset, built.preset)) {
          throw new ApiError(500, "ROUND_TRIP_FAILED", "Imported preset did not survive semantic round trip", {
            path: firstSemanticDifference(input.preset, built.preset),
          });
        }
        return manifest;
      } catch (error) {
        // The directory has a freshly generated unpredictable id and is removed
        // only when its creation transaction failed.
        await rm(projectRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async importProjectArchive(
    archive: Uint8Array,
    overrides: { name?: string; version?: string } = {},
  ): Promise<{ project: ProjectManifest; originalProjectId: string; idRegenerated: true }> {
    const overrideName = validateLabel(overrides.name, "name", 120);
    const overrideVersion = validateLabel(overrides.version, "version", 80);
    await this.initialize();
    const stagingParent = join(this.workspaceRoot, ".staging");
    const stagingRoot = join(stagingParent, `import-${randomUUID()}`);
    await mkdir(stagingParent, { recursive: true });

    try {
      await extractProjectArchive(archive, stagingRoot, this.archiveLimits);
      const importedManifest = await this.readManifest(stagingRoot);
      const originalProjectId = importedManifest.id;
      // Validate all managed indexes and source files before a project becomes
      // visible. Unknown project files are preserved as part of the package.
      await buildPresetProject(stagingRoot);
      const projectId = await this.allocateProjectId(originalProjectId);
      const now = new Date().toISOString();
      const project: ProjectManifest = {
        ...importedManifest,
        id: projectId,
        name: overrideName ? overrideName : importedManifest.name,
        ...(overrideVersion === undefined ? {} : { version: overrideVersion }),
        createdAt: now,
        updatedAt: now,
        source: { ...importedManifest.source, type: "project-package" },
      };
      await Promise.all([
        mkdir(join(stagingRoot, "snapshots"), { recursive: true }),
        mkdir(join(stagingRoot, "recovery"), { recursive: true }),
        mkdir(join(stagingRoot, "output"), { recursive: true }),
      ]);
      await atomicWriteFile(join(stagingRoot, "project.json"), stringifyJson(project as unknown as JsonObject));
      const finalRoot = this.projectRoot(projectId);
      await this.withProjectLock(projectId, async () => {
        await rename(stagingRoot, finalRoot);
      });
      return { project, originalProjectId, idRegenerated: true };
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readManifest(projectRoot: string): Promise<ProjectManifest> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(join(projectRoot, "project.json"), "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ApiError(404, "PROJECT_NOT_FOUND", "Project does not exist");
      }
      throw new ApiError(422, "INVALID_PROJECT", "project.json is not valid JSON");
    }
    const managedPaths = isJsonObject(value) && isJsonObject(value.managedPaths) ? value.managedPaths : undefined;
    const source = isJsonObject(value) && isJsonObject(value.source) ? value.source : undefined;
    if (
      !isJsonObject(value) ||
      value.schemaVersion !== 1 ||
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.name !== "string" ||
      typeof value.version !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string" ||
      value.buildRulesVersion !== 1 ||
      !source ||
      typeof source.type !== "string" ||
      !managedPaths ||
      typeof managedPaths.prompts !== "boolean" ||
      typeof managedPaths.promptOrder !== "boolean" ||
      typeof managedPaths.regex !== "boolean" ||
      typeof managedPaths.scripts !== "boolean"
    ) {
      throw new ApiError(422, "INVALID_PROJECT", "project.json has an unsupported structure");
    }
    return value as unknown as ProjectManifest;
  }

  async getProject(projectId: string): Promise<ProjectManifest> {
    return this.readManifest(this.projectRoot(projectId));
  }

  async listFiles(projectId: string): Promise<ProjectFileEntry[]> {
    const projectRoot = this.projectRoot(projectId);
    await this.readManifest(projectRoot);
    const output: ProjectFileEntry[] = [];

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink() || /^\..+\.tmp$/.test(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const details = await stat(absolute);
        const path = relative(projectRoot, absolute).split(sep).join("/");
        if (entry.isDirectory()) {
          output.push({ path, type: "directory", size: 0, updatedAt: details.mtime.toISOString() });
          await visit(absolute);
        } else if (entry.isFile()) {
          output.push({ path, type: "file", size: details.size, updatedAt: details.mtime.toISOString() });
        }
      }
    };

    await visit(projectRoot);
    return output;
  }

  async readProjectFile(projectId: string, relativePath: string): Promise<ProjectFile> {
    const projectRoot = this.projectRoot(projectId);
    await this.readManifest(projectRoot);
    const path = await resolveInsideProject(projectRoot, relativePath);
    let details;
    try {
      details = await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ApiError(404, "FILE_NOT_FOUND", "Project file does not exist");
      }
      throw error;
    }
    if (!details.isFile()) throw new ApiError(400, "NOT_A_FILE", "Requested project path is not a file");
    if (details.size > MAX_FILE_BYTES) throw new ApiError(413, "FILE_TOO_LARGE", "Project file is too large to edit");
    const content = await readFile(path, "utf8");
    return {
      path: relative(projectRoot, path).split(sep).join("/"),
      content,
      size: Buffer.byteLength(content),
      revision: stableSha256(content),
      updatedAt: details.mtime.toISOString(),
    };
  }

  async saveProjectFile(
    projectId: string,
    relativePath: string,
    input: { content: string; ifRevision?: string },
  ): Promise<ProjectFile> {
    if (typeof input.content !== "string") throw new ApiError(400, "INVALID_INPUT", "content must be a string");
    if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) {
      throw new ApiError(413, "FILE_TOO_LARGE", "Project file is too large to save");
    }
    const projectRoot = this.projectRoot(projectId);

    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const path = await resolveInsideProject(projectRoot, relativePath);
      if (input.ifRevision !== undefined) {
        let current: string;
        try {
          current = await readFile(path, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") current = "";
          else throw error;
        }
        const actualRevision = stableSha256(current);
        if (input.ifRevision !== actualRevision) {
          throw new ApiError(409, "REVISION_CONFLICT", "Project file changed since it was opened", {
            expected: input.ifRevision,
            actual: actualRevision,
          });
        }
      }

      if (relativePath.toLowerCase().endsWith(".json")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(input.content) as unknown;
        } catch (error) {
          throw new ApiError(422, "INVALID_JSON", "JSON project files must contain valid JSON", {
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        if (relativePath.replaceAll("\\", "/") === "project.json") {
          if (!isJsonObject(parsed) || parsed.id !== projectId || parsed.schemaVersion !== 1) {
            throw new ApiError(422, "INVALID_MANIFEST", "project.json cannot change its id or schema version");
          }
        }
      }

      await atomicWriteFile(path, input.content);
      if (relativePath.replaceAll("\\", "/") !== "project.json") {
        manifest.updatedAt = new Date().toISOString();
        await atomicWriteFile(join(projectRoot, "project.json"), stringifyJson(manifest as unknown as JsonObject));
      }
      return this.readProjectFile(projectId, relativePath);
    });
  }

  async buildProject(projectId: string): Promise<BuildResult> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      await this.readManifest(projectRoot);
      return buildPresetProject(projectRoot);
    });
  }

  async exportProject(projectId: string): Promise<{
    filename: string;
    path: string;
    size: number;
    revision: string;
    diagnostics: BuildResult["diagnostics"];
  }> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const built = await buildPresetProject(projectRoot);
      const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
      const name = safeExportStem(manifest.name);
      const version = manifest.version ? `-${safeExportStem(manifest.version)}` : "";
      const baseFilename = `${name}${version}-${timestamp}`;
      const outputRoot = join(projectRoot, "output");
      await mkdir(outputRoot, { recursive: true });
      let filename = `${baseFilename}.json`;
      let suffix = 2;
      while (true) {
        try {
          await stat(join(outputRoot, filename));
          filename = `${baseFilename}-${suffix}.json`;
          suffix += 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
          throw error;
        }
      }
      const content = stringifyJson(built.preset);
      await atomicWriteFile(join(outputRoot, filename), content);
      return {
        filename,
        path: `output/${filename}`,
        size: Buffer.byteLength(content),
        revision: stableSha256(content),
        diagnostics: built.diagnostics,
      };
    });
  }

  async listOutputs(projectId: string): Promise<ProjectFileEntry[]> {
    const files = await this.listFiles(projectId);
    return files.filter((entry) => entry.type === "file" && entry.path.startsWith("output/"));
  }

  async buildProjectArchive(projectId: string): Promise<{ filename: string; content: Buffer }> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      // A downloadable project must also be buildable; this prevents handing
      // users a package whose indexes already point at missing source files.
      await buildPresetProject(projectRoot);
      const version = manifest.version ? `-${safeExportStem(manifest.version)}` : "";
      return {
        filename: `${safeExportStem(manifest.name)}${version}-project.zip`,
        content: await createProjectArchive(projectRoot, this.archiveLimits),
      };
    });
  }

  async readOutput(projectId: string, filename: string): Promise<{ filename: string; content: Buffer }> {
    if (basename(filename) !== filename || !filename.toLowerCase().endsWith(".json")) {
      throw new ApiError(400, "INVALID_OUTPUT_NAME", "Invalid output filename");
    }
    const projectRoot = this.projectRoot(projectId);
    await this.readManifest(projectRoot);
    const outputPath = await resolveInsideProject(projectRoot, `output/${filename}`);
    try {
      return { filename, content: await readFile(outputPath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ApiError(404, "OUTPUT_NOT_FOUND", "Exported preset does not exist");
      }
      throw error;
    }
  }
}
