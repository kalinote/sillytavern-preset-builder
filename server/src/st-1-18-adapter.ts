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
    return new ApiError(401, "ST_SESSION_EXPIRED", "SillyTavern authentication is required or has expired");
  }
  if (response.status === 403) {
    return new ApiError(403, "ST_CSRF_FAILED", "SillyTavern rejected the request or CSRF token");
  }
  if (response.status === 404) {
    return new ApiError(502, "ST_ENDPOINT_UNAVAILABLE", `SillyTavern does not provide the required ${operation} endpoint`);
  }
  return new ApiError(502, "ST_REMOTE_ERROR", `SillyTavern ${operation} request failed`, {
    status: response.status,
  });
}

function requireSuccess(response: StHttpResponse, operation: string, allowed: readonly number[] = [200]): void {
  if (!allowed.includes(response.status)) throw responseError(response, operation);
}

function parseVersionNumber(value: string): { major: number; minor: number; patch: number } {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern returned an invalid version");
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
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern returned malformed preset JSON", { name });
    }
  } else {
    raw = JSON.stringify(value);
  }
  if (!isJsonObject(preset)) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern returned a non-object preset", { name });
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

function parseSettings(response: StHttpResponse): ParsedSettingsResponse {
  requireSuccess(response, "settings");
  if (!isJsonObject(response.json)) throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern settings response is invalid");
  const names = response.json.openai_setting_names;
  const values = response.json.openai_settings;
  if (
    !Array.isArray(names) ||
    !Array.isArray(values) ||
    names.length !== values.length ||
    names.length > 10_000
  ) {
    throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern preset catalog is invalid");
  }
  const seen = new Set<string>();
  const presets = names.map((name, index) => {
    if (typeof name !== "string" || !name || Buffer.byteLength(name, "utf8") > 255 || seen.has(name)) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern preset catalog contains an invalid name");
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
        throw new ApiError(401, "ST_BASIC_AUTH_FAILED", "SillyTavern HTTP Basic authentication failed");
      }
      if (response.status === 403) {
        throw new ApiError(401, "ST_ACCOUNT_AUTH_FAILED", "SillyTavern account authentication failed");
      }
      if (response.status === 429) {
        throw new ApiError(429, "ST_RATE_LIMITED", "SillyTavern temporarily rate-limited account login");
      }
      requireSuccess(response, "account login");
      if (!isJsonObject(response.json) || typeof response.json.handle !== "string" || !response.json.handle) {
        throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern account login response is invalid");
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
          accountAuth ? "SillyTavern account authentication failed" : "SillyTavern account authentication is required",
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
    if (!preset) throw new ApiError(404, "ST_PRESET_NOT_FOUND", "SillyTavern preset does not exist", { name });
    return { ...preset, preset: structuredClone(preset.preset) };
  }

  async savePreset(name: string, preset: JsonObject): Promise<void> {
    this.assertSupported();
    const response = await this.postProtected("/api/presets/save", { apiId: "openai", name, preset });
    requireSuccess(response, "preset save");
    if (!isJsonObject(response.json) || response.json.name !== name) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern preset save response changed the target name");
    }
  }

  clearSensitiveState(): void {
    delete this.csrfToken;
    this.client.clearSensitiveState();
  }

  private assertSupported(): void {
    if (!this.currentVersion?.supported) {
      throw new ApiError(409, "ST_VERSION_UNSUPPORTED", "SillyTavern 1.18.0 or newer is required");
    }
  }

  private async refreshCsrf(): Promise<void> {
    const response = await this.client.request("/csrf-token");
    if (response.status === 401) {
      throw new ApiError(
        401,
        this.client.usesBasicAuth ? "ST_BASIC_AUTH_FAILED" : "ST_BASIC_AUTH_REQUIRED",
        this.client.usesBasicAuth
          ? "SillyTavern HTTP Basic authentication failed"
          : "SillyTavern HTTP Basic authentication is required",
      );
    }
    if (response.status === 429) {
      throw new ApiError(429, "ST_RATE_LIMITED", "SillyTavern temporarily rate-limited authentication");
    }
    requireSuccess(response, "CSRF token");
    if (!isJsonObject(response.json) || typeof response.json.token !== "string" || !response.json.token) {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern CSRF response is invalid");
    }
    this.csrfToken = response.json.token;
  }

  private async readVersion(): Promise<StVersionInfo> {
    const response = await this.client.request("/version");
    if (response.status === 401 || response.status === 403) throw responseError(response, "version");
    requireSuccess(response, "version");
    if (!isJsonObject(response.json) || typeof response.json.pkgVersion !== "string") {
      throw new ApiError(502, "ST_RESPONSE_INVALID", "SillyTavern version response is invalid");
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
    requireSuccess(response, "ping", [200, 204]);
  }

  private async postProtected(path: string, body: unknown): Promise<StHttpResponse> {
    if (!this.csrfToken) await this.refreshCsrf();
    let response = await this.client.request(path, { method: "POST", body, csrfToken: this.requireCsrfToken() });
    if (response.status === 403) {
      // ST rotates the synchronizer token with its cookie session. All v1
      // protected operations are safe to replay once because CSRF middleware
      // rejects before their route handler runs.
      await this.refreshCsrf();
      response = await this.client.request(path, { method: "POST", body, csrfToken: this.requireCsrfToken() });
    }
    return response;
  }

  private requireCsrfToken(): string {
    if (!this.csrfToken) throw new ApiError(500, "ST_CSRF_STATE_INVALID", "SillyTavern CSRF state is unavailable");
    return this.csrfToken;
  }
}
