import { ApiError } from "./errors.js";
import { isJsonObject } from "./json.js";
import { StHttpClient, type StHttpResponse } from "./st-http-client.js";
import type { JsonObject, JsonValue } from "./types.js";
import { createHash } from "node:crypto";

export type StCompatibility = "supported" | "untested";

export interface StVersionInfo {
  version: string;
  branch?: string;
  compatibility: StCompatibility;
  supported: boolean;
}

export interface StPresetSummary {
  name: string;
  revision: string;
  size: number;
}

export interface StPresetSnapshot extends StPresetSummary {
  preset: JsonObject;
}

export interface StPresetCatalog {
  presets: StPresetSummary[];
  persistedSelectedPresetName?: string;
  refreshedAt: string;
}

export type StExtensionType = "system" | "local" | "global";

export interface StExtensionEntry {
  type: StExtensionType;
  name: string;
}

export interface StExtensionInstallResult {
  folderName: string;
  version?: string;
  author?: string;
  displayName?: string;
}

export interface StExtensionVersionResult {
  currentBranchName: string;
  currentCommitHash: string;
  isUpToDate: boolean;
  remoteUrl: string;
}

export interface StExtensionUpdateResult {
  shortCommitHash: string;
  isUpToDate: boolean;
  remoteUrl: string;
}

const EXTENSION_GIT_REQUEST_TIMEOUT_MS = 305_000;

interface ParsedSettingsResponse {
  presets: StPresetSnapshot[];
  persistedSelectedPresetName?: string;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isJsonObject(value)) return value;
  const output: JsonObject = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key] as JsonValue);
  return output;
}

export function canonicalPresetRevision(preset: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(preset))).digest("hex");
}

export function presetSize(preset: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(preset));
}

function responseError(response: StHttpResponse, operation: string): ApiError {
  if (response.status === 401) {
    return new ApiError(401, "ST_SESSION_EXPIRED", "SillyTavern 需要认证，或当前认证已经过期。");
  }
  if (response.status === 403) {
    return new ApiError(403, "ST_CSRF_FAILED", "SillyTavern 拒绝了请求或 CSRF 令牌。");
  }
  if (response.status === 404) {
    return new ApiError(502, "ST_ENDPOINT_UNAVAILABLE", `SillyTavern 缺少“${operation}”所需的接口。`);
  }
  return new ApiError(502, "ST_REMOTE_ERROR", `SillyTavern 的“${operation}”请求失败。`, {
    status: response.status,
  });
}

function extensionResponseError(
  response: StHttpResponse,
  operation: string,
  notFoundCode: "ST_EXTENSIONS_UNAVAILABLE" | "ST_EXTENSION_NOT_FOUND",
): ApiError {
  if (response.status === 404) {
    return notFoundCode === "ST_EXTENSIONS_UNAVAILABLE"
      ? new ApiError(409, notFoundCode, "SillyTavern 扩展功能未启用或扩展管理接口不可用。")
      : new ApiError(404, notFoundCode, "SillyTavern 中不存在该扩展。");
  }
  if (response.status === 409) {
    return new ApiError(409, "ST_EXTENSION_CONFLICT", `SillyTavern 的“${operation}”操作与现有扩展冲突。`);
  }
  return responseError(response, operation);
}

function requireExtensionSuccess(
  response: StHttpResponse,
  operation: string,
  notFoundCode: "ST_EXTENSIONS_UNAVAILABLE" | "ST_EXTENSION_NOT_FOUND",
): void {
  if (response.status !== 200) throw extensionResponseError(response, operation, notFoundCode);
}

function requireSuccess(response: StHttpResponse, operation: string, allowed: readonly number[] = [200]): void {
  if (!allowed.includes(response.status)) throw responseError(response, operation);
}

function parseVersionNumber(value: string): { major: number; minor: number; patch: number } {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回了无效的版本号。");
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function classifyVersion(version: string): StVersionInfo {
  const parsed = parseVersionNumber(version);
  const supported = parsed.major > 1 || (parsed.major === 1 && parsed.minor >= 18);
  return {
    version,
    compatibility: parsed.major === 1 && parsed.minor === 18 ? "supported" : "untested",
    supported,
  };
}

function parsePreset(value: unknown, name: string): StPresetSnapshot {
  let preset: unknown = value;
  let raw: string;
  if (typeof value === "string") {
    raw = value;
    try {
      preset = JSON.parse(value) as unknown;
    } catch {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的预设 JSON 格式错误。", { name });
    }
  } else {
    raw = JSON.stringify(value);
  }
  if (!isJsonObject(preset)) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的预设不是 JSON 对象。", { name });
  }
  return {
    name,
    preset: structuredClone(preset),
    revision: canonicalPresetRevision(preset),
    size: Buffer.byteLength(raw),
  };
}

function selectedPresetName(settingsValue: unknown): string | undefined {
  let settings: unknown = settingsValue;
  if (typeof settingsValue === "string") {
    try {
      settings = JSON.parse(settingsValue) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isJsonObject(settings)) return undefined;
  const openAiSettings = isJsonObject(settings.oai_settings) ? settings.oai_settings : settings;
  return typeof openAiSettings.preset_settings_openai === "string" && openAiSettings.preset_settings_openai
    ? openAiSettings.preset_settings_openai
    : undefined;
}

function responseString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value) || Buffer.byteLength(value, "utf8") > 8192) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", `SillyTavern 返回的扩展字段 ${field} 无效。`);
  }
  return value;
}

function optionalResponseString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return responseString(value, field, true);
}

function parseExtensionEntries(response: StHttpResponse): StExtensionEntry[] {
  requireExtensionSuccess(response, "发现扩展", "ST_EXTENSIONS_UNAVAILABLE");
  if (!Array.isArray(response.json) || response.json.length > 10_000) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的扩展目录无效。");
  }
  return response.json.map((value) => {
    if (!isJsonObject(value) || !["system", "local", "global"].includes(String(value.type))) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的扩展目录包含无效条目。");
    }
    return {
      type: value.type as StExtensionType,
      name: responseString(value.name, "name"),
    };
  });
}

function parseExtensionInstall(response: StHttpResponse): StExtensionInstallResult {
  requireExtensionSuccess(response, "安装扩展", "ST_EXTENSIONS_UNAVAILABLE");
  if (!isJsonObject(response.json)) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的扩展安装结果无效。");
  }
  const version = optionalResponseString(response.json.version, "version");
  const author = optionalResponseString(response.json.author, "author");
  const displayName = optionalResponseString(response.json.display_name, "display_name");
  return {
    folderName: responseString(response.json.folderName, "folderName"),
    ...(version === undefined ? {} : { version }),
    ...(author === undefined ? {} : { author }),
    ...(displayName === undefined ? {} : { displayName }),
  };
}

function parseExtensionVersion(response: StHttpResponse): StExtensionVersionResult {
  requireExtensionSuccess(response, "检查扩展版本", "ST_EXTENSION_NOT_FOUND");
  if (!isJsonObject(response.json) || typeof response.json.isUpToDate !== "boolean") {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的扩展版本结果无效。");
  }
  return {
    currentBranchName: responseString(response.json.currentBranchName, "currentBranchName", true),
    currentCommitHash: responseString(response.json.currentCommitHash, "currentCommitHash", true),
    isUpToDate: response.json.isUpToDate,
    remoteUrl: responseString(response.json.remoteUrl, "remoteUrl", true),
  };
}

function parseExtensionUpdate(response: StHttpResponse): StExtensionUpdateResult {
  requireExtensionSuccess(response, "更新扩展", "ST_EXTENSION_NOT_FOUND");
  if (!isJsonObject(response.json) || typeof response.json.isUpToDate !== "boolean") {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的扩展更新结果无效。");
  }
  return {
    shortCommitHash: responseString(response.json.shortCommitHash, "shortCommitHash"),
    isUpToDate: response.json.isUpToDate,
    remoteUrl: responseString(response.json.remoteUrl, "remoteUrl", true),
  };
}

function parseSettings(response: StHttpResponse): ParsedSettingsResponse {
  requireSuccess(response, "读取设置");
  if (!isJsonObject(response.json)) throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的设置数据无效。");
  const names = response.json.openai_setting_names;
  const values = response.json.openai_settings;
  if (
    !Array.isArray(names) ||
    !Array.isArray(values) ||
    names.length !== values.length ||
    names.length > 10_000
  ) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的预设目录无效。");
  }
  const seen = new Set<string>();
  const presets = names.map((name, index) => {
    if (typeof name !== "string" || !name || Buffer.byteLength(name, "utf8") > 255 || seen.has(name)) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的预设目录包含无效名称。");
    }
    seen.add(name);
    return parsePreset(values[index], name);
  });
  const selected = selectedPresetName(response.json.settings);
  return {
    presets,
    ...(selected === undefined ? {} : { persistedSelectedPresetName: selected }),
  };
}

export class SillyTavern118Adapter {
  readonly client: StHttpClient;
  private csrfToken?: string;
  private currentVersion?: StVersionInfo;

  constructor(client: StHttpClient) {
    this.client = client;
  }

  async initialize(accountAuth?: { handle: string; password: string }): Promise<{ version: StVersionInfo; userHandle?: string }> {
    await this.refreshCsrf();
    let userHandle: string | undefined;
    if (accountAuth) {
      const response = await this.client.request("/api/users/login", {
        method: "POST",
        body: { handle: accountAuth.handle, password: accountAuth.password },
        csrfToken: this.requireCsrfToken(),
      });
      if (response.status === 401) {
        throw new ApiError(401, "ST_BASIC_AUTH_FAILED", "SillyTavern HTTP Basic 认证失败。");
      }
      if (response.status === 403) {
        throw new ApiError(401, "ST_ACCOUNT_AUTH_FAILED", "SillyTavern 账号认证失败。");
      }
      if (response.status === 429) {
        throw new ApiError(429, "ST_RATE_LIMITED", "SillyTavern 暂时限制了账号登录请求，请稍后重试。");
      }
      requireSuccess(response, "账号登录");
      if (!isJsonObject(response.json) || typeof response.json.handle !== "string" || !response.json.handle) {
        throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的账号登录结果无效。");
      }
      userHandle = response.json.handle;
      await this.refreshCsrf();
    }

    let version: StVersionInfo;
    try {
      version = await this.readVersion();
    } catch (error) {
      if (error instanceof ApiError && error.code === "ST_REDIRECT_REJECTED") {
        throw new ApiError(
          401,
          accountAuth ? "ST_ACCOUNT_AUTH_FAILED" : "ST_ACCOUNT_AUTH_REQUIRED",
          accountAuth ? "SillyTavern 账号认证失败。" : "SillyTavern 要求进行账号认证。",
        );
      }
      throw error;
    }
    this.currentVersion = version;
    if (version.supported) {
      await this.ping();
      // A reachable ST instance is not sufficient: Studio needs the Chat
      // Completion preset endpoints and response shape to be usable.
      await this.listPresets();
    }
    return { version, ...(userHandle === undefined ? {} : { userHandle }) };
  }

  async check(): Promise<StVersionInfo> {
    const version = await this.readVersion();
    this.currentVersion = version;
    if (version.supported) await this.ping();
    return version;
  }

  version(): StVersionInfo | undefined {
    return this.currentVersion ? { ...this.currentVersion } : undefined;
  }

  async listPresets(): Promise<StPresetCatalog> {
    this.assertSupported();
    const parsed = parseSettings(await this.postProtected("/api/settings/get", {}));
    return {
      presets: parsed.presets.map(({ name, revision, size }) => ({ name, revision, size })),
      ...(parsed.persistedSelectedPresetName === undefined
        ? {}
        : { persistedSelectedPresetName: parsed.persistedSelectedPresetName }),
      refreshedAt: new Date().toISOString(),
    };
  }

  async readPreset(name: string): Promise<StPresetSnapshot> {
    this.assertSupported();
    const parsed = parseSettings(await this.postProtected("/api/settings/get", {}));
    const preset = parsed.presets.find((item) => item.name === name);
    if (!preset) throw new ApiError(404, "ST_PRESET_NOT_FOUND", "SillyTavern 中不存在该预设。", { name });
    return { ...preset, preset: structuredClone(preset.preset) };
  }

  async savePreset(name: string, preset: JsonObject): Promise<void> {
    this.assertSupported();
    const response = await this.postProtected("/api/presets/save", { apiId: "openai", name, preset });
    requireSuccess(response, "保存预设");
    if (!isJsonObject(response.json) || response.json.name !== name) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 保存预设后返回了不同的目标名称。");
    }
  }

  async discoverExtensions(): Promise<StExtensionEntry[]> {
    this.assertSupported();
    return parseExtensionEntries(await this.client.request("/api/extensions/discover"));
  }

  async installExtension(url: string, branch: string): Promise<StExtensionInstallResult> {
    this.assertSupported();
    return parseExtensionInstall(await this.postProtected(
      "/api/extensions/install",
      { url, global: false, branch },
      EXTENSION_GIT_REQUEST_TIMEOUT_MS,
    ));
  }

  async extensionVersion(extensionName: string): Promise<StExtensionVersionResult> {
    this.assertSupported();
    return parseExtensionVersion(await this.postProtected(
      "/api/extensions/version",
      { extensionName, global: false },
      EXTENSION_GIT_REQUEST_TIMEOUT_MS,
    ));
  }

  async updateExtension(extensionName: string): Promise<StExtensionUpdateResult> {
    this.assertSupported();
    return parseExtensionUpdate(await this.postProtected(
      "/api/extensions/update",
      { extensionName, global: false },
      EXTENSION_GIT_REQUEST_TIMEOUT_MS,
    ));
  }

  clearSensitiveState(): void {
    delete this.csrfToken;
    this.client.clearSensitiveState();
  }

  private assertSupported(): void {
    if (!this.currentVersion?.supported) {
      throw new ApiError(409, "ST_VERSION_UNSUPPORTED", "需要 SillyTavern 1.18.0 或更高版本。");
    }
  }

  private async refreshCsrf(): Promise<void> {
    const response = await this.client.request("/csrf-token");
    if (response.status === 401) {
      throw new ApiError(
        401,
        this.client.usesBasicAuth ? "ST_BASIC_AUTH_FAILED" : "ST_BASIC_AUTH_REQUIRED",
        this.client.usesBasicAuth
          ? "SillyTavern HTTP Basic 认证失败。"
          : "SillyTavern 要求进行 HTTP Basic 认证。",
      );
    }
    if (response.status === 429) {
      throw new ApiError(429, "ST_RATE_LIMITED", "SillyTavern 暂时限制了认证请求，请稍后重试。");
    }
    requireSuccess(response, "获取 CSRF 令牌");
    if (!isJsonObject(response.json) || typeof response.json.token !== "string" || !response.json.token) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的 CSRF 数据无效。");
    }
    this.csrfToken = response.json.token;
  }

  private async readVersion(): Promise<StVersionInfo> {
    const response = await this.client.request("/version");
    if (response.status === 401 || response.status === 403) throw responseError(response, "读取版本");
    requireSuccess(response, "读取版本");
    if (!isJsonObject(response.json) || typeof response.json.pkgVersion !== "string") {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern 返回的版本数据无效。");
    }
    const version = classifyVersion(response.json.pkgVersion);
    return {
      ...version,
      ...(typeof response.json.gitBranch === "string" && response.json.gitBranch
        ? { branch: response.json.gitBranch }
        : {}),
    };
  }

  private async ping(): Promise<void> {
    const response = await this.postProtected("/api/ping?extend=true", {});
    requireSuccess(response, "连接检查", [200, 204]);
  }

  private async postProtected(
    path: string,
    body: unknown,
    requestTimeoutMs?: number,
  ): Promise<StHttpResponse> {
    if (!this.csrfToken) await this.refreshCsrf();
    const requestOptions = {
      method: "POST" as const,
      body,
      csrfToken: this.requireCsrfToken(),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    };
    let response = await this.client.request(path, requestOptions);
    if (response.status === 403) {
      // ST rotates the synchronizer token with its cookie session. All v1
      // protected operations are safe to replay once because CSRF middleware
      // rejects before their route handler runs.
      await this.refreshCsrf();
      response = await this.client.request(path, {
        ...requestOptions,
        csrfToken: this.requireCsrfToken(),
      });
    }
    return response;
  }

  private requireCsrfToken(): string {
    if (!this.csrfToken) throw new ApiError(500, "ST_CSRF_STATE_INVALID", "SillyTavern CSRF 状态不可用。");
    return this.csrfToken;
  }
}
