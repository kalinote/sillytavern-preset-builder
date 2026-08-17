export type StSessionStatus =
  | "connected"
  | "unreachable"
  | "expired"
  | "unsupported";

export interface StSession {
  status: StSessionStatus;
  origin: string;
  version: string;
  branch: string | null;
  userHandle: string | null;
  authModes: Array<"basic" | "account">;
  compatibility: "supported" | "untested";
  targetPolicy: "allowlist" | "private" | "any";
  capabilities: string[];
  connectedAt: string;
  lastCheckedAt: string;
}

export interface StBasicAuthInput {
  username: string;
  password: string;
}

export interface StAccountAuthInput {
  handle: string;
  password: string;
}

export interface ConnectStSessionInput {
  origin: string;
  basicAuth?: StBasicAuthInput;
  accountAuth?: StAccountAuthInput;
}

export interface StPresetSummary {
  name: string;
  revision: string;
  size: number;
}

export interface StPresetCatalog {
  presets: StPresetSummary[];
  persistedSelectedPresetName: string | null;
  refreshedAt: string;
}

export interface StPresetDocument {
  name: string;
  preset: Record<string, unknown>;
}

export type StPushMode = "create" | "overwrite";

export interface StPushPreview {
  previewToken: string;
  expiresAt: string;
  target: {
    name: string;
    exists: boolean;
    revision: string | null;
    size: number | null;
  };
  build: {
    projectRevision: string;
    revision: string;
    size: number;
    diagnostics: unknown[];
  };
  change: "created" | "changed" | "unchanged";
  canCommit: boolean;
}

export interface StPushResult {
  presetName: string;
  revision: string;
  savedAt: string;
  outcome: "created" | "overwritten" | "unchanged";
  requiresStReload: boolean;
  stUrl: string;
}

export interface StRequestOptions {
  signal?: AbortSignal;
}

export interface StApi {
  getSession(options?: StRequestOptions): Promise<StSession | null>;
  connectSession(
    input: ConnectStSessionInput,
    options?: StRequestOptions,
  ): Promise<StSession>;
  checkSession(options?: StRequestOptions): Promise<StSession>;
  disconnectSession(options?: StRequestOptions): Promise<void>;
  listPresets(options?: StRequestOptions): Promise<StPresetCatalog>;
  readPreset(
    name: string,
    options?: StRequestOptions,
  ): Promise<StPresetDocument>;
  previewProjectPush(
    projectId: string,
    input: { targetName: string; mode: StPushMode },
    options?: StRequestOptions,
  ): Promise<StPushPreview>;
  commitProjectPush(
    projectId: string,
    previewToken: string,
    options?: StRequestOptions,
  ): Promise<StPushResult>;
}

export interface StApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class StApiError extends Error {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: {
      method: string;
      url: string;
      status: number;
      code?: string;
      details?: unknown;
      requestId?: string | null;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "StApiError";
    this.method = options.method;
    this.url = options.url;
    this.status = options.status;
    this.code = options.code ?? "ST_API_ERROR";
    this.details = options.details;
    this.requestId = options.requestId ?? null;
  }
}

const ST_API_ROOT = "/api/st";
const PROJECT_API_ROOT = "/api/projects";
const REMEMBERED_ORIGIN_KEY = "preset-studio:st-origin:v1";

export const ST_API_ENDPOINTS = {
  session: `${ST_API_ROOT}/session`,
  checkSession: `${ST_API_ROOT}/session/check`,
  presets: `${ST_API_ROOT}/presets`,
  readPreset: `${ST_API_ROOT}/presets/read`,
  pushPreview: (projectId: string) =>
    `${PROJECT_API_ROOT}/${encodeURIComponent(projectId)}/push-preview`,
  pushPreset: (projectId: string) =>
    `${PROJECT_API_ROOT}/${encodeURIComponent(projectId)}/push-preset`,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string,
) {
  const value = optionalString(record[key]);
  if (!value) throw new TypeError(`${context}.${key} must be a non-empty string`);
  return value;
}

function unwrap(value: unknown, key: string): unknown {
  return isRecord(value) && key in value ? value[key] : value;
}

function parseSession(value: unknown): StSession | null {
  const candidate = unwrap(value, "session");
  if (candidate === undefined || candidate === null) return null;
  if (!isRecord(candidate)) throw new TypeError("ST session response must be an object");

  const nestedSt = isRecord(candidate.st) ? candidate.st : null;
  const origin =
    optionalString(candidate.origin) ??
    optionalString(candidate.baseUrl) ??
    optionalString(nestedSt?.url);
  if (!origin) throw new TypeError("ST session response must include origin");

  const wireStatus = optionalString(candidate.status);
  if (
    wireStatus !== "connected" &&
    wireStatus !== "unreachable" &&
    wireStatus !== "expired" &&
    wireStatus !== "unsupported"
  ) {
    throw new TypeError("ST session status is invalid");
  }
  const capabilities = Array.isArray(candidate.capabilities)
    ? candidate.capabilities.filter(
        (capability): capability is string => typeof capability === "string",
      )
    : [];
  if (
    !Array.isArray(candidate.authModes) ||
    candidate.authModes.some((mode) => mode !== "basic" && mode !== "account")
  ) {
    throw new TypeError("ST session authModes are invalid");
  }
  const compatibility = candidate.compatibility;
  if (compatibility !== "supported" && compatibility !== "untested") {
    throw new TypeError("ST session compatibility is invalid");
  }
  const targetPolicy = candidate.targetPolicy;
  if (targetPolicy !== "allowlist" && targetPolicy !== "private" && targetPolicy !== "any") {
    throw new TypeError("ST session targetPolicy is invalid");
  }

  return {
    status: wireStatus,
    origin,
    version: requiredString(candidate, "version", "session"),
    branch: optionalString(candidate.branch) ?? optionalString(nestedSt?.branch),
    userHandle:
      optionalString(candidate.userHandle) ??
      optionalString(candidate.handle) ??
      optionalString(candidate.user),
    authModes: candidate.authModes as Array<"basic" | "account">,
    compatibility,
    targetPolicy,
    capabilities,
    connectedAt: requiredString(candidate, "connectedAt", "session"),
    lastCheckedAt: requiredString(candidate, "lastCheckedAt", "session"),
  };
}

function parsePresetSummary(value: unknown): StPresetSummary {
  if (!isRecord(value)) throw new TypeError("ST preset entry must be an object");
  const size = value.size;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    throw new TypeError("preset.size must be a non-negative number");
  }
  return {
    name: requiredString(value, "name", "preset"),
    revision: requiredString(value, "revision", "preset"),
    size,
  };
}

function parsePresetCatalog(value: unknown): StPresetCatalog {
  const candidate = unwrap(value, "catalog");
  if (!isRecord(candidate) || !Array.isArray(candidate.presets)) {
    throw new TypeError("Preset catalog response must include presets");
  }
  return {
    presets: candidate.presets.map(parsePresetSummary),
    persistedSelectedPresetName: optionalString(
      candidate.persistedSelectedPresetName,
    ),
    refreshedAt: requiredString(candidate, "refreshedAt", "presetCatalog"),
  };
}

function parsePresetDocument(value: unknown): StPresetDocument {
  const candidate = unwrap(value, "preset");
  if (isRecord(value) && typeof value.name === "string" && isRecord(candidate)) {
    return { name: value.name, preset: candidate };
  }
  if (isRecord(value) && isRecord(value.result)) {
    return parsePresetDocument(value.result);
  }
  throw new TypeError("ST preset response must contain a name and preset object");
}

function parsePushPreview(value: unknown): StPushPreview {
  const candidate = unwrap(value, "preview");
  if (!isRecord(candidate)) throw new TypeError("Push preview response must be an object");
  if (!isRecord(candidate.target) || !isRecord(candidate.build)) {
    throw new TypeError("Push preview must include target and build objects");
  }
  const change = candidate.change;
  if (change !== "created" && change !== "changed" && change !== "unchanged") {
    throw new TypeError("Push preview change is invalid");
  }
  return {
    previewToken: requiredString(candidate, "previewToken", "pushPreview"),
    expiresAt: requiredString(candidate, "expiresAt", "pushPreview"),
    target: {
      name: requiredString(candidate.target, "name", "pushPreview.target"),
      exists: candidate.target.exists === true,
      revision: optionalString(candidate.target.revision),
      size:
        typeof candidate.target.size === "number" && Number.isFinite(candidate.target.size)
          ? candidate.target.size
          : null,
    },
    build: {
      projectRevision: requiredString(
        candidate.build,
        "projectRevision",
        "pushPreview.build",
      ),
      revision: requiredString(candidate.build, "revision", "pushPreview.build"),
      size:
        typeof candidate.build.size === "number" && Number.isFinite(candidate.build.size)
          ? candidate.build.size
          : 0,
      diagnostics: Array.isArray(candidate.build.diagnostics)
        ? candidate.build.diagnostics
        : [],
    },
    change,
    canCommit: candidate.canCommit === true,
  };
}

function parsePushResult(value: unknown): StPushResult {
  const candidate = unwrap(value, "result");
  if (!isRecord(candidate)) throw new TypeError("Push result response must be an object");
  const outcome = candidate.outcome;
  if (outcome !== "created" && outcome !== "overwritten" && outcome !== "unchanged") {
    throw new TypeError("Push result outcome is invalid");
  }
  return {
    presetName: requiredString(candidate, "presetName", "pushResult"),
    revision: requiredString(candidate, "revision", "pushResult"),
    savedAt: requiredString(candidate, "savedAt", "pushResult"),
    outcome,
    requiresStReload: candidate.requiresStReload === true,
    stUrl: requiredString(candidate, "stUrl", "pushResult"),
  };
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new StApiError("ST connector returned malformed JSON", {
      method: "RESPONSE",
      url: response.url,
      status: response.status,
      code: "INVALID_RESPONSE",
      cause,
    });
  }
}

function responseError(
  method: string,
  url: string,
  response: Response,
  payload: unknown,
) {
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
  const error = isRecord(envelope) ? envelope : {};
  return new StApiError(
    optionalString(error.message) ?? `${method} ${url} failed with ${response.status}`,
    {
      method,
      url,
      status: response.status,
      code: optionalString(error.code) ?? "HTTP_ERROR",
      details: error.details ?? payload,
      requestId: response.headers.get("x-request-id"),
    },
  );
}

export class StApiClient implements StApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: StApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal },
  ) {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: init.method,
        signal: init.signal,
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new StApiError("Unable to reach the ST connector service", {
        method: init.method,
        url,
        status: 0,
        code: "NETWORK_ERROR",
        cause,
      });
    }

    const payload = await readPayload(response);
    if (!response.ok) throw responseError(init.method, url, response, payload);
    return payload;
  }

  async getSession(options: StRequestOptions = {}) {
    try {
      return parseSession(
        await this.request(ST_API_ENDPOINTS.session, {
          method: "GET",
          signal: options.signal,
        }),
      );
    } catch (error) {
      if (error instanceof StApiError && error.status === 404) return null;
      throw error;
    }
  }

  async connectSession(input: ConnectStSessionInput, options: StRequestOptions = {}) {
    const origin = input.origin.trim();
    if (!origin) throw new TypeError("SillyTavern origin must not be empty");
    const session = parseSession(
      await this.request(ST_API_ENDPOINTS.session, {
        method: "POST",
        body: { ...input, origin },
        signal: options.signal,
      }),
    );
    if (!session) throw new TypeError("Connect response did not include a session");
    return session;
  }

  async checkSession(options: StRequestOptions = {}) {
    const session = parseSession(
      await this.request(ST_API_ENDPOINTS.checkSession, {
        method: "POST",
        body: {},
        signal: options.signal,
      }),
    );
    if (!session) throw new TypeError("Session check did not include a session");
    return session;
  }

  async disconnectSession(options: StRequestOptions = {}) {
    await this.request(ST_API_ENDPOINTS.session, {
      method: "DELETE",
      signal: options.signal,
    });
  }

  async listPresets(options: StRequestOptions = {}) {
    const payload = await this.request(ST_API_ENDPOINTS.presets, {
      method: "GET",
      signal: options.signal,
    });
    return parsePresetCatalog(payload);
  }

  async readPreset(name: string, options: StRequestOptions = {}) {
    const normalized = name.trim();
    if (!normalized) throw new TypeError("Preset name must not be empty");
    return parsePresetDocument(
      await this.request(ST_API_ENDPOINTS.readPreset, {
        method: "POST",
        body: { name: normalized },
        signal: options.signal,
      }),
    );
  }

  async previewProjectPush(
    projectId: string,
    input: { targetName: string; mode: StPushMode },
    options: StRequestOptions = {},
  ) {
    return parsePushPreview(
      await this.request(ST_API_ENDPOINTS.pushPreview(projectId), {
        method: "POST",
        body: input,
        signal: options.signal,
      }),
    );
  }

  async commitProjectPush(
    projectId: string,
    previewToken: string,
    options: StRequestOptions = {},
  ) {
    return parsePushResult(
      await this.request(ST_API_ENDPOINTS.pushPreset(projectId), {
        method: "POST",
        body: { previewToken },
        signal: options.signal,
      }),
    );
  }
}

export function getRememberedStOrigin() {
  try {
    return window.localStorage.getItem(REMEMBERED_ORIGIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberStOrigin(origin: string) {
  try {
    window.localStorage.setItem(REMEMBERED_ORIGIN_KEY, origin);
  } catch {
    // A remembered origin is optional; credentials are never stored here.
  }
}

export const stApi = new StApiClient();
