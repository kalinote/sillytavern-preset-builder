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
}

export interface CreateProjectFromStInput {
  presetName: string;
  name?: string;
  version?: string | null;
}

export interface ImportProjectInput {
  name?: string;
  version?: string | null;
}

export interface ImportProjectArchiveInput {
  /** Optional overrides for the manifest stored inside the package. */
  name?: string;
  version?: string | null;
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

function parseProject(value: unknown): Project {
  if (!isRecord(value)) throw new TypeError("Project response must be an object");

  const schemaVersion = value.schemaVersion;
  const buildRulesVersion = value.buildRulesVersion;
  const sourceRecord = isRecord(value.source) ? value.source : null;
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
    const { payload, response } = await this.request(
      PROJECT_API_ENDPOINTS.file(projectId, path),
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
    const { payload, response } = await this.request(
      PROJECT_API_ENDPOINTS.file(projectId, path),
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
