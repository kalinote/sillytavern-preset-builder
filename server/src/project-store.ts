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
import { installManagedSources, stageManagedSources } from "./managed-source-transaction.js";
import {
  createProjectSnapshot,
  deleteProjectSnapshot,
  listProjectSnapshots,
  readSnapshotPreset,
} from "./project-snapshots.js";
import { applyStructureMutation, readProjectStructure } from "./project-structure.js";
import { assertProjectId, resolveInsideProject, safeExportStem } from "./safety.js";
import { createBlankPreset, splitPresetProject } from "./splitter.js";
import type {
  BuildResult,
  ImportProjectInput,
  JsonObject,
  ProjectFile,
  ProjectFileEntry,
  ProjectManifest,
  ProjectSnapshotSummary,
  ProjectStructure,
  ProjectSummary,
  SnapshotReason,
  StructureMutation,
} from "./types.js";

const MAX_FILE_BYTES = 128 * 1024 * 1024;
const SOURCE_JSON_PATH = "preset.json";

interface ItemDirectoryMetadata {
  displayName: string;
  order: number;
}

export interface ProjectBuildSnapshot {
  manifest: ProjectManifest;
  build: BuildResult;
}

export interface ProjectBuildTransactionResult<T> {
  result: T;
  targetPresetName?: string;
}

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
      value.schemaVersion !== 2 ||
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
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, () => this.readManifest(projectRoot));
  }

  async updateProject(
    projectId: string,
    input: { ifProjectRevision: string; name?: string; version?: string; targetPresetName?: string },
  ): Promise<ProjectManifest> {
    if (typeof input.ifProjectRevision !== "string" || !input.ifProjectRevision) {
      throw new ApiError(400, "INVALID_INPUT", "ifProjectRevision is required");
    }
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      if (manifest.updatedAt !== input.ifProjectRevision) {
        throw new ApiError(409, "PROJECT_REVISION_CONFLICT", "Project settings changed since they were opened", {
          expected: input.ifProjectRevision,
          actual: manifest.updatedAt,
        });
      }
      const name = validateLabel(input.name, "name", 120);
      const version = validateLabel(input.version, "version", 80);
      const targetPresetName = validateLabel(input.targetPresetName, "targetPresetName", 120);
      if (name !== undefined) {
        if (!name) throw new ApiError(400, "INVALID_INPUT", "name must not be empty");
        manifest.name = name;
      }
      if (version !== undefined) manifest.version = version;
      if (targetPresetName !== undefined) {
        if (!targetPresetName) throw new ApiError(400, "INVALID_INPUT", "targetPresetName must not be empty");
        manifest.targetPresetName = targetPresetName;
      }
      manifest.updatedAt = new Date().toISOString();
      await atomicWriteFile(join(projectRoot, "project.json"), stringifyJson(manifest as unknown as JsonObject));
      return structuredClone(manifest);
    });
  }

  async getProjectStructure(projectId: string): Promise<ProjectStructure> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      return readProjectStructure(projectRoot, manifest);
    });
  }

  async mutateProjectStructure(
    projectId: string,
    input: { ifRevision: string; mutation: StructureMutation },
  ): Promise<{
    project: ProjectManifest;
    structure: ProjectStructure;
    files: ProjectFileEntry[];
    build: BuildResult;
    snapshot: ProjectSnapshotSummary | null;
    createdUid?: string;
    deletedUid?: string;
  }> {
    if (typeof input.ifRevision !== "string" || !input.ifRevision || !input.mutation) {
      throw new ApiError(400, "INVALID_INPUT", "ifRevision and mutation are required");
    }
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const currentBuild = await buildPresetProject(projectRoot);
      if (input.ifRevision !== currentBuild.revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Project changed since the structure was opened", {
          expected: input.ifRevision,
          actual: currentBuild.revision,
        });
      }

      const stagingParent = join(this.workspaceRoot, ".staging");
      const transactionId = randomUUID();
      const stagedRoot = join(stagingParent, `structure-${projectId}-${transactionId}`);
      const backupRoot = join(stagingParent, `backup-${projectId}-${transactionId}`);
      await mkdir(stagingParent, { recursive: true });
      try {
        await stageManagedSources(projectRoot, stagedRoot);
        const nextManifest = structuredClone(manifest);
        const outcome = await applyStructureMutation(stagedRoot, nextManifest, input.mutation);
        nextManifest.updatedAt = new Date().toISOString();
        await atomicWriteFile(join(stagedRoot, "project.json"), stringifyJson(nextManifest as unknown as JsonObject));
        const build = await buildPresetProject(stagedRoot);
        const structure = await readProjectStructure(stagedRoot, nextManifest, build);
        const snapshot = input.mutation.op === "delete"
          ? await createProjectSnapshot(projectRoot, currentBuild, { reason: "before-item-delete" })
          : null;
        await installManagedSources(projectRoot, stagedRoot, backupRoot);
        const files = await this.listFilesUnlocked(projectId);
        return {
          project: structuredClone(nextManifest),
          structure,
          files,
          build,
          snapshot,
          ...(outcome.createdUid === undefined ? {} : { createdUid: outcome.createdUid }),
          ...(outcome.deletedUid === undefined ? {} : { deletedUid: outcome.deletedUid }),
        };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(422, "STRUCTURE_BUILD_FAILED", "Structure mutation could not be committed", {
          cause: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await Promise.all([
          rm(stagedRoot, { recursive: true, force: true }).catch(() => undefined),
          rm(backupRoot, { recursive: true, force: true }).catch(() => undefined),
        ]);
      }
    });
  }

  async listSnapshots(projectId: string): Promise<ProjectSnapshotSummary[]> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      await this.readManifest(projectRoot);
      return listProjectSnapshots(projectRoot);
    });
  }

  async createSnapshot(
    projectId: string,
    input: { label?: string; ifRevision: string },
  ): Promise<ProjectSnapshotSummary> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      await this.readManifest(projectRoot);
      const build = await buildPresetProject(projectRoot);
      if (input.ifRevision !== build.revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Project changed before the snapshot was created", {
          expected: input.ifRevision,
          actual: build.revision,
        });
      }
      return createProjectSnapshot(projectRoot, build, {
        reason: "manual",
        ...(input.label === undefined ? {} : { label: input.label }),
      });
    });
  }

  async deleteSnapshot(projectId: string, snapshotId: string): Promise<void> {
    const projectRoot = this.projectRoot(projectId);
    await this.withProjectLock(projectId, async () => {
      await this.readManifest(projectRoot);
      await deleteProjectSnapshot(projectRoot, snapshotId);
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const projectRoot = this.projectRoot(projectId);
    await this.withProjectLock(projectId, async () => {
      await this.readManifest(projectRoot);
      await rm(projectRoot, { recursive: true, force: false });
    });
  }

  private async readItemDirectoryMetadata(projectRoot: string): Promise<Map<string, ItemDirectoryMetadata>> {
    const output = new Map<string, ItemDirectoryMetadata>();
    const groups = [
      { root: "prompts", fallback: "Prompt", secondary: "identifier" },
      { root: "regex", fallback: "Regex", secondary: "id" },
      { root: "scripts", fallback: "Script", secondary: "id" },
    ] as const;

    for (const group of groups) {
      let value: unknown;
      try {
        value = JSON.parse(await readFile(join(projectRoot, group.root, "index.json"), "utf8")) as unknown;
      } catch {
        continue;
      }
      if (!isJsonObject(value) || !Array.isArray(value.items)) continue;

      const used = new Set<string>();
      for (let index = 0; index < value.items.length; index += 1) {
        const item = value.items[index];
        if (!isJsonObject(item) || typeof item.uid !== "string" || !item.uid) continue;
        const primary = typeof item.name === "string" ? item.name.trim() : "";
        const secondaryValue = item[group.secondary];
        const secondary = typeof secondaryValue === "string" ? secondaryValue.trim() : "";
        const baseName = primary || secondary || `未命名 ${group.fallback} ${index + 1}`;
        let displayName = baseName;
        let suffix = 2;
        while (used.has(displayName)) {
          displayName = `${baseName} (${suffix})`;
          suffix += 1;
        }
        used.add(displayName);
        output.set(`${group.root}/${item.uid}`, { displayName, order: index });
      }
    }

    try {
      const snapshotIndex = JSON.parse(
        await readFile(join(projectRoot, "snapshots", "index.json"), "utf8"),
      ) as unknown;
      if (isJsonObject(snapshotIndex) && Array.isArray(snapshotIndex.items)) {
        for (let index = 0; index < snapshotIndex.items.length; index += 1) {
          const item = snapshotIndex.items[index];
          if (!isJsonObject(item) || typeof item.uid !== "string" || typeof item.label !== "string") continue;
          output.set(`snapshots/${item.uid}`, { displayName: item.label, order: index });
        }
      }
    } catch {
      // Snapshot index validation belongs to the snapshot API. A broken index
      // must not make ordinary source files inaccessible.
    }
    return output;
  }

  async listFiles(projectId: string): Promise<ProjectFileEntry[]> {
    return this.withProjectLock(projectId, () => this.listFilesUnlocked(projectId));
  }

  private async listFilesUnlocked(projectId: string): Promise<ProjectFileEntry[]> {
    const projectRoot = this.projectRoot(projectId);
    const manifest = await this.readManifest(projectRoot);
    const itemMetadata = await this.readItemDirectoryMetadata(projectRoot);
    const output: ProjectFileEntry[] = [{
      path: SOURCE_JSON_PATH,
      type: "file",
      size: 0,
      updatedAt: manifest.updatedAt,
      displayName: SOURCE_JSON_PATH,
      order: -1,
      role: "source-json",
    }];

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink() || /^\..+\.tmp$/.test(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const details = await stat(absolute);
        const path = relative(projectRoot, absolute).split(sep).join("/");
        if (path === SOURCE_JSON_PATH) continue;
        if (entry.isDirectory()) {
          const metadata = itemMetadata.get(path);
          output.push({
            path,
            type: "directory",
            size: 0,
            updatedAt: details.mtime.toISOString(),
            ...(metadata ? metadata : {}),
          });
          await visit(absolute);
        } else if (entry.isFile()) {
          output.push({ path, type: "file", size: details.size, updatedAt: details.mtime.toISOString() });
        }
      }
    };

    await visit(projectRoot);
    return output;
  }

  async readSourceJson(projectId: string): Promise<ProjectFile> {
    const snapshot = await this.getProjectBuildSnapshot(projectId);
    const content = stringifyJson(snapshot.build.preset);
    return {
      path: SOURCE_JSON_PATH,
      content,
      size: Buffer.byteLength(content),
      revision: snapshot.build.revision,
      updatedAt: snapshot.manifest.updatedAt,
      role: "source-json",
    };
  }

  async replaceSourceJson(
    projectId: string,
    input: { content: string; ifRevision: string },
  ): Promise<ProjectFile> {
    if (typeof input.content !== "string") {
      throw new ApiError(400, "INVALID_INPUT", "content must be a string");
    }
    if (Buffer.byteLength(input.content) > MAX_FILE_BYTES) {
      throw new ApiError(413, "FILE_TOO_LARGE", "Preset JSON is too large to apply");
    }
    let preset: unknown;
    try {
      preset = JSON.parse(input.content) as unknown;
    } catch (error) {
      throw new ApiError(422, "INVALID_SOURCE_JSON", "Complete preset JSON is not valid JSON", {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!isJsonObject(preset)) {
      throw new ApiError(422, "INVALID_PRESET", "Preset JSON root must be an object");
    }

    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const currentBuild = await buildPresetProject(projectRoot);
      if (input.ifRevision !== currentBuild.revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Project changed since the complete JSON was opened", {
          expected: input.ifRevision,
          actual: currentBuild.revision,
        });
      }
      return this.replacePresetUnlocked(
        projectId,
        projectRoot,
        manifest,
        currentBuild,
        preset,
        "before-source-json-apply",
      );
    });
  }

  private async replacePresetUnlocked(
    projectId: string,
    projectRoot: string,
    manifest: ProjectManifest,
    currentBuild: BuildResult,
    preset: JsonObject,
    snapshotReason: SnapshotReason,
  ): Promise<ProjectFile> {
    const stagingParent = join(this.workspaceRoot, ".staging");
    const transactionId = randomUUID();
    const stagedRoot = join(stagingParent, `source-${projectId}-${transactionId}`);
    const backupRoot = join(stagingParent, `backup-${projectId}-${transactionId}`);
    await mkdir(stagingParent, { recursive: true });

    try {
      const stagedManifest = await splitPresetProject(stagedRoot, projectId, {
        preset,
        sourceType: manifest.source.type,
        name: manifest.name,
        version: manifest.version,
        ...(manifest.source.presetName ? { sourcePresetName: manifest.source.presetName } : {}),
        ...(manifest.source.stVersion ? { sourceStVersion: manifest.source.stVersion } : {}),
      });
      const nextManifest: ProjectManifest = {
        ...stagedManifest,
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        createdAt: manifest.createdAt,
        updatedAt: new Date().toISOString(),
        source: structuredClone(manifest.source),
        targetPresetName: manifest.targetPresetName,
      };
      if (manifest.originalJsonSha256) nextManifest.originalJsonSha256 = manifest.originalJsonSha256;
      else delete nextManifest.originalJsonSha256;
      await atomicWriteFile(join(stagedRoot, "project.json"), stringifyJson(nextManifest as unknown as JsonObject));
      const stagedBuild = await buildPresetProject(stagedRoot);
      if (!semanticEqual(preset, stagedBuild.preset)) {
        throw new ApiError(500, "ROUND_TRIP_FAILED", "Applied preset did not survive semantic round trip", {
          path: firstSemanticDifference(preset, stagedBuild.preset),
        });
      }

      await createProjectSnapshot(projectRoot, currentBuild, { reason: snapshotReason });
      await installManagedSources(projectRoot, stagedRoot, backupRoot);
      const content = stringifyJson(stagedBuild.preset);
      return {
        path: SOURCE_JSON_PATH,
        content,
        size: Buffer.byteLength(content),
        revision: stagedBuild.revision,
        updatedAt: nextManifest.updatedAt,
        role: "source-json",
      };
    } finally {
      await Promise.all([
        rm(stagedRoot, { recursive: true, force: true }).catch(() => undefined),
        rm(backupRoot, { recursive: true, force: true }).catch(() => undefined),
      ]);
    }
  }

  async restoreSnapshot(
    projectId: string,
    snapshotId: string,
    input: { ifRevision: string },
  ): Promise<{ project: ProjectManifest; structure: ProjectStructure; files: ProjectFileEntry[]; build: BuildResult }> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const currentBuild = await buildPresetProject(projectRoot);
      if (input.ifRevision !== currentBuild.revision) {
        throw new ApiError(409, "REVISION_CONFLICT", "Project changed before the snapshot was restored", {
          expected: input.ifRevision,
          actual: currentBuild.revision,
        });
      }
      const preset = await readSnapshotPreset(projectRoot, snapshotId);
      await this.replacePresetUnlocked(
        projectId,
        projectRoot,
        manifest,
        currentBuild,
        preset,
        "before-snapshot-restore",
      );
      const project = await this.readManifest(projectRoot);
      const build = await buildPresetProject(projectRoot);
      return {
        project,
        structure: await readProjectStructure(projectRoot, project, build),
        files: await this.listFilesUnlocked(projectId),
        build,
      };
    });
  }

  async readProjectFile(projectId: string, relativePath: string): Promise<ProjectFile> {
    return this.withProjectLock(projectId, () => this.readProjectFileUnlocked(projectId, relativePath));
  }

  private async readProjectFileUnlocked(projectId: string, relativePath: string): Promise<ProjectFile> {
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
    if (relativePath.replaceAll("\\", "/") === SOURCE_JSON_PATH) {
      throw new ApiError(400, "RESERVED_SOURCE_PATH", "Use the source-json endpoint to apply preset.json");
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
          if (!isJsonObject(parsed) || parsed.id !== projectId || parsed.schemaVersion !== 2) {
            throw new ApiError(422, "INVALID_MANIFEST", "project.json cannot change its id or schema version");
          }
        }
      }

      await atomicWriteFile(path, input.content);
      if (relativePath.replaceAll("\\", "/") !== "project.json") {
        manifest.updatedAt = new Date().toISOString();
        await atomicWriteFile(join(projectRoot, "project.json"), stringifyJson(manifest as unknown as JsonObject));
      }
      return this.readProjectFileUnlocked(projectId, relativePath);
    });
  }

  async buildProject(projectId: string): Promise<BuildResult> {
    return (await this.getProjectBuildSnapshot(projectId)).build;
  }

  async getProjectBuildSnapshot(projectId: string): Promise<ProjectBuildSnapshot> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const build = await buildPresetProject(projectRoot);
      return { manifest: structuredClone(manifest), build: structuredClone(build) };
    });
  }

  async withProjectBuildTransaction<T>(
    projectId: string,
    operation: (snapshot: ProjectBuildSnapshot) => Promise<ProjectBuildTransactionResult<T>>,
  ): Promise<T> {
    const projectRoot = this.projectRoot(projectId);
    return this.withProjectLock(projectId, async () => {
      const manifest = await this.readManifest(projectRoot);
      const build = await buildPresetProject(projectRoot);
      const transaction = await operation({
        manifest: structuredClone(manifest),
        build: structuredClone(build),
      });
      if (transaction.targetPresetName !== undefined) {
        const targetPresetName = validateLabel(transaction.targetPresetName, "targetPresetName", 120);
        if (!targetPresetName) throw new ApiError(400, "INVALID_INPUT", "targetPresetName must not be empty");
        manifest.targetPresetName = targetPresetName;
        manifest.updatedAt = new Date().toISOString();
        await atomicWriteFile(join(projectRoot, "project.json"), stringifyJson(manifest as unknown as JsonObject));
      }
      return transaction.result;
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
      if (built.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
        throw new ApiError(422, "BUILD_HAS_ERRORS", "Project contains blocking build diagnostics", {
          diagnostics: built.diagnostics,
        });
      }
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
    return this.withProjectLock(projectId, async () => {
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
    });
  }
}
