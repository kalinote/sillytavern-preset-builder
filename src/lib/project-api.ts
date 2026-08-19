export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ProjectSource =
  | "sillytavern"
  | "uploaded-json"
  | "uploaded-archive"
  | "empty"
  | (string & {});

export interface ProjectSummary {
  id: string;
  name: string;
  version: string | null;
  source: ProjectSource;
  createdAt: string;
  updatedAt: string;
}

export interface Project extends ProjectSummary {
  schemaVersion?: string | number;
  sourceStVersion?: string | null;
  sourcePresetName?: string | null;
  targetPresetName?: string | null;
  originalHash?: string | null;
  buildRulesVersion?: string | number;
  preview: ProjectPreviewSettings;
  regexMirrorBinding?: RegexMirrorBinding;
}

export interface ProjectPreviewSettings {
  javascriptEnabled: boolean;
}

export interface RegexMirrorBinding {
  authority: string;
  targets: string[];
  consistent: boolean;
  promptIdentifier?: string;
}

export interface PreviewRuntimeScript {
  uid: string;
  id: string;
  name: string;
  index: number;
  enabled: boolean;
  executable: boolean;
  path: string;
  byteLength: number;
  contentHash: string;
}

export interface PreviewRuntimeRegex {
  uid: string;
  id: string;
  name: string;
  index: number;
  disabled: boolean;
  runOnEdit: boolean;
  findPath: string;
  replacePath: string;
  metaPath: string;
}

export interface PreviewRuntimeManifest {
  projectId: string;
  projectUpdatedAt: string;
  javascriptEnabled: boolean;
  scripts: PreviewRuntimeScript[];
  regexScripts: PreviewRuntimeRegex[];
  totalEnabledScriptBytes: number;
  compatibility: {
    spresetPresent: boolean;
    promptTemplateHints: string[];
  };
}

export type ProjectFileKind = "file" | "directory";

/** A flat entry returned by the project file index. */
export interface ProjectFileEntry {
  path: string;
  name: string;
  kind: ProjectFileKind;
  size: number | null;
  revision: string | null;
  updatedAt: string | null;
  language?: string;
  displayName?: string;
  order?: number;
  role?: "source-json";
}

export interface ProjectFile extends ProjectFileEntry {
  kind: "file";
  content: string;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ProjectDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  path?: string;
  line?: number;
  column?: number;
  details?: JsonValue;
}

export interface BuildArtifact {
  /** Present only when the build was persisted as an output artifact. */
  filename?: string;
  size: number;
  revision: string;
}

export type ProjectItemKind = "prompt" | "regex" | "script";

export interface PromptStructureItem {
  kind: "prompt";
  uid: string;
  order: number;
  name?: string;
  identifier?: string;
  role?: string;
  enabled?: boolean;
  marker?: JsonValue;
}

export interface RegexStructureItem {
  kind: "regex";
  uid: string;
  order: number;
  name?: string;
  id?: string;
  disabled?: boolean;
  runOnEdit?: boolean;
  placement?: JsonValue;
  minDepth?: number;
  maxDepth?: number;
}

export interface ScriptStructureItem {
  kind: "script";
  uid: string;
  order: number;
  name?: string;
  id?: string;
  enabled?: boolean;
}

export interface ProjectStructure {
  projectId: string;
  projectRevision: string;
  revision: string;
  prompts: PromptStructureItem[];
  regex: RegexStructureItem[];
  scripts: ScriptStructureItem[];
  promptOrder: JsonValue[];
}

export type StructureMutation =
  | { op: "create"; kind: ProjectItemKind; afterUid?: string; template?: "blank" }
  | { op: "duplicate"; kind: ProjectItemKind; uid: string }
  | { op: "patch"; kind: ProjectItemKind; uid: string; patch: Record<string, JsonValue> }
  | { op: "delete"; kind: ProjectItemKind; uid: string; removePromptOrderReferences?: boolean }
  | { op: "reorder"; kind: ProjectItemKind; uids: string[] }
  | { op: "set-prompt-order"; promptOrder: JsonValue[] };

export interface ProjectSnapshotSummary {
  uid: string;
  label: string;
  kind: "manual" | "automatic";
  reason: "manual" | "before-item-delete" | "before-source-json-apply" | "before-snapshot-restore";
  createdAt: string;
  presetRevision: string;
  size: number;
}

export interface StructureMutationResult {
  project: Project;
  structure: ProjectStructure;
  files: ProjectFileEntry[];
  build: { revision: string; size: number; diagnostics: ProjectDiagnostic[] };
  snapshot: ProjectSnapshotSummary | null;
  createdUid?: string;
  deletedUid?: string;
}

export interface SnapshotRestoreResult {
  project: Project;
  structure: ProjectStructure;
  files: ProjectFileEntry[];
  build: { revision: string; size: number; diagnostics: ProjectDiagnostic[] };
}

export interface ProjectBuildResult {
  success: boolean;
  preset: JsonValue;
  diagnostics: ProjectDiagnostic[];
  artifact: BuildArtifact | null;
}

interface ProjectExportBase {
  success: boolean;
  filename: string;
  size: number;
  revision: string | null;
  diagnostics: ProjectDiagnostic[];
}

export interface ProjectExportMetadata extends ProjectExportBase {
  kind: "metadata";
  downloadUrl: string;
}

export interface ProjectExportDownload extends ProjectExportBase {
  kind: "download";
  downloadUrl: null;
  blob: Blob;
}

export type ProjectExportResult =
  | ProjectExportMetadata
  | ProjectExportDownload;

export interface CreateProjectInput {
  name: string;
  version?: string | null;
  preview?: ProjectPreviewSettings;
}

export interface CreateProjectFromStInput {
  presetName: string;
  name?: string;
  version?: string | null;
  preview?: ProjectPreviewSettings;
}

export interface ImportProjectInput {
  name?: string;
  version?: string | null;
  preview?: ProjectPreviewSettings;
}

export interface ImportProjectArchiveInput {
  /** Optional overrides for the manifest stored inside the package. */
  name?: string;
  version?: string | null;
  javascriptPolicy?: "preserve" | "force-disabled" | "force-enabled";
}

export interface ProjectArchiveImportMetadata {
  originalProjectId: string;
  idRegenerated: boolean;
}

export interface ProjectArchiveImportResult {
  project: Project;
  import: ProjectArchiveImportMetadata;
}

export interface ProjectArchiveDownload {
  blob: Blob;
  filename: string;
  size: number;
  contentType: string;
}

export interface UpdateProjectFileInput {
  content: string;
  /** Last revision observed by the editor. Sent as `ifRevision` on the wire. */
  revision?: string | null;
}

export interface UpdateProjectInput {
  ifProjectRevision: string;
  name?: string;
  version?: string;
  targetPresetName?: string;
  preview?: ProjectPreviewSettings;
}

export interface BuildProjectInput {
  validateOnly?: boolean;
}

export interface ExportProjectInput {
  version?: string | null;
  filename?: string;
}

export interface ProjectRequestOptions {
  signal?: AbortSignal;
}

export interface ProjectApi {
  listProjects(options?: ProjectRequestOptions): Promise<ProjectSummary[]>;
  createProject(
    input: CreateProjectInput,
    options?: ProjectRequestOptions,
  ): Promise<Project>;
  createProjectFromSt(
    input: CreateProjectFromStInput,
    options?: ProjectRequestOptions,
  ): Promise<Project>;
  importProjectJson(
    file: File,
    input?: ImportProjectInput,
    options?: ProjectRequestOptions,
  ): Promise<Project>;
  importProjectArchive(
    file: File,
    input?: ImportProjectArchiveInput,
    options?: ProjectRequestOptions,
  ): Promise<ProjectArchiveImportResult>;
  getProject(
    projectId: string,
    options?: ProjectRequestOptions,
  ): Promise<Project>;
  getPreviewRuntimeManifest(
    projectId: string,
    options?: ProjectRequestOptions,
  ): Promise<PreviewRuntimeManifest>;
  updateProject(
    projectId: string,
    input: UpdateProjectInput,
    options?: ProjectRequestOptions,
  ): Promise<Project>;
  deleteProject(
    projectId: string,
    options?: ProjectRequestOptions,
  ): Promise<void>;
  listProjectFiles(
    projectId: string,
    options?: ProjectRequestOptions,
  ): Promise<ProjectFileEntry[]>;
  getProjectFile(
    projectId: string,
    path: string,
    options?: ProjectRequestOptions,
  ): Promise<ProjectFile>;
  updateProjectFile(
    projectId: string,
    path: string,
    input: UpdateProjectFileInput,
    options?: ProjectRequestOptions,
  ): Promise<ProjectFile>;
  getProjectStructure(projectId: string, options?: ProjectRequestOptions): Promise<ProjectStructure>;
  mutateProjectStructure(
    projectId: string,
    ifRevision: string,
    mutation: StructureMutation,
    options?: ProjectRequestOptions,
  ): Promise<StructureMutationResult>;
  listSnapshots(projectId: string, options?: ProjectRequestOptions): Promise<ProjectSnapshotSummary[]>;
  createSnapshot(
    projectId: string,
    input: { ifRevision: string; label?: string },
    options?: ProjectRequestOptions,
  ): Promise<ProjectSnapshotSummary>;
  restoreSnapshot(
    projectId: string,
    snapshotId: string,
    ifRevision: string,
    options?: ProjectRequestOptions,
  ): Promise<SnapshotRestoreResult>;
  deleteSnapshot(projectId: string, snapshotId: string, options?: ProjectRequestOptions): Promise<void>;
  buildProject(
    projectId: string,
    input?: BuildProjectInput,
    options?: ProjectRequestOptions,
  ): Promise<ProjectBuildResult>;
  exportProject(
    projectId: string,
    input?: ExportProjectInput,
    options?: ProjectRequestOptions,
  ): Promise<ProjectExportResult>;
  downloadProjectArchive(
    projectId: string,
    options?: ProjectRequestOptions,
  ): Promise<ProjectArchiveDownload>;
}

export interface ProjectApiClientOptions {
  /** URL prefix for deployments where the API is hosted on another origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ProjectApiErrorOptions {
  method: string;
  url: string;
  status: number;
  statusText?: string;
  code?: string;
  details?: unknown;
  requestId?: string | null;
  cause?: unknown;
}

export class ProjectApiError extends Error {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId: string | null;

  constructor(message: string, options: ProjectApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProjectApiError";
    this.method = options.method;
    this.url = options.url;
    this.status = options.status;
    this.statusText = options.statusText ?? "";
    this.code = options.code ?? "PROJECT_API_ERROR";
    this.details = options.details;
    this.requestId = options.requestId ?? null;
  }

  get isRevisionConflict() {
    return this.status === 409 || this.code === "REVISION_CONFLICT";
  }
}

const API_ROOT = "/api/projects";

function encodeProjectId(projectId: string) {
  const value = projectId.trim();
  if (!value) throw new TypeError("projectId must not be empty");
  return encodeURIComponent(value);
}

function encodeProjectFilePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/");

  if (
    !normalized ||
    segments.some(
      (segment) =>
        !segment || segment === "." || segment === ".." || segment.includes("\0"),
    )
  ) {
    throw new TypeError(`Invalid project file path: ${path}`);
  }

  return segments.map(encodeURIComponent).join("/");
}

/** Keep all backend route knowledge here so route changes do not leak into UI code. */
export const PROJECT_API_ENDPOINTS = {
  projects: API_ROOT,
  createFromSt: `${API_ROOT}/create-from-st`,
  importJson: `${API_ROOT}/import/json`,
  importArchive: `${API_ROOT}/import/archive`,
  project: (projectId: string) => `${API_ROOT}/${encodeProjectId(projectId)}`,
  previewRuntimeManifest: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/preview/runtime-manifest`,
  sourceJson: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/source-json`,
  files: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/files`,
  file: (projectId: string, path: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/files/${encodeProjectFilePath(path)}`,
  build: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/build`,
  exportProject: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/export`,
  archive: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/archive`,
  structure: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/structure`,
  mutations: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/structure/mutations`,
  snapshots: (projectId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/snapshots`,
  snapshot: (projectId: string, snapshotId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/snapshots/${encodeURIComponent(snapshotId)}`,
  restoreSnapshot: (projectId: string, snapshotId: string) =>
    `${API_ROOT}/${encodeProjectId(projectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
} as const;

interface ApiResponse {
  payload: unknown;
  response: Response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string,
) {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unwrap(payload: unknown, key: string) {
  return isRecord(payload) && key in payload ? payload[key] : payload;
}

function parseRegexMirrorBinding(value: unknown): RegexMirrorBinding | undefined {
  if (
    !isRecord(value)
    || typeof value.authority !== "string"
    || !Array.isArray(value.targets)
    || !value.targets.every((target) => typeof target === "string")
    || typeof value.consistent !== "boolean"
  ) return undefined;

  return {
    authority: value.authority,
    targets: value.targets,
    consistent: value.consistent,
    ...(typeof value.promptIdentifier === "string" ? { promptIdentifier: value.promptIdentifier } : {}),
  };
}

function parseProject(value: unknown): Project {
  if (!isRecord(value)) throw new TypeError("Project response must be an object");

  const schemaVersion = value.schemaVersion;
  const buildRulesVersion = value.buildRulesVersion;
  const sourceRecord = isRecord(value.source) ? value.source : null;
  const previewRecord = isRecord(value.preview) ? value.preview : null;
  const regexMirrorBinding = parseRegexMirrorBinding(value.regexMirrorBinding);
  const source =
    typeof value.source === "string"
      ? value.source
      : typeof sourceRecord?.type === "string"
        ? sourceRecord.type
        : ("empty" as const);

  return {
    id: requiredString(value, "id", "project"),
    name: requiredString(value, "name", "project"),
    version: optionalString(value.version),
    source,
    createdAt: requiredString(value, "createdAt", "project"),
    updatedAt: requiredString(value, "updatedAt", "project"),
    ...(typeof schemaVersion === "string" || typeof schemaVersion === "number"
      ? { schemaVersion }
      : {}),
    sourceStVersion:
      optionalString(value.sourceStVersion) ?? optionalString(sourceRecord?.stVersion),
    sourcePresetName:
      optionalString(value.sourcePresetName) ?? optionalString(sourceRecord?.presetName),
    targetPresetName: optionalString(value.targetPresetName),
    originalHash:
      optionalString(value.originalHash) ?? optionalString(value.originalJsonSha256),
    ...(typeof buildRulesVersion === "string" ||
    typeof buildRulesVersion === "number"
      ? { buildRulesVersion }
      : {}),
    preview: {
      javascriptEnabled: previewRecord?.javascriptEnabled === true,
    },
    ...(regexMirrorBinding ? { regexMirrorBinding } : {}),
  };
}

function parseProjectSummary(value: unknown): ProjectSummary {
  const project = parseProject(value);
  return {
    id: project.id,
    name: project.name,
    version: project.version,
    source: project.source,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function parsePreviewRuntimeManifest(value: unknown): PreviewRuntimeManifest {
  if (!isRecord(value) || !Array.isArray(value.scripts) || !Array.isArray(value.regexScripts)) {
    throw new TypeError("Preview runtime manifest response has an unsupported structure");
  }
  const scripts = value.scripts.map((item, index): PreviewRuntimeScript => {
    if (!isRecord(item)) throw new TypeError(`preview scripts[${index}] must be an object`);
    return {
      uid: requiredString(item, "uid", `preview scripts[${index}]`),
      id: requiredString(item, "id", `preview scripts[${index}]`),
      name: requiredString(item, "name", `preview scripts[${index}]`),
      index: optionalNumber(item.index) ?? index,
      enabled: item.enabled === true,
      executable: item.executable === true,
      path: requiredString(item, "path", `preview scripts[${index}]`),
      byteLength: optionalNumber(item.byteLength) ?? 0,
      contentHash: requiredString(item, "contentHash", `preview scripts[${index}]`),
    };
  });
  const regexScripts = value.regexScripts.map((item, index): PreviewRuntimeRegex => {
    if (!isRecord(item)) throw new TypeError(`preview regexScripts[${index}] must be an object`);
    return {
      uid: requiredString(item, "uid", `preview regexScripts[${index}]`),
      id: requiredString(item, "id", `preview regexScripts[${index}]`),
      name: requiredString(item, "name", `preview regexScripts[${index}]`),
      index: optionalNumber(item.index) ?? index,
      disabled: item.disabled === true,
      runOnEdit: item.runOnEdit === true,
      findPath: requiredString(item, "findPath", `preview regexScripts[${index}]`),
      replacePath: requiredString(item, "replacePath", `preview regexScripts[${index}]`),
      metaPath: requiredString(item, "metaPath", `preview regexScripts[${index}]`),
    };
  });
  const compatibility = isRecord(value.compatibility) ? value.compatibility : {};
  return {
    projectId: requiredString(value, "projectId", "preview manifest"),
    projectUpdatedAt: requiredString(value, "projectUpdatedAt", "preview manifest"),
    javascriptEnabled: value.javascriptEnabled === true,
    scripts,
    regexScripts,
    totalEnabledScriptBytes: optionalNumber(value.totalEnabledScriptBytes) ?? 0,
    compatibility: {
      spresetPresent: compatibility.spresetPresent === true,
      promptTemplateHints: Array.isArray(compatibility.promptTemplateHints)
        ? compatibility.promptTemplateHints.filter((item): item is string => typeof item === "string")
        : [],
    },
  };
}

function parseFileEntry(value: unknown): ProjectFileEntry {
  if (typeof value === "string") {
    const path = value.replaceAll("\\", "/");
    return {
      path,
      name: path.split("/").at(-1) ?? path,
      kind: "file",
      size: null,
      revision: null,
      updatedAt: null,
    };
  }

  if (!isRecord(value)) {
    throw new TypeError("Project file entry must be an object or path string");
  }

  const path = requiredString(value, "path", "file").replaceAll("\\", "/");
  const wireKind = value.kind ?? value.type;
  const kind: ProjectFileKind =
    wireKind === "directory" || value.isDirectory === true ? "directory" : "file";

  return {
    path,
    name:
      typeof value.name === "string" && value.name
        ? value.name
        : (path.split("/").at(-1) ?? path),
    kind,
    size: optionalNumber(value.size),
    revision: optionalString(value.revision),
    updatedAt: optionalString(value.updatedAt),
    ...(typeof value.language === "string" ? { language: value.language } : {}),
    ...(typeof value.displayName === "string" && value.displayName
      ? { displayName: value.displayName }
      : {}),
    ...(typeof value.order === "number" && Number.isFinite(value.order)
      ? { order: value.order }
      : {}),
    ...(value.role === "source-json" ? { role: "source-json" as const } : {}),
  };
}

function parseProjectFile(
  value: unknown,
  fallback: { path: string; content?: string; revision?: string | null },
): ProjectFile {
  if (typeof value === "string") {
    const entry = parseFileEntry(fallback.path);
    return { ...entry, kind: "file", content: value };
  }

  if (!isRecord(value)) {
    if (fallback.content === undefined) {
      throw new TypeError("Project file response must contain file content");
    }
    const entry = parseFileEntry(fallback.path);
    return {
      ...entry,
      kind: "file",
      content: fallback.content,
      revision: fallback.revision ?? null,
    };
  }

  const path =
    typeof value.path === "string" && value.path ? value.path : fallback.path;
  const entry = parseFileEntry({ ...value, path, kind: "file" });
  let content: string;

  if (typeof value.content === "string") {
    content = value.content;
  } else if (fallback.content !== undefined) {
    content = fallback.content;
  } else {
    // This also supports servers that return a JSON file as the raw response.
    content = JSON.stringify(value, null, 2);
  }

  return {
    ...entry,
    kind: "file",
    content,
    revision: optionalString(value.revision) ?? fallback.revision ?? null,
  };
}

function parseDiagnostic(value: unknown): ProjectDiagnostic {
  if (!isRecord(value)) {
    return { severity: "error", message: String(value) };
  }

  const wireSeverity = value.severity ?? value.level;
  const severity: DiagnosticSeverity =
    wireSeverity === "warning" || wireSeverity === "info"
      ? wireSeverity
      : "error";

  return {
    severity,
    message:
      typeof value.message === "string" ? value.message : "Unknown diagnostic",
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.path === "string" ? { path: value.path } : {}),
    ...(typeof value.line === "number" ? { line: value.line } : {}),
    ...(typeof value.column === "number" ? { column: value.column } : {}),
    ...(value.details !== undefined
      ? { details: value.details as JsonValue }
      : {}),
  };
}

function parseDiagnostics(value: unknown) {
  return Array.isArray(value) ? value.map(parseDiagnostic) : [];
}

function parseSnapshot(value: unknown): ProjectSnapshotSummary {
  if (!isRecord(value)) throw new TypeError("Snapshot response must be an object");
  const kind = value.kind === "automatic" ? "automatic" : "manual";
  const reasons = new Set([
    "manual",
    "before-item-delete",
    "before-source-json-apply",
    "before-snapshot-restore",
  ]);
  const reason = typeof value.reason === "string" && reasons.has(value.reason)
    ? value.reason as ProjectSnapshotSummary["reason"]
    : "manual";
  return {
    uid: requiredString(value, "uid", "snapshot"),
    label: requiredString(value, "label", "snapshot"),
    kind,
    reason,
    createdAt: requiredString(value, "createdAt", "snapshot"),
    presetRevision: requiredString(value, "presetRevision", "snapshot"),
    size: optionalNumber(value.size) ?? 0,
  };
}

function parseStructureItem(value: unknown, kind: "prompt"): PromptStructureItem;
function parseStructureItem(value: unknown, kind: "regex"): RegexStructureItem;
function parseStructureItem(value: unknown, kind: "script"): ScriptStructureItem;
function parseStructureItem(value: unknown, kind: ProjectItemKind) {
  if (!isRecord(value)) throw new TypeError(`${kind} structure item must be an object`);
  const base = {
    kind,
    uid: requiredString(value, "uid", `${kind} item`),
    order: optionalNumber(value.order) ?? 0,
  };
  if (kind === "prompt") {
    return {
      ...base,
      kind,
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.identifier === "string" ? { identifier: value.identifier } : {}),
      ...(typeof value.role === "string" ? { role: value.role } : {}),
      ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
      ...(value.marker === undefined ? {} : { marker: value.marker as JsonValue }),
    } satisfies PromptStructureItem;
  }
  if (kind === "regex") {
    return {
      ...base,
      kind,
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      ...(typeof value.disabled === "boolean" ? { disabled: value.disabled } : {}),
      ...(typeof value.runOnEdit === "boolean" ? { runOnEdit: value.runOnEdit } : {}),
      ...(value.placement === undefined ? {} : { placement: value.placement as JsonValue }),
      ...(typeof value.minDepth === "number" ? { minDepth: value.minDepth } : {}),
      ...(typeof value.maxDepth === "number" ? { maxDepth: value.maxDepth } : {}),
    } satisfies RegexStructureItem;
  }
  return {
    ...base,
    kind,
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
  } satisfies ScriptStructureItem;
}

function parseProjectStructure(value: unknown): ProjectStructure {
  if (!isRecord(value)) throw new TypeError("Project structure response must be an object");
  if (!Array.isArray(value.prompts) || !Array.isArray(value.regex) || !Array.isArray(value.scripts)) {
    throw new TypeError("Project structure collections must be arrays");
  }
  return {
    projectId: requiredString(value, "projectId", "structure"),
    projectRevision: requiredString(value, "projectRevision", "structure"),
    revision: requiredString(value, "revision", "structure"),
    prompts: value.prompts.map((item) => parseStructureItem(item, "prompt")),
    regex: value.regex.map((item) => parseStructureItem(item, "regex")),
    scripts: value.scripts.map((item) => parseStructureItem(item, "script")),
    promptOrder: Array.isArray(value.promptOrder) ? value.promptOrder as JsonValue[] : [],
  };
}

function parseBuildSummary(value: unknown) {
  if (!isRecord(value)) throw new TypeError("Build summary must be an object");
  return {
    revision: requiredString(value, "revision", "build"),
    size: optionalNumber(value.size) ?? 0,
    diagnostics: parseDiagnostics(value.diagnostics),
  };
}

function parseMutationResult(value: unknown): StructureMutationResult {
  if (!isRecord(value)) throw new TypeError("Mutation response must be an object");
  const files = value.files;
  if (!Array.isArray(files)) throw new TypeError("Mutation response files must be an array");
  return {
    project: parseProject(value.project),
    structure: parseProjectStructure(value.structure),
    files: files.map(parseFileEntry),
    build: parseBuildSummary(value.build),
    snapshot: value.snapshot == null ? null : parseSnapshot(value.snapshot),
    ...(typeof value.createdUid === "string" ? { createdUid: value.createdUid } : {}),
    ...(typeof value.deletedUid === "string" ? { deletedUid: value.deletedUid } : {}),
  };
}

function parseSnapshotRestoreResult(value: unknown): SnapshotRestoreResult {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new TypeError("Snapshot restore response must be an object");
  }
  return {
    project: parseProject(value.project),
    structure: parseProjectStructure(value.structure),
    files: value.files.map(parseFileEntry),
    build: parseBuildSummary(value.build),
  };
}

function parseBuildResult(value: unknown): ProjectBuildResult {
  if (!isRecord(value)) throw new TypeError("Build response must be an object");

  let artifact: BuildArtifact | null = null;
  if (isRecord(value.artifact)) {
    artifact = {
      ...(typeof value.artifact.filename === "string"
        ? { filename: value.artifact.filename }
        : {}),
      size: optionalNumber(value.artifact.size) ?? 0,
      revision: requiredString(value.artifact, "revision", "artifact"),
    };
  }
  if (artifact === null && typeof value.revision === "string") {
    artifact = {
      size: optionalNumber(value.size) ?? 0,
      revision: value.revision,
    };
  }

  return {
    success: value.success !== false,
    preset: (value.preset ?? null) as JsonValue,
    diagnostics: parseDiagnostics(value.diagnostics),
    artifact,
  };
}

function parseExportMetadata(value: unknown): ProjectExportMetadata {
  if (!isRecord(value)) throw new TypeError("Export response must be an object");

  return {
    kind: "metadata",
    success: value.success !== false,
    filename: requiredString(value, "filename", "export"),
    size: optionalNumber(value.size) ?? 0,
    revision: optionalString(value.revision),
    downloadUrl: requiredString(value, "downloadUrl", "export"),
    diagnostics: parseDiagnostics(value.diagnostics),
  };
}

function parseArchiveImportResult(value: unknown): ProjectArchiveImportResult {
  if (!isRecord(value)) {
    throw new TypeError("Project archive import response must be an object");
  }

  const importedProject = parseProject(unwrap(value, "project"));
  const metadata = isRecord(value.import) ? value.import : {};
  return {
    project: importedProject,
    import: {
      originalProjectId:
        typeof metadata.originalProjectId === "string"
          ? metadata.originalProjectId
          : importedProject.id,
      idRegenerated: metadata.idRegenerated !== false,
    },
  };
}

function filenameFromDisposition(value: string | null) {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  if (
    contentType.includes("json") ||
    text.startsWith("{") ||
    text.startsWith("[")
  ) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (contentType.includes("json")) {
        throw new TypeError("Server returned malformed JSON");
      }
    }
  }
  return text;
}

function apiErrorFromResponse(
  method: string,
  url: string,
  response: Response,
  payload: unknown,
) {
  const envelope =
    isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
  const error = isRecord(envelope) ? envelope : {};
  const message =
    typeof error.message === "string"
      ? error.message
      : `${method} ${url} failed with ${response.status}`;

  return new ProjectApiError(message, {
    method,
    url,
    status: response.status,
    statusText: response.statusText,
    code: typeof error.code === "string" ? error.code : "HTTP_ERROR",
    details: error.details ?? payload,
    requestId: response.headers.get("x-request-id"),
  });
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}

export class ProjectApiClient implements ProjectApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: ProjectApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private resolve(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private async request(
    path: string,
    init: RequestInit & { method: string },
  ): Promise<ApiResponse> {
    const url = this.resolve(path);
    let response: Response;

    try {
      response = await this.fetcher(url, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ProjectApiError(`Unable to reach the project service`, {
        method: init.method,
        url,
        status: 0,
        code: "NETWORK_ERROR",
        cause: error,
      });
    }

    let payload: unknown;
    try {
      payload = await readResponsePayload(response);
    } catch (error) {
      if (!response.ok) {
        throw apiErrorFromResponse(init.method, url, response, undefined);
      }
      throw new ProjectApiError("Invalid response from the project service", {
        method: init.method,
        url,
        status: response.status,
        statusText: response.statusText,
        code: "INVALID_RESPONSE",
        requestId: response.headers.get("x-request-id"),
        cause: error,
      });
    }

    if (!response.ok) {
      throw apiErrorFromResponse(init.method, url, response, payload);
    }
    return { payload, response };
  }

  async listProjects(options: ProjectRequestOptions = {}) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.projects, {
      method: "GET",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    const projects = unwrap(payload, "projects");
    if (!Array.isArray(projects)) {
      throw new TypeError("Project list response must contain an array");
    }
    return projects.map(parseProjectSummary);
  }

  async createProject(
    input: CreateProjectInput,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.projects, {
      method: "POST",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    return parseProject(unwrap(payload, "project"));
  }

  async createProjectFromSt(
    input: CreateProjectFromStInput,
    options: ProjectRequestOptions = {},
  ) {
    if (!input.presetName.trim()) {
      throw new TypeError("presetName must not be empty");
    }
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.createFromSt, {
      method: "POST",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    return parseProject(unwrap(payload, "project"));
  }

  async importProjectJson(
    file: File,
    input: ImportProjectInput = {},
    options: ProjectRequestOptions = {},
  ) {
    let preset: unknown;
    try {
      preset = JSON.parse(await file.text()) as unknown;
    } catch (error) {
      throw new ProjectApiError("The selected preset is not valid JSON", {
        method: "POST",
        url: this.resolve(PROJECT_API_ENDPOINTS.importJson),
        status: 0,
        code: "INVALID_PRESET_JSON",
        details: { filename: file.name },
        cause: error,
      });
    }

    const { payload } = await this.request(PROJECT_API_ENDPOINTS.importJson, {
      method: "POST",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        preset,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.version !== undefined ? { version: input.version } : {}),
        ...(input.preview === undefined ? {} : { preview: input.preview }),
      }),
    });
    return parseProject(unwrap(payload, "project"));
  }

  async importProjectArchive(
    file: File,
    input: ImportProjectArchiveInput = {},
    options: ProjectRequestOptions = {},
  ) {
    const form = new FormData();
    form.append("file", file, file.name);
    if (input.name !== undefined) form.append("name", input.name);
    if (input.version !== undefined && input.version !== null) {
      form.append("version", input.version);
    }
    if (input.javascriptPolicy !== undefined) {
      form.append("javascriptPolicy", input.javascriptPolicy);
    }

    const { payload } = await this.request(
      PROJECT_API_ENDPOINTS.importArchive,
      {
        method: "POST",
        signal: options.signal,
        headers: { Accept: "application/json" },
        body: form,
      },
    );
    return parseArchiveImportResult(payload);
  }

  async getProject(
    projectId: string,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(
      PROJECT_API_ENDPOINTS.project(projectId),
      {
        method: "GET",
        signal: options.signal,
        headers: { Accept: "application/json" },
      },
    );
    return parseProject(unwrap(payload, "project"));
  }

  async getPreviewRuntimeManifest(
    projectId: string,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(
      PROJECT_API_ENDPOINTS.previewRuntimeManifest(projectId),
      {
        method: "GET",
        signal: options.signal,
        headers: { Accept: "application/json" },
      },
    );
    return parsePreviewRuntimeManifest(unwrap(payload, "manifest"));
  }

  async updateProject(
    projectId: string,
    input: UpdateProjectInput,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.project(projectId), {
      method: "PATCH",
      signal: options.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parseProject(unwrap(payload, "project"));
  }

  async deleteProject(
    projectId: string,
    options: ProjectRequestOptions = {},
  ) {
    await this.request(PROJECT_API_ENDPOINTS.project(projectId), {
      method: "DELETE",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
  }

  async listProjectFiles(
    projectId: string,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(
      PROJECT_API_ENDPOINTS.files(projectId),
      {
        method: "GET",
        signal: options.signal,
        headers: { Accept: "application/json" },
      },
    );
    const files = unwrap(payload, "files");
    if (!Array.isArray(files)) {
      throw new TypeError("Project file list response must contain an array");
    }
    return files.map(parseFileEntry);
  }

  async getProjectFile(
    projectId: string,
    path: string,
    options: ProjectRequestOptions = {},
  ) {
    const sourceJson = path === "preset.json";
    const { payload, response } = await this.request(
      sourceJson
        ? PROJECT_API_ENDPOINTS.sourceJson(projectId)
        : PROJECT_API_ENDPOINTS.file(projectId, path),
      {
        method: "GET",
        signal: options.signal,
        headers: { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" },
      },
    );
    return parseProjectFile(unwrap(payload, "file"), {
      path,
      revision: response.headers.get("etag"),
    });
  }

  async updateProjectFile(
    projectId: string,
    path: string,
    input: UpdateProjectFileInput,
    options: ProjectRequestOptions = {},
  ) {
    const sourceJson = path === "preset.json";
    if (sourceJson && !input.revision) {
      throw new TypeError("Complete preset JSON requires a source revision");
    }
    const { payload, response } = await this.request(
      sourceJson
        ? PROJECT_API_ENDPOINTS.sourceJson(projectId)
        : PROJECT_API_ENDPOINTS.file(projectId, path),
      {
        method: "PUT",
        signal: options.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: input.content,
          ...(input.revision ? { ifRevision: input.revision } : {}),
        }),
      },
    );
    return parseProjectFile(unwrap(payload, "file"), {
      path,
      content: input.content,
      revision: response.headers.get("etag") ?? input.revision ?? null,
    });
  }

  async getProjectStructure(
    projectId: string,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.structure(projectId), {
      method: "GET",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    return parseProjectStructure(unwrap(payload, "structure"));
  }

  async mutateProjectStructure(
    projectId: string,
    ifRevision: string,
    mutation: StructureMutation,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.mutations(projectId), {
      method: "POST",
      signal: options.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ifRevision, mutation }),
    });
    return parseMutationResult(payload);
  }

  async listSnapshots(projectId: string, options: ProjectRequestOptions = {}) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.snapshots(projectId), {
      method: "GET",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    const snapshots = unwrap(payload, "snapshots");
    if (!Array.isArray(snapshots)) throw new TypeError("Snapshot list response must contain an array");
    return snapshots.map(parseSnapshot);
  }

  async createSnapshot(
    projectId: string,
    input: { ifRevision: string; label?: string },
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.snapshots(projectId), {
      method: "POST",
      signal: options.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return parseSnapshot(unwrap(payload, "snapshot"));
  }

  async restoreSnapshot(
    projectId: string,
    snapshotId: string,
    ifRevision: string,
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(PROJECT_API_ENDPOINTS.restoreSnapshot(projectId, snapshotId), {
      method: "POST",
      signal: options.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ifRevision }),
    });
    return parseSnapshotRestoreResult(payload);
  }

  async deleteSnapshot(
    projectId: string,
    snapshotId: string,
    options: ProjectRequestOptions = {},
  ) {
    await this.request(PROJECT_API_ENDPOINTS.snapshot(projectId, snapshotId), {
      method: "DELETE",
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
  }

  async buildProject(
    projectId: string,
    input: BuildProjectInput = {},
    options: ProjectRequestOptions = {},
  ) {
    const { payload } = await this.request(
      PROJECT_API_ENDPOINTS.build(projectId),
      {
        method: "POST",
        signal: options.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
    return parseBuildResult(unwrap(payload, "build"));
  }

  async exportProject(
    projectId: string,
    input: ExportProjectInput = {},
    options: ProjectRequestOptions = {},
  ): Promise<ProjectExportResult> {
    const path = PROJECT_API_ENDPOINTS.exportProject(projectId);
    const url = this.resolve(path);
    let response: Response;

    try {
      response = await this.fetcher(url, {
        method: "POST",
        signal: options.signal,
        headers: {
          Accept: "application/json, application/octet-stream;q=0.9",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ProjectApiError("Unable to reach the project service", {
        method: "POST",
        url,
        status: 0,
        code: "NETWORK_ERROR",
        cause: error,
      });
    }

    const disposition = response.headers.get("content-disposition");
    if (response.ok && disposition?.toLowerCase().includes("attachment")) {
      const blob = await response.blob();
      return {
        kind: "download",
        success: true,
        filename: filenameFromDisposition(disposition) ?? "preset.json",
        size: blob.size,
        revision: response.headers.get("etag"),
        downloadUrl: null,
        diagnostics: [],
        blob,
      };
    }

    let payload: unknown;
    try {
      payload = await readResponsePayload(response);
    } catch (error) {
      throw new ProjectApiError("Invalid response from the project service", {
        method: "POST",
        url,
        status: response.status,
        statusText: response.statusText,
        code: "INVALID_RESPONSE",
        requestId: response.headers.get("x-request-id"),
        cause: error,
      });
    }
    if (!response.ok) {
      throw apiErrorFromResponse("POST", url, response, payload);
    }
    return parseExportMetadata(unwrap(payload, "export"));
  }

  async downloadProjectArchive(
    projectId: string,
    options: ProjectRequestOptions = {},
  ): Promise<ProjectArchiveDownload> {
    const url = this.resolve(PROJECT_API_ENDPOINTS.archive(projectId));
    let response: Response;

    try {
      response = await this.fetcher(url, {
        method: "GET",
        signal: options.signal,
        headers: { Accept: "application/zip, application/json;q=0.8" },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ProjectApiError("Unable to reach the project service", {
        method: "GET",
        url,
        status: 0,
        code: "NETWORK_ERROR",
        cause: error,
      });
    }

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await readResponsePayload(response);
      } catch {
        payload = undefined;
      }
      throw apiErrorFromResponse("GET", url, response, payload);
    }

    const blob = await response.blob();
    return {
      blob,
      filename:
        filenameFromDisposition(response.headers.get("content-disposition")) ??
        `${projectId}.zip`,
      size: blob.size,
      contentType:
        response.headers.get("content-type") ?? "application/zip",
    };
  }
}

export const projectApi = new ProjectApiClient();
