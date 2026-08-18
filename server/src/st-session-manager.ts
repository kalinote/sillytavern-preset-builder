import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "./errors.js";
import { ProjectStore } from "./project-store.js";
import {
  canonicalPresetRevision,
  SillyTavern118Adapter,
  type StCompatibility,
  type StPresetCatalog,
  type StPresetSnapshot,
  type StVersionInfo,
} from "./st-1-18-adapter.js";
import { StHttpClient, type StTargetPolicy } from "./st-http-client.js";
import type { Diagnostic } from "./types.js";

export const ST_SESSION_COOKIE = "preset_studio_st_session";
export const ST_CAPABILITIES = ["preset.list", "preset.read", "preset.save"] as const;

export type StSessionStatus = "connected" | "unreachable" | "expired" | "unsupported";
export type StAuthMode = "basic" | "account";

export interface StSessionInfo {
  status: StSessionStatus;
  origin: string;
  version: string;
  branch?: string;
  userHandle?: string;
  authModes: StAuthMode[];
  compatibility: StCompatibility;
  capabilities: Array<(typeof ST_CAPABILITIES)[number]>;
  connectedAt: string;
  lastCheckedAt: string;
  targetPolicy: StTargetPolicy;
}

export interface StSessionManagerOptions {
  targetPolicy: StTargetPolicy;
  allowedOrigins: ReadonlySet<string>;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  responseLimitBytes: number;
  sessionIdleMs: number;
  previewTtlMs?: number;
  maxSessions?: number;
  maxPreviews?: number;
  now?: () => number;
}

export interface CreateStSessionInput {
  origin: string;
  basicAuth?: { username: string; password: string };
  accountAuth?: { handle: string; password: string };
}

export interface PushPreviewResult {
  previewToken: string;
  expiresAt: string;
  target: { name: string; exists: boolean; revision?: string; size?: number };
  build: { projectRevision: string; revision: string; size: number; diagnostics: Diagnostic[] };
  change: "created" | "changed" | "unchanged";
  canCommit: boolean;
}

interface StSessionRecord {
  key: string;
  adapter: SillyTavern118Adapter;
  status: StSessionStatus;
  origin: string;
  version: string;
  branch?: string;
  userHandle?: string;
  authModes: StAuthMode[];
  compatibility: StCompatibility;
  connectedAt: number;
  lastCheckedAt: number;
  lastAccessAt: number;
}

interface PreviewRecord {
  tokenHash: string;
  sessionKey: string;
  projectId: string;
  projectRevision: string;
  targetName: string;
  mode: "create" | "overwrite";
  targetRevision?: string;
  buildRevision: string;
  buildSize: number;
  diagnostics: Diagnostic[];
  canCommit: boolean;
  createdAt: number;
  expiresAt: number;
}

function secret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function publicSession(record: StSessionRecord, targetPolicy: StTargetPolicy): StSessionInfo {
  return {
    status: record.status,
    origin: record.origin,
    version: record.version,
    ...(record.branch === undefined ? {} : { branch: record.branch }),
    ...(record.userHandle === undefined ? {} : { userHandle: record.userHandle }),
    authModes: [...record.authModes],
    compatibility: record.compatibility,
    capabilities: [...ST_CAPABILITIES],
    connectedAt: new Date(record.connectedAt).toISOString(),
    lastCheckedAt: new Date(record.lastCheckedAt).toISOString(),
    targetPolicy,
  };
}

function validatePresetName(value: unknown, field = "presetName"): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > 255 || value.trim() !== value) {
    throw new ApiError(400, "INVALID_INPUT", `${field} must be a non-empty UTF-8 string of at most 255 bytes`);
  }
  if (
    /[\u0000-\u001f<>:"/\\|?*]/.test(value) ||
    /[. ]$/.test(value) ||
    value === "." ||
    value === ".." ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  ) {
    throw new ApiError(400, "ST_PRESET_NAME_INVALID", `${field} contains characters SillyTavern cannot preserve safely`);
  }
  return value;
}

function statusFromVersion(version: StVersionInfo): StSessionStatus {
  return version.supported ? "connected" : "unsupported";
}

function isExpiredError(error: ApiError): boolean {
  return [
    "ST_SESSION_EXPIRED",
    "ST_ACCOUNT_AUTH_REQUIRED",
    "ST_ACCOUNT_AUTH_FAILED",
    "ST_BASIC_AUTH_REQUIRED",
    "ST_BASIC_AUTH_FAILED",
    "ST_CSRF_FAILED",
  ].includes(error.code);
}

function isUnreachableError(error: ApiError): boolean {
  return [
    "ST_UNREACHABLE",
    "ST_TIMEOUT",
    "ST_CONNECT_TIMEOUT",
    "ST_TLS_ERROR",
    "ST_DNS_FAILED",
  ].includes(error.code);
}

export class StSessionManager {
  readonly options: Required<Omit<StSessionManagerOptions, "allowedOrigins" | "now">> & {
    allowedOrigins: ReadonlySet<string>;
    now: () => number;
  };
  private readonly store: ProjectStore;
  private readonly sessions = new Map<string, StSessionRecord>();
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly commitQueues = new Map<string, Promise<void>>();
  private readonly cleanupTimer: NodeJS.Timeout;
  private pendingSessions = 0;
  private pendingPreviews = 0;

  constructor(store: ProjectStore, options: StSessionManagerOptions) {
    this.store = store;
    this.options = {
      ...options,
      previewTtlMs: options.previewTtlMs ?? 5 * 60_000,
      maxSessions: options.maxSessions ?? 256,
      maxPreviews: options.maxPreviews ?? 1024,
      now: options.now ?? Date.now,
    };
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      Math.max(1_000, Math.min(60_000, this.options.sessionIdleMs)),
    );
    this.cleanupTimer.unref();
  }

  async createSession(input: CreateStSessionInput): Promise<{ token: string; session: StSessionInfo }> {
    this.cleanup();
    if (this.sessions.size + this.pendingSessions >= this.options.maxSessions) {
      throw new ApiError(429, "ST_SESSION_LIMIT", "Too many SillyTavern sessions are active");
    }
    this.pendingSessions += 1;
    let client!: StHttpClient;
    let adapter: SillyTavern118Adapter | undefined;
    let initialized: Awaited<ReturnType<SillyTavern118Adapter["initialize"]>>;
    try {
      client = new StHttpClient({
        origin: input.origin,
        ...(input.basicAuth === undefined ? {} : { basicAuth: input.basicAuth }),
        targetPolicy: this.options.targetPolicy,
        allowedOrigins: this.options.allowedOrigins,
        connectTimeoutMs: this.options.connectTimeoutMs,
        requestTimeoutMs: this.options.requestTimeoutMs,
        responseLimitBytes: this.options.responseLimitBytes,
      });
      adapter = new SillyTavern118Adapter(client);
      initialized = await adapter.initialize(input.accountAuth);
    } catch (error) {
      adapter?.clearSensitiveState();
      throw error;
    } finally {
      this.pendingSessions -= 1;
    }
    const now = this.options.now();
    const token = secret(32);
    const key = hash(token);
    const authModes: StAuthMode[] = [
      ...(input.basicAuth === undefined ? [] : ["basic" as const]),
      ...(input.accountAuth === undefined ? [] : ["account" as const]),
    ];
    const record: StSessionRecord = {
      key,
      adapter: adapter as SillyTavern118Adapter,
      status: statusFromVersion(initialized.version),
      origin: client.origin,
      version: initialized.version.version,
      ...(initialized.version.branch === undefined ? {} : { branch: initialized.version.branch }),
      ...(initialized.userHandle === undefined ? {} : { userHandle: initialized.userHandle }),
      authModes,
      compatibility: initialized.version.compatibility,
      connectedAt: now,
      lastCheckedAt: now,
      lastAccessAt: now,
    };
    this.sessions.set(key, record);
    return { token, session: publicSession(record, this.options.targetPolicy) };
  }

  getSession(token: string | undefined): StSessionInfo | null {
    const record = this.getRecord(token, true);
    return record ? publicSession(record, this.options.targetPolicy) : null;
  }

  async checkSession(token: string | undefined): Promise<StSessionInfo> {
    const record = this.requireRecord(token);
    if (record.status === "expired") {
      record.lastCheckedAt = this.options.now();
      return publicSession(record, this.options.targetPolicy);
    }
    try {
      const version = await record.adapter.check();
      this.updateVersion(record, version);
      record.status = statusFromVersion(version);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(502, "ST_UNREACHABLE", "Unable to check SillyTavern");
      if (isExpiredError(apiError) || apiError.code === "ST_REDIRECT_REJECTED") this.expireRecord(record);
      else if (isUnreachableError(apiError)) record.status = "unreachable";
      else throw apiError;
    }
    record.lastCheckedAt = this.options.now();
    return publicSession(record, this.options.targetPolicy);
  }

  destroySession(token: string | undefined): void {
    if (!token) return;
    const key = hash(token);
    const record = this.sessions.get(key);
    if (!record) return;
    record.adapter.clearSensitiveState();
    this.sessions.delete(key);
    for (const [previewHash, preview] of this.previews) {
      if (preview.sessionKey === key) this.previews.delete(previewHash);
    }
  }

  invalidateProjectPreviews(projectId: string): void {
    for (const [previewHash, preview] of this.previews) {
      if (preview.projectId === projectId) this.previews.delete(previewHash);
    }
  }

  async listPresets(token: string | undefined): Promise<StPresetCatalog> {
    return this.withUsableSession(token, (record) => record.adapter.listPresets());
  }

  async readPreset(token: string | undefined, nameValue: unknown): Promise<StPresetSnapshot> {
    const name = validatePresetName(nameValue, "name");
    return this.withUsableSession(token, (record) => record.adapter.readPreset(name));
  }

  async createProjectFromSt(
    token: string | undefined,
    input: {
      presetName: unknown;
      name?: string;
      version?: string;
      preview?: { javascriptEnabled: boolean };
    },
  ) {
    const presetName = validatePresetName(input.presetName);
    const record = this.requireUsableRecord(token);
    const snapshot = await this.runRemote(record, () => record.adapter.readPreset(presetName));
    const project = await this.store.importProject({
      preset: snapshot.preset,
      sourceType: "sillytavern",
      sourcePresetName: snapshot.name,
      sourceStVersion: record.version,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.preview === undefined ? {} : { preview: input.preview }),
    });
    return { project, source: { presetName: snapshot.name } };
  }

  async previewPush(
    token: string | undefined,
    projectId: string,
    input: { targetName: unknown; mode: unknown },
  ): Promise<PushPreviewResult> {
    this.cleanup();
    if (this.previews.size + this.pendingPreviews >= this.options.maxPreviews) {
      throw new ApiError(429, "ST_PREVIEW_LIMIT", "Too many push previews are active");
    }
    const record = this.requireUsableRecord(token);
    const targetName = validatePresetName(input.targetName, "targetName");
    if (input.mode !== "create" && input.mode !== "overwrite") {
      throw new ApiError(400, "INVALID_INPUT", "mode must be create or overwrite");
    }
    const mode = input.mode;
    this.pendingPreviews += 1;
    let snapshot: Awaited<ReturnType<ProjectStore["getProjectBuildSnapshot"]>>;
    let catalog: StPresetCatalog;
    try {
      [snapshot, catalog] = await Promise.all([
        this.store.getProjectBuildSnapshot(projectId),
        this.runRemote(record, () => record.adapter.listPresets()),
      ]);
    } finally {
      this.pendingPreviews -= 1;
    }
    const { manifest, build: built } = snapshot;
    const target = catalog.presets.find((preset) => preset.name === targetName);
    if (mode === "create" && target) {
      throw new ApiError(409, "ST_PRESET_TARGET_EXISTS", "Target preset already exists; choose overwrite mode", {
        name: targetName,
        revision: target.revision,
      });
    }
    if (mode === "overwrite" && !target) {
      throw new ApiError(404, "ST_PRESET_NOT_FOUND", "Target preset does not exist; choose create mode", { name: targetName });
    }
    const buildRevision = canonicalPresetRevision(built.preset);
    const change = !target ? "created" : target.revision === buildRevision ? "unchanged" : "changed";
    const canCommit = !built.diagnostics.some((diagnostic) => diagnostic.level === "error");
    const previewToken = secret(32);
    const tokenHash = hash(previewToken);
    const now = this.options.now();
    const expiresAt = now + this.options.previewTtlMs;
    this.previews.set(tokenHash, {
      tokenHash,
      sessionKey: record.key,
      projectId,
      projectRevision: manifest.updatedAt,
      targetName,
      mode,
      ...(target === undefined ? {} : { targetRevision: target.revision }),
      buildRevision,
      buildSize: built.size,
      diagnostics: structuredClone(built.diagnostics),
      canCommit,
      createdAt: now,
      expiresAt,
    });
    return {
      previewToken,
      expiresAt: new Date(expiresAt).toISOString(),
      target: {
        name: targetName,
        exists: target !== undefined,
        ...(target === undefined ? {} : { revision: target.revision, size: target.size }),
      },
      build: {
        projectRevision: manifest.updatedAt,
        revision: buildRevision,
        size: built.size,
        diagnostics: structuredClone(built.diagnostics),
      },
      change,
      canCommit,
    };
  }

  async commitPush(token: string | undefined, projectId: string, previewTokenValue: unknown): Promise<{
    presetName: string;
    revision: string;
    savedAt: string;
    outcome: "created" | "overwritten" | "unchanged";
    requiresStReload: true;
    stUrl: string;
  }> {
    if (typeof previewTokenValue !== "string" || previewTokenValue.length < 32 || previewTokenValue.length > 128) {
      throw new ApiError(400, "ST_PREVIEW_INVALID", "previewToken is invalid");
    }
    const previewHash = hash(previewTokenValue);
    const preview = this.previews.get(previewHash);
    if (!preview) throw new ApiError(404, "ST_PREVIEW_INVALID", "Push preview does not exist or was already consumed");
    this.previews.delete(previewHash); // Every commit attempt consumes the token.
    if (preview.expiresAt <= this.options.now()) {
      throw new ApiError(410, "ST_PREVIEW_EXPIRED", "Push preview has expired");
    }
    const record = this.requireUsableRecord(token);
    if (record.key !== preview.sessionKey) {
      throw new ApiError(404, "ST_PREVIEW_INVALID", "Push preview does not belong to this session");
    }
    if (preview.projectId !== projectId) {
      throw new ApiError(404, "ST_PREVIEW_INVALID", "Push preview does not belong to this project route");
    }
    if (!preview.canCommit) {
      throw new ApiError(409, "ST_PREVIEW_NOT_COMMITTABLE", "Push preview contains blocking build diagnostics");
    }
    return this.withTargetCommitLock(`${record.origin}\0${preview.targetName}`, async () => {
      if (!this.sessions.has(record.key)) {
        throw new ApiError(401, "ST_SESSION_REQUIRED", "SillyTavern session ended before push commit");
      }
      return this.store.withProjectBuildTransaction(projectId, async ({ manifest, build: built }) => {
        const actualBuildRevision = canonicalPresetRevision(built.preset);
        if (manifest.updatedAt !== preview.projectRevision || actualBuildRevision !== preview.buildRevision) {
          throw new ApiError(409, "PROJECT_CHANGED", "Project changed after the push preview", {
            expectedProjectRevision: preview.projectRevision,
            actualProjectRevision: manifest.updatedAt,
            expectedBuildRevision: preview.buildRevision,
            actualBuildRevision,
          });
        }
        const catalog = await this.runRemote(record, () => record.adapter.listPresets());
        const currentTarget = catalog.presets.find((preset) => preset.name === preview.targetName);
        const targetConflict = preview.mode === "create"
          ? currentTarget !== undefined
          : currentTarget === undefined || currentTarget.revision !== preview.targetRevision;
        if (targetConflict) {
          throw new ApiError(409, "ST_PRESET_CHANGED", "Target preset changed after the push preview", {
            expectedRevision: preview.targetRevision ?? null,
            actualRevision: currentTarget?.revision ?? null,
          });
        }

        let outcome: "created" | "overwritten" | "unchanged";
        if (currentTarget?.revision === actualBuildRevision) {
          outcome = "unchanged";
        } else {
          await this.runRemote(record, () => record.adapter.savePreset(preview.targetName, built.preset));
          const verified = await this.runRemote(record, () => record.adapter.readPreset(preview.targetName));
          if (verified.revision !== actualBuildRevision) {
            throw new ApiError(502, "ST_PRESET_VERIFY_FAILED", "SillyTavern saved preset could not be verified", {
              expectedRevision: actualBuildRevision,
              actualRevision: verified.revision,
            });
          }
          outcome = preview.mode === "create" ? "created" : "overwritten";
        }
        return {
          result: {
            presetName: preview.targetName,
            revision: actualBuildRevision,
            savedAt: new Date(this.options.now()).toISOString(),
            outcome,
            requiresStReload: true as const,
            stUrl: record.origin,
          },
          targetPresetName: preview.targetName,
        };
      });
    });
  }

  close(): void {
    clearInterval(this.cleanupTimer);
    for (const record of this.sessions.values()) record.adapter.clearSensitiveState();
    this.sessions.clear();
    this.previews.clear();
    this.commitQueues.clear();
  }

  private getRecord(token: string | undefined, touch: boolean): StSessionRecord | undefined {
    this.cleanup();
    if (!token || token.length > 256) return undefined;
    const record = this.sessions.get(hash(token));
    if (!record) return undefined;
    if (touch) record.lastAccessAt = this.options.now();
    return record;
  }

  private requireRecord(token: string | undefined): StSessionRecord {
    const record = this.getRecord(token, true);
    if (!record) throw new ApiError(401, "ST_SESSION_REQUIRED", "A connected SillyTavern session is required");
    return record;
  }

  private requireUsableRecord(token: string | undefined): StSessionRecord {
    const record = this.requireRecord(token);
    if (record.status === "unsupported") {
      throw new ApiError(409, "ST_VERSION_UNSUPPORTED", "SillyTavern 1.18.0 or newer is required");
    }
    if (record.status === "expired") {
      throw new ApiError(401, "ST_SESSION_EXPIRED", "SillyTavern authentication has expired; reconnect to continue");
    }
    if (record.status === "unreachable") {
      throw new ApiError(502, "ST_UNREACHABLE", "SillyTavern is currently unreachable; check the session to retry");
    }
    return record;
  }

  private async withUsableSession<T>(
    token: string | undefined,
    operation: (record: StSessionRecord) => Promise<T>,
  ): Promise<T> {
    const record = this.requireUsableRecord(token);
    return this.runRemote(record, () => operation(record));
  }

  private async withTargetCommitLock<T>(targetKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.commitQueues.get(targetKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.commitQueues.set(targetKey, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.commitQueues.get(targetKey) === tail) this.commitQueues.delete(targetKey);
    }
  }

  private async runRemote<T>(record: StSessionRecord, operation: () => Promise<T>): Promise<T> {
    try {
      const value = await operation();
      record.status = "connected";
      record.lastCheckedAt = this.options.now();
      return value;
    } catch (error) {
      if (error instanceof ApiError) {
        if (isExpiredError(error) || error.code === "ST_REDIRECT_REJECTED") this.expireRecord(record);
        else if (isUnreachableError(error)) record.status = "unreachable";
      }
      record.lastCheckedAt = this.options.now();
      throw error;
    }
  }

  private updateVersion(record: StSessionRecord, version: StVersionInfo): void {
    record.version = version.version;
    record.compatibility = version.compatibility;
    if (version.branch === undefined) delete record.branch;
    else record.branch = version.branch;
  }

  private expireRecord(record: StSessionRecord): void {
    record.status = "expired";
    record.adapter.clearSensitiveState();
  }

  private cleanup(): void {
    const now = this.options.now();
    for (const [key, record] of this.sessions) {
      if (record.lastAccessAt + this.options.sessionIdleMs <= now) {
        record.adapter.clearSensitiveState();
        this.sessions.delete(key);
        for (const [previewHash, preview] of this.previews) {
          if (preview.sessionKey === key) this.previews.delete(previewHash);
        }
      }
    }
    for (const [previewHash, preview] of this.previews) {
      // Keep one TTL of tombstone time so a first late commit gets EXPIRED.
      if (preview.expiresAt + this.options.previewTtlMs <= now) this.previews.delete(previewHash);
    }
  }
}
