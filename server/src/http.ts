import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from "./archive.js";
import { ApiError, asApiError } from "./errors.js";
import { isJsonObject } from "./json.js";
import { ProjectStore } from "./project-store.js";
import { isPreviewAssetPath, readPreviewAsset } from "./preview-assets.js";
import { renderPreviewRuntimeDocument } from "./preview-runtime.js";
import {
  ST_SESSION_COOKIE,
  StSessionManager,
  type CreateStSessionInput,
  type StSessionManagerOptions,
} from "./st-session-manager.js";
import { parseStAllowedOrigins, parseStTargetPolicy } from "./st-http-client.js";
import type { ImportProjectInput, JsonObject, JsonValue, StructureMutation } from "./types.js";

const DEFAULT_BODY_LIMIT = 64 * 1024 * 1024;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

export interface ApiServerOptions {
  workspaceRoot?: string;
  bodyLimitBytes?: number;
  staticRoot?: string | false;
  archiveLimits?: Partial<ArchiveLimits>;
  allowedOrigins?: string[];
  exposeWorkspacePath?: boolean;
  stSessionOptions?: Partial<StSessionManagerOptions>;
  previewOrigin?: string | false;
  previewRuntimeEnabled?: boolean;
  previewParentOrigins?: string[];
}

interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

const CORS_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const CORS_HEADERS = ["content-type", "if-match", "x-project-name", "x-project-version"] as const;

function parsePreviewSettings(value: unknown): { javascriptEnabled: boolean } | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value) || typeof value.javascriptEnabled !== "boolean") {
    throw new ApiError(400, "INVALID_INPUT", "preview.javascriptEnabled must be a boolean");
  }
  return { javascriptEnabled: value.javascriptEnabled };
}

function previewSettingsInput(value: unknown): { preview?: { javascriptEnabled: boolean } } {
  const preview = parsePreviewSettings(value);
  return preview === undefined ? {} : { preview };
}

function parseBooleanText(value: string | undefined, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ApiError(400, "INVALID_INPUT", `${field} must be true or false`);
}

function addVary(response: ServerResponse, value: string): void {
  const current = response.getHeader("Vary");
  const values = new Set(
    (Array.isArray(current) ? current.join(",") : String(current ?? ""))
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  response.setHeader("Vary", [...values].join(", "));
}

function setCommonHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function setPreviewHeaders(response: ServerResponse, parentOrigins: readonly string[]): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    `frame-ancestors ${parentOrigins.length > 0 ? parentOrigins.join(" ") : "'none'"}`,
  );
}

function normalizeConfiguredOrigin(value: string, field = "PRESET_STUDIO_ALLOWED_ORIGINS"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${field} entry: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${field} must contain HTTP(S) origins without path, query, or credentials: ${value}`);
  }
  return url.origin;
}

function configuredOrigins(options: ApiServerOptions): Set<string> {
  const values = options.allowedOrigins ?? (process.env.PRESET_STUDIO_ALLOWED_ORIGINS ?? "").split(",");
  return new Set(values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeConfiguredOrigin(value)));
}

function configuredPreviewOrigin(options: ApiServerOptions): string | undefined {
  const value = options.previewOrigin ?? process.env.PRESET_STUDIO_PREVIEW_ORIGIN;
  if (value === false || value === undefined || !value.trim()) return undefined;
  return normalizeConfiguredOrigin(value, "PRESET_STUDIO_PREVIEW_ORIGIN");
}

function configuredPreviewParentOrigins(options: ApiServerOptions): string[] {
  const values = options.previewParentOrigins
    ?? (process.env.PRESET_STUDIO_PREVIEW_PARENT_ORIGINS ?? "").split(",");
  return [...new Set(values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeConfiguredOrigin(value, "PRESET_STUDIO_PREVIEW_PARENT_ORIGINS")))];
}

function requestHost(request: IncomingMessage): string | undefined {
  const value = request.headers.host?.trim().toLowerCase();
  return value || undefined;
}

function effectiveRequestOrigin(request: IncomingMessage): string | undefined {
  const host = request.headers.host?.trim();
  if (!host) return undefined;
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocolValue = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol)
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const protocol = protocolValue === "https" ? "https" : "http";
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

function authorizeOrigin(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: ReadonlySet<string>,
  forbiddenOrigins: ReadonlySet<string> = new Set(),
): void {
  const header = request.headers.origin;
  if (header === undefined) return; // CLI, healthcheck, and server-to-server requests.
  let origin: string;
  try {
    origin = normalizeConfiguredOrigin(header);
  } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request Origin is not allowed");
  }
  if (forbiddenOrigins.has(origin)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request Origin is reserved for isolated previews");
  }

  const sameOriginByAddress = origin === effectiveRequestOrigin(request);
  // A browser request sent to the Vite/reverse-proxy origin remains
  // same-origin from the browser's perspective even when the proxy changes
  // the upstream Host header. Sec-Fetch-Site cannot be authored by page JS.
  const sameOriginThroughProxy = request.headers["sec-fetch-site"] === "same-origin";
  if (!sameOriginByAddress && !sameOriginThroughProxy && !allowedOrigins.has(origin)) {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request Origin is not allowed");
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Expose-Headers", "Content-Disposition, ETag");
  addVary(response, "Origin");
  addVary(response, "Sec-Fetch-Site");
}

function handlePreflight(request: IncomingMessage, response: ServerResponse): void {
  const requestedMethod = request.headers["access-control-request-method"]?.toUpperCase();
  if (requestedMethod && !CORS_METHODS.includes(requestedMethod as (typeof CORS_METHODS)[number])) {
    throw new ApiError(403, "CORS_METHOD_NOT_ALLOWED", "Requested CORS method is not allowed");
  }
  const requestedHeaders = (request.headers["access-control-request-headers"] ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  const rejectedHeaders = requestedHeaders.filter(
    (header) => !CORS_HEADERS.includes(header as (typeof CORS_HEADERS)[number]),
  );
  if (rejectedHeaders.length > 0) {
    throw new ApiError(403, "CORS_HEADERS_NOT_ALLOWED", "Requested CORS headers are not allowed", {
      headers: rejectedHeaders,
    });
  }
  response.statusCode = 204;
  response.setHeader("Access-Control-Allow-Methods", CORS_METHODS.join(", "));
  response.setHeader("Access-Control-Allow-Headers", CORS_HEADERS.join(", "));
  response.setHeader("Access-Control-Max-Age", "600");
  response.end();
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const content = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", content.length);
  response.setHeader("Cache-Control", "no-store");
  response.end(content);
}

function sendError(response: ServerResponse, error: unknown): void {
  const apiError = asApiError(error);
  sendJson(response, apiError.status, {
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    },
  });
}

function sendPreviewRuntime(
  request: IncomingMessage,
  response: ServerResponse,
  parentOrigins: readonly string[],
): void {
  const content = Buffer.from(renderPreviewRuntimeDocument(parentOrigins));
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", content.length);
  response.setHeader("Cache-Control", "no-store");
  response.end(request.method === "HEAD" ? undefined : content);
}

function sendPreviewCompatibilityVersion(request: IncomingMessage, response: ServerResponse): void {
  const content = Buffer.from(JSON.stringify({
    pkgVersion: "1.18.0",
    previewRuntime: true,
  }));
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", content.length);
  response.setHeader("Cache-Control", "no-store");
  response.end(request.method === "HEAD" ? undefined : content);
}

const PREVIEW_COMPATIBILITY_MODULES: Readonly<Record<string, string>> = Object.freeze({
  "/script.js": "export const displayVersion = 'SillyTavern 1.18.0';\n",
  "/scripts/openai.js": `
export class Message {
  constructor(value = {}) { Object.assign(this, value); }
}
export class MessageCollection extends Array {}
export const promptManager = {
  getActiveGroupCharacters() { return []; },
  preparePrompt(prompt) { return prompt instanceof Message ? prompt : new Message(prompt); },
};
export async function sendOpenAIRequest() {
  throw new Error("OpenAI requests are unavailable in Preset Studio preview");
}
`,
});

function sendPreviewCompatibilityModule(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): boolean {
  const source = PREVIEW_COMPATIBILITY_MODULES[pathname];
  if (source === undefined) return false;
  const content = Buffer.from(source);
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/javascript; charset=utf-8");
  response.setHeader("Content-Length", content.length);
  response.setHeader("Cache-Control", "no-store");
  response.end(request.method === "HEAD" ? undefined : content);
  return true;
}

async function sendPreviewAsset(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const asset = await readPreviewAsset(pathname);
  response.statusCode = 200;
  response.setHeader("Content-Type", asset.contentType);
  response.setHeader("Content-Length", asset.content.length);
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  response.end(request.method === "HEAD" ? undefined : asset.content);
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new ApiError(413, "BODY_TOO_LARGE", `Request body exceeds ${maxBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function parseJsonBuffer(buffer: Buffer): unknown {
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch (error) {
    throw new ApiError(400, "INVALID_JSON", "Request body is not valid JSON", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function parseDisposition(value: string): { name?: string; filename?: string } {
  const output: { name?: string; filename?: string } = {};
  const name = /(?:^|;)\s*name="([^"]*)"/i.exec(value);
  const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(value);
  if (name?.[1] !== undefined) output.name = name[1];
  if (filename?.[1] !== undefined) output.filename = filename[1];
  return output;
}

function parseMultipart(buffer: Buffer, contentType: string): MultipartPart[] {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundaryValue = match?.[1] ?? match?.[2];
  if (!boundaryValue) throw new ApiError(400, "INVALID_MULTIPART", "Multipart boundary is missing");
  if (boundaryValue.length > 200) throw new ApiError(400, "INVALID_MULTIPART", "Multipart boundary is too long");
  const boundary = Buffer.from(`--${boundaryValue}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const output: MultipartPart[] = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor >= 0) {
    const partStart = cursor + boundary.length;
    if (buffer.subarray(partStart, partStart + 2).equals(Buffer.from("--"))) break;
    const contentStart = partStart + 2;
    const next = buffer.indexOf(boundary, contentStart);
    if (next < 0) break;
    let part = buffer.subarray(contentStart, next);
    if (part.subarray(part.length - 2).equals(Buffer.from("\r\n"))) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf(headerSeparator);
    if (headerEnd < 0) throw new ApiError(400, "INVALID_MULTIPART", "Malformed multipart part");
    const headerLines = part.subarray(0, headerEnd).toString("latin1").split("\r\n");
    const headers = new Map<string, string>();
    for (const line of headerLines) {
      const separator = line.indexOf(":");
      if (separator > 0) headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
    const disposition = parseDisposition(headers.get("content-disposition") ?? "");
    if (!disposition.name) throw new ApiError(400, "INVALID_MULTIPART", "Multipart part has no field name");
    output.push({
      name: disposition.name,
      ...(disposition.filename === undefined ? {} : { filename: disposition.filename }),
      ...(headers.get("content-type") === undefined ? {} : { contentType: headers.get("content-type") as string }),
      data: part.subarray(headerEnd + headerSeparator.length),
    });
    cursor = next;
  }
  return output;
}

function textPart(parts: MultipartPart[], name: string): string | undefined {
  return parts.find((part) => part.name === name && part.filename === undefined)?.data.toString("utf8");
}

async function parseImportRequest(request: IncomingMessage, bodyLimit: number): Promise<ImportProjectInput> {
  const contentType = request.headers["content-type"] ?? "application/json";
  const body = await readRequestBody(request, bodyLimit);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const parts = parseMultipart(body, contentType);
    const file = parts.find((part) => part.name === "file");
    if (!file) throw new ApiError(400, "FILE_REQUIRED", "Multipart import requires a file field");
    const parsed = parseJsonBuffer(file.data);
    if (!isJsonObject(parsed)) throw new ApiError(422, "INVALID_PRESET", "Preset JSON root must be an object");
    const name = textPart(parts, "name");
    const version = textPart(parts, "version");
    const sourcePresetName = textPart(parts, "sourcePresetName");
    const javascriptEnabled = parseBooleanText(textPart(parts, "javascriptEnabled"), "javascriptEnabled");
    return {
      preset: parsed,
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
      ...(sourcePresetName === undefined ? {} : { sourcePresetName }),
      ...(javascriptEnabled === undefined ? {} : { preview: { javascriptEnabled } }),
    };
  }

  const parsed = parseJsonBuffer(body);
  if (!isJsonObject(parsed)) throw new ApiError(422, "INVALID_PRESET", "Preset JSON root must be an object");
  const isWrapper = isJsonObject(parsed.preset) && !Array.isArray(parsed.prompts);
  if (isWrapper) {
    return {
      preset: parsed.preset as JsonObject,
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
      ...(typeof parsed.sourcePresetName === "string" ? { sourcePresetName: parsed.sourcePresetName } : {}),
      ...previewSettingsInput(parsed.preview),
    };
  }
  const headerName = request.headers["x-project-name"];
  const headerVersion = request.headers["x-project-version"];
  return {
    preset: parsed,
    ...(typeof headerName === "string" ? { name: headerName } : {}),
    ...(typeof headerVersion === "string" ? { version: headerVersion } : {}),
  };
}

async function parseArchiveImportRequest(
  request: IncomingMessage,
  maxArchiveBytes: number,
): Promise<{
  archive: Buffer;
  name?: string;
  version?: string;
  javascriptPolicy?: "preserve" | "force-disabled" | "force-enabled";
}> {
  const contentType = request.headers["content-type"] ?? "application/octet-stream";
  const multipartAllowance = 1024 * 1024;
  const body = await readRequestBody(request, maxArchiveBytes + multipartAllowance);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const parts = parseMultipart(body, contentType);
    const file = parts.find((part) => part.name === "file");
    if (!file) throw new ApiError(400, "FILE_REQUIRED", "Multipart project import requires a file field");
    const name = textPart(parts, "name");
    const version = textPart(parts, "version");
    const policy = textPart(parts, "javascriptPolicy");
    if (policy !== undefined && !["preserve", "force-disabled", "force-enabled"].includes(policy)) {
      throw new ApiError(400, "INVALID_INPUT", "javascriptPolicy is not supported");
    }
    return {
      archive: file.data,
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
      ...(policy === undefined ? {} : {
        javascriptPolicy: policy as "preserve" | "force-disabled" | "force-enabled",
      }),
    };
  }
  const headerName = request.headers["x-project-name"];
  const headerVersion = request.headers["x-project-version"];
  return {
    archive: body,
    ...(typeof headerName === "string" ? { name: headerName } : {}),
    ...(typeof headerVersion === "string" ? { version: headerVersion } : {}),
  };
}

function positiveEnvironmentNumber(name: string, fallback: number, multiplier = 1): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value * multiplier) : fallback;
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

function isSecureRequest(request: IncomingMessage): boolean {
  if ("encrypted" in request.socket && request.socket.encrypted === true) return true;
  const forwarded = request.headers["x-forwarded-proto"];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim().toLowerCase() === "https";
}

function setStSessionCookie(response: ServerResponse, request: IncomingMessage, token: string): void {
  response.setHeader(
    "Set-Cookie",
    `${ST_SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict${isSecureRequest(request) ? "; Secure" : ""}`,
  );
}

function clearStSessionCookie(response: ServerResponse, request: IncomingMessage): void {
  response.setHeader(
    "Set-Cookie",
    `${ST_SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${isSecureRequest(request) ? "; Secure" : ""}`,
  );
}

function secretString(value: unknown, field: string, maxLength = 1024): string {
  if (typeof value !== "string" || !value || value.length > maxLength) {
    throw new ApiError(400, "INVALID_INPUT", `${field} 必须是非空字符串，且不能超过 ${maxLength} 个字符。`);
  }
  return value;
}

function secretPassword(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 4096) {
    throw new ApiError(400, "INVALID_INPUT", `${field} 必须是字符串，且不能超过 4096 个字符。`);
  }
  return value;
}

function parseStSessionInput(value: unknown): CreateStSessionInput {
  if (!isJsonObject(value)) throw new ApiError(400, "INVALID_INPUT", "请求体必须是对象。");
  const origin = secretString(value.origin, "origin", 2048);
  let basicAuth: CreateStSessionInput["basicAuth"];
  if (value.basicAuth !== undefined) {
    if (!isJsonObject(value.basicAuth)) throw new ApiError(400, "INVALID_INPUT", "basicAuth 必须是对象。");
    basicAuth = {
      username: secretString(value.basicAuth.username, "basicAuth.username", 256),
      password: secretPassword(value.basicAuth.password, "basicAuth.password"),
    };
  }
  let accountAuth: CreateStSessionInput["accountAuth"];
  if (value.accountAuth !== undefined) {
    if (!isJsonObject(value.accountAuth)) throw new ApiError(400, "INVALID_INPUT", "accountAuth 必须是对象。");
    accountAuth = {
      handle: secretString(value.accountAuth.handle, "accountAuth.handle", 256),
      password: secretPassword(value.accountAuth.password, "accountAuth.password"),
    };
  }
  return {
    origin,
    ...(basicAuth === undefined ? {} : { basicAuth }),
    ...(accountAuth === undefined ? {} : { accountAuth }),
  };
}

function mimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".ico": return "image/x-icon";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot: string | false,
  pathname: string,
): Promise<boolean> {
  if (staticRoot === false || (request.method !== "GET" && request.method !== "HEAD")) return false;
  try {
    await access(join(staticRoot, "index.html"));
  } catch {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ApiError(400, "INVALID_PATH", "URL path contains invalid encoding");
  }
  const requested = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  let candidate = resolve(staticRoot, requested);
  const fromRoot = relative(staticRoot, candidate);
  if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) {
    throw new ApiError(400, "INVALID_PATH", "Static path escapes application root");
  }
  try {
    if (!(await stat(candidate)).isFile()) throw new Error("not a file");
  } catch {
    if (extname(requested)) return false;
    candidate = join(staticRoot, "index.html");
  }
  const content = await readFile(candidate);
  response.statusCode = 200;
  response.setHeader("Content-Type", mimeType(candidate));
  response.setHeader("Content-Length", content.length);
  response.setHeader("Cache-Control", candidate.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
  response.end(request.method === "HEAD" ? undefined : content);
  return true;
}

export function createApiServer(options: ApiServerOptions = {}): {
  server: Server;
  store: ProjectStore;
  stSessions: StSessionManager;
} {
  const workspaceRoot = options.workspaceRoot ?? process.env.PRESET_STUDIO_WORKSPACE ?? join(REPOSITORY_ROOT, "workspace-data");
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT;
  const staticRoot = options.staticRoot ?? process.env.PRESET_STUDIO_STATIC_ROOT ?? join(REPOSITORY_ROOT, "dist");
  const environmentArchiveLimits: ArchiveLimits = {
    maxArchiveBytes: positiveEnvironmentNumber(
      "PRESET_STUDIO_ZIP_MAX_MIB",
      DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes,
      1024 * 1024,
    ),
    maxUnpackedBytes: positiveEnvironmentNumber(
      "PRESET_STUDIO_ZIP_UNPACKED_MIB",
      DEFAULT_ARCHIVE_LIMITS.maxUnpackedBytes,
      1024 * 1024,
    ),
    maxFileBytes: positiveEnvironmentNumber(
      "PRESET_STUDIO_ZIP_FILE_MIB",
      DEFAULT_ARCHIVE_LIMITS.maxFileBytes,
      1024 * 1024,
    ),
    maxEntries: positiveEnvironmentNumber("PRESET_STUDIO_ZIP_MAX_ENTRIES", DEFAULT_ARCHIVE_LIMITS.maxEntries),
  };
  const store = new ProjectStore(workspaceRoot, { ...environmentArchiveLimits, ...options.archiveLimits });
  const allowedOrigins = configuredOrigins(options);
  const configuredPreviewOriginValue = configuredPreviewOrigin(options);
  const previewRuntimeEnabled = options.previewRuntimeEnabled
    ?? (configuredPreviewOriginValue !== undefined);
  const previewOrigin = previewRuntimeEnabled ? configuredPreviewOriginValue : undefined;
  const previewHost = configuredPreviewOriginValue === undefined
    ? undefined
    : new URL(configuredPreviewOriginValue).host.toLowerCase();
  const previewParentOrigins = configuredPreviewParentOrigins(options);
  const forbiddenApiOrigins = new Set(
    configuredPreviewOriginValue === undefined ? [] : [configuredPreviewOriginValue],
  );
  const exposeWorkspacePath = options.exposeWorkspacePath
    ?? process.env.PRESET_STUDIO_EXPOSE_WORKSPACE_PATH?.toLowerCase() === "true";
  const environmentStOptions: StSessionManagerOptions = {
    targetPolicy: parseStTargetPolicy(process.env.PRESET_STUDIO_ST_TARGET_POLICY),
    allowedOrigins: parseStAllowedOrigins(process.env.PRESET_STUDIO_ST_ALLOWED_ORIGINS),
    connectTimeoutMs: positiveEnvironmentNumber("PRESET_STUDIO_ST_CONNECT_TIMEOUT_MS", 10_000),
    requestTimeoutMs: positiveEnvironmentNumber("PRESET_STUDIO_ST_REQUEST_TIMEOUT_MS", 30_000),
    responseLimitBytes: positiveEnvironmentNumber(
      "PRESET_STUDIO_ST_RESPONSE_LIMIT_MIB",
      64 * 1024 * 1024,
      1024 * 1024,
    ),
    sessionIdleMs: positiveEnvironmentNumber(
      "PRESET_STUDIO_ST_SESSION_IDLE_MINUTES",
      480 * 60_000,
      60_000,
    ),
  };
  const stSessions = new StSessionManager(store, { ...environmentStOptions, ...options.stSessionOptions });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const isPreviewRequest = previewHost !== undefined && requestHost(request) === previewHost;
    if (isPreviewRequest) {
      setPreviewHeaders(response, previewParentOrigins);
      try {
        if (!previewRuntimeEnabled) {
          throw new ApiError(404, "NOT_FOUND", "JavaScript preview host is disabled");
        }
        if (pathname === "/preview-runtime" && (request.method === "GET" || request.method === "HEAD")) {
          sendPreviewRuntime(request, response, previewParentOrigins);
          return;
        }
        if (pathname === "/version" && (request.method === "GET" || request.method === "HEAD")) {
          sendPreviewCompatibilityVersion(request, response);
          return;
        }
        if (
          (request.method === "GET" || request.method === "HEAD")
          && sendPreviewCompatibilityModule(request, response, pathname)
        ) return;
        if (isPreviewAssetPath(pathname) && (request.method === "GET" || request.method === "HEAD")) {
          await sendPreviewAsset(request, response, pathname);
          return;
        }
        throw new ApiError(404, "NOT_FOUND", "Preview host only serves the JavaScript runtime");
      } catch (error) {
        if (!response.headersSent) sendError(response, error);
        else response.destroy(error instanceof Error ? error : undefined);
      }
      return;
    }

    setCommonHeaders(response);
    try {
      authorizeOrigin(request, response, allowedOrigins, forbiddenApiOrigins);
      if (request.method === "OPTIONS") {
        handlePreflight(request, response);
        return;
      }
      if (pathname === "/api/health" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          previewRuntime: {
            enabled: previewRuntimeEnabled && previewOrigin !== undefined,
            ...(previewOrigin === undefined ? {} : { origin: previewOrigin }),
          },
          ...(exposeWorkspacePath ? { workspaceRoot: store.workspaceRoot } : {}),
        });
        return;
      }
      if (pathname === "/preview-runtime") {
        throw new ApiError(404, "NOT_FOUND", "Preview runtime is only available on its configured origin");
      }
      if (pathname === "/api/st/session" && request.method === "GET") {
        const token = cookieValue(request, ST_SESSION_COOKIE);
        const session = stSessions.getSession(token);
        if (token && !session) clearStSessionCookie(response, request);
        sendJson(response, 200, { session });
        return;
      }
      if (pathname === "/api/st/session" && request.method === "POST") {
        const input = parseStSessionInput(parseJsonBuffer(await readRequestBody(request, 16 * 1024)));
        const created = await stSessions.createSession(input);
        const previousToken = cookieValue(request, ST_SESSION_COOKIE);
        if (previousToken) stSessions.destroySession(previousToken);
        setStSessionCookie(response, request, created.token);
        sendJson(response, 201, { session: created.session });
        return;
      }
      if (pathname === "/api/st/session/check" && request.method === "POST") {
        const body = await readRequestBody(request, 16 * 1024);
        if (body.length > 0 && !isJsonObject(parseJsonBuffer(body))) {
          throw new ApiError(400, "INVALID_INPUT", "连接检查的请求体必须是对象。");
        }
        const session = await stSessions.checkSession(cookieValue(request, ST_SESSION_COOKIE));
        sendJson(response, 200, { session });
        return;
      }
      if (pathname === "/api/st/session" && request.method === "DELETE") {
        stSessions.destroySession(cookieValue(request, ST_SESSION_COOKIE));
        clearStSessionCookie(response, request);
        response.statusCode = 204;
        response.setHeader("Cache-Control", "no-store");
        response.end();
        return;
      }
      if (pathname === "/api/st/presets" && request.method === "GET") {
        sendJson(response, 200, await stSessions.listPresets(cookieValue(request, ST_SESSION_COOKIE)));
        return;
      }
      if (pathname === "/api/st/presets/read" && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 16 * 1024));
        if (!isJsonObject(body)) throw new ApiError(400, "INVALID_INPUT", "请求体必须是对象。");
        sendJson(response, 200, await stSessions.readPreset(cookieValue(request, ST_SESSION_COOKIE), body.name));
        return;
      }
      if (pathname === "/api/projects" && request.method === "GET") {
        sendJson(response, 200, { projects: await store.listProjects() });
        return;
      }
      if (pathname === "/api/projects" && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, bodyLimit));
        if (!isJsonObject(body)) throw new ApiError(400, "INVALID_INPUT", "Request body must be an object");
        const project = await store.createEmptyProject({
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.version === "string" ? { version: body.version } : {}),
          ...previewSettingsInput(body.preview),
        });
        sendJson(response, 201, { project });
        return;
      }
      if (pathname === "/api/projects/import/json" && request.method === "POST") {
        const project = await store.importProject(await parseImportRequest(request, bodyLimit));
        sendJson(response, 201, { project });
        return;
      }
      if (pathname === "/api/projects/import/archive" && request.method === "POST") {
        const input = await parseArchiveImportRequest(request, store.archiveLimits.maxArchiveBytes);
        const imported = await store.importProjectArchive(input.archive, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.version === undefined ? {} : { version: input.version }),
          ...(input.javascriptPolicy === undefined ? {} : { javascriptPolicy: input.javascriptPolicy }),
        });
        sendJson(response, 201, {
          project: imported.project,
          import: {
            originalProjectId: imported.originalProjectId,
            idRegenerated: imported.idRegenerated,
          },
        });
        return;
      }
      if (pathname === "/api/projects/create-from-st" && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 16 * 1024));
        if (!isJsonObject(body)) throw new ApiError(400, "INVALID_INPUT", "请求体必须是对象。");
        const result = await stSessions.createProjectFromSt(cookieValue(request, ST_SESSION_COOKIE), {
          presetName: body.presetName,
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.version === "string" ? { version: body.version } : {}),
          ...previewSettingsInput(body.preview),
        });
        sendJson(response, 201, result);
        return;
      }

      const pushPreviewMatch = /^\/api\/projects\/([^/]+)\/push-preview$/.exec(pathname);
      if (pushPreviewMatch && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 16 * 1024));
        if (!isJsonObject(body)) throw new ApiError(400, "INVALID_INPUT", "请求体必须是对象。");
        const preview = await stSessions.previewPush(
          cookieValue(request, ST_SESSION_COOKIE),
          pushPreviewMatch[1] as string,
          { targetName: body.targetName, mode: body.mode },
        );
        sendJson(response, 200, preview);
        return;
      }

      const pushPresetMatch = /^\/api\/projects\/([^/]+)\/push-preset$/.exec(pathname);
      if (pushPresetMatch && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 16 * 1024));
        if (!isJsonObject(body)) throw new ApiError(400, "INVALID_INPUT", "请求体必须是对象。");
        const result = await stSessions.commitPush(
          cookieValue(request, ST_SESSION_COOKIE),
          pushPresetMatch[1] as string,
          body.previewToken,
        );
        sendJson(response, 200, result);
        return;
      }

      const runtimeManifestMatch = /^\/api\/projects\/([^/]+)\/preview\/runtime-manifest$/.exec(pathname);
      if (runtimeManifestMatch && request.method === "GET") {
        sendJson(response, 200, {
          manifest: await store.getPreviewRuntimeManifest(runtimeManifestMatch[1] as string),
        });
        return;
      }

      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
      if (projectMatch && request.method === "GET") {
        sendJson(response, 200, { project: await store.getProject(projectMatch[1] as string) });
        return;
      }
      if (projectMatch && request.method === "PATCH") {
        const body = parseJsonBuffer(await readRequestBody(request, 32 * 1024));
        if (!isJsonObject(body) || typeof body.ifProjectRevision !== "string") {
          throw new ApiError(400, "INVALID_INPUT", "Request body must contain ifProjectRevision");
        }
        const project = await store.updateProject(projectMatch[1] as string, {
          ifProjectRevision: body.ifProjectRevision,
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.version === "string" ? { version: body.version } : {}),
          ...(typeof body.targetPresetName === "string" ? { targetPresetName: body.targetPresetName } : {}),
          ...previewSettingsInput(body.preview),
        });
        sendJson(response, 200, { project });
        return;
      }
      if (projectMatch && request.method === "DELETE") {
        const projectId = projectMatch[1] as string;
        await store.deleteProject(projectId);
        stSessions.invalidateProjectPreviews(projectId);
        response.statusCode = 204;
        response.setHeader("Cache-Control", "no-store");
        response.end();
        return;
      }

      const sourceJsonMatch = /^\/api\/projects\/([^/]+)\/source-json$/.exec(pathname);
      if (sourceJsonMatch && request.method === "GET") {
        const file = await store.readSourceJson(sourceJsonMatch[1] as string);
        response.setHeader("ETag", `"${file.revision}"`);
        sendJson(response, 200, file);
        return;
      }
      if (sourceJsonMatch && request.method === "PUT") {
        const body = parseJsonBuffer(await readRequestBody(request, bodyLimit));
        if (!isJsonObject(body) || typeof body.content !== "string" || typeof body.ifRevision !== "string") {
          throw new ApiError(400, "INVALID_INPUT", "Request body must contain string content and ifRevision");
        }
        const file = await store.replaceSourceJson(sourceJsonMatch[1] as string, {
          content: body.content,
          ifRevision: body.ifRevision,
        });
        response.setHeader("ETag", `"${file.revision}"`);
        sendJson(response, 200, file);
        return;
      }

      const structureMatch = /^\/api\/projects\/([^/]+)\/structure$/.exec(pathname);
      if (structureMatch && request.method === "GET") {
        sendJson(response, 200, {
          structure: await store.getProjectStructure(structureMatch[1] as string),
          diagnostics: [],
        });
        return;
      }
      const mutationMatch = /^\/api\/projects\/([^/]+)\/structure\/mutations$/.exec(pathname);
      if (mutationMatch && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, bodyLimit));
        if (!isJsonObject(body) || typeof body.ifRevision !== "string" || !isJsonObject(body.mutation)) {
          throw new ApiError(400, "INVALID_INPUT", "Request body must contain ifRevision and mutation");
        }
        const mutation = body.mutation;
        const validOps = new Set(["create", "duplicate", "patch", "delete", "reorder", "set-prompt-order"]);
        if (typeof mutation.op !== "string" || !validOps.has(mutation.op)) {
          throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", "Unknown structure mutation operation");
        }
        if (mutation.op !== "set-prompt-order" && !["prompt", "regex", "script"].includes(String(mutation.kind))) {
          throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", "Unknown project item kind");
        }
        if (mutation.op === "set-prompt-order") {
          if (!Array.isArray(mutation.promptOrder)) {
            throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", "promptOrder must be an array");
          }
          sendJson(response, 200, await store.setProjectPromptOrder(mutationMatch[1] as string, {
            ifRevision: body.ifRevision,
            promptOrder: mutation.promptOrder as JsonValue[],
          }));
          return;
        }
        const result = await store.mutateProjectStructure(mutationMatch[1] as string, {
          ifRevision: body.ifRevision,
          mutation: mutation as unknown as StructureMutation,
        });
        sendJson(response, 200, {
          ...result,
          build: {
            revision: result.build.revision,
            size: result.build.size,
            diagnostics: result.build.diagnostics,
          },
        });
        return;
      }

      const snapshotsMatch = /^\/api\/projects\/([^/]+)\/snapshots$/.exec(pathname);
      if (snapshotsMatch && request.method === "GET") {
        sendJson(response, 200, { snapshots: await store.listSnapshots(snapshotsMatch[1] as string) });
        return;
      }
      if (snapshotsMatch && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 32 * 1024));
        if (!isJsonObject(body) || typeof body.ifRevision !== "string") {
          throw new ApiError(400, "INVALID_INPUT", "Request body must contain ifRevision");
        }
        const snapshot = await store.createSnapshot(snapshotsMatch[1] as string, {
          ifRevision: body.ifRevision,
          ...(typeof body.label === "string" ? { label: body.label } : {}),
        });
        sendJson(response, 201, { snapshot });
        return;
      }
      const snapshotRestoreMatch = /^\/api\/projects\/([^/]+)\/snapshots\/([^/]+)\/restore$/.exec(pathname);
      if (snapshotRestoreMatch && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 16 * 1024));
        if (!isJsonObject(body) || typeof body.ifRevision !== "string") {
          throw new ApiError(400, "INVALID_INPUT", "Request body must contain ifRevision");
        }
        sendJson(response, 200, await store.restoreSnapshot(
          snapshotRestoreMatch[1] as string,
          snapshotRestoreMatch[2] as string,
          { ifRevision: body.ifRevision },
        ));
        return;
      }
      const snapshotMatch = /^\/api\/projects\/([^/]+)\/snapshots\/([^/]+)$/.exec(pathname);
      if (snapshotMatch && request.method === "DELETE") {
        await store.deleteSnapshot(snapshotMatch[1] as string, snapshotMatch[2] as string);
        response.statusCode = 204;
        response.setHeader("Cache-Control", "no-store");
        response.end();
        return;
      }

      const archiveMatch = /^\/api\/projects\/([^/]+)\/archive$/.exec(pathname);
      if (archiveMatch && request.method === "GET") {
        const archive = await store.buildProjectArchive(archiveMatch[1] as string);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Content-Length", archive.content.length);
        response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(archive.filename)}`);
        response.setHeader("Cache-Control", "no-store");
        response.end(archive.content);
        return;
      }

      const filesMatch = /^\/api\/projects\/([^/]+)\/files$/.exec(pathname);
      if (filesMatch && request.method === "GET") {
        sendJson(response, 200, { files: await store.listFiles(filesMatch[1] as string) });
        return;
      }
      const fileMatch = /^\/api\/projects\/([^/]+)\/files\/(.+)$/.exec(pathname);
      if (fileMatch && request.method === "GET") {
        const file = await store.readProjectFile(fileMatch[1] as string, fileMatch[2] as string);
        response.setHeader("ETag", `"${file.revision}"`);
        sendJson(response, 200, file);
        return;
      }
      if (fileMatch && request.method === "PUT") {
        const body = parseJsonBuffer(await readRequestBody(request, bodyLimit));
        if (!isJsonObject(body) || typeof body.content !== "string") {
          throw new ApiError(400, "INVALID_INPUT", "Request body must contain string content");
        }
        const file = await store.saveProjectFile(fileMatch[1] as string, fileMatch[2] as string, {
          content: body.content,
          ...(typeof body.ifRevision === "string" ? { ifRevision: body.ifRevision } : {}),
        });
        response.setHeader("ETag", `"${file.revision}"`);
        sendJson(response, 200, file);
        return;
      }

      const buildMatch = /^\/api\/projects\/([^/]+)\/build$/.exec(pathname);
      if (buildMatch && request.method === "POST") {
        const body = parseJsonBuffer(await readRequestBody(request, 16 * 1024));
        const validateOnly = isJsonObject(body) && body.validateOnly === true;
        let built;
        try {
          built = await store.buildProject(buildMatch[1] as string);
        } catch (error) {
          const apiError = asApiError(error);
          if (!validateOnly || apiError.status !== 422) throw error;
          const path = isJsonObject(apiError.details) && typeof apiError.details.path === "string"
            ? apiError.details.path
            : undefined;
          sendJson(response, 200, {
            success: false,
            revision: "",
            size: 0,
            diagnostics: [{
              level: "error",
              code: apiError.code,
              message: apiError.message,
              ...(path === undefined ? {} : { path }),
            }],
          });
          return;
        }
        if (validateOnly) {
          sendJson(response, 200, {
            success: !built.diagnostics.some((diagnostic) => diagnostic.level === "error"),
            revision: built.revision,
            size: built.size,
            diagnostics: built.diagnostics,
          });
          return;
        }
        sendJson(response, 200, {
          success: true,
          preset: built.preset,
          diagnostics: built.diagnostics,
          artifact: { size: built.size, revision: built.revision },
        });
        return;
      }
      const exportMatch = /^\/api\/projects\/([^/]+)\/export$/.exec(pathname);
      if (exportMatch && request.method === "POST") {
        const projectId = exportMatch[1] as string;
        const exported = await store.exportProject(projectId);
        sendJson(response, 201, {
          success: true,
          ...exported,
          downloadUrl: `/api/projects/${encodeURIComponent(projectId)}/outputs/${encodeURIComponent(exported.filename)}`,
        });
        return;
      }
      const outputsMatch = /^\/api\/projects\/([^/]+)\/outputs$/.exec(pathname);
      if (outputsMatch && request.method === "GET") {
        sendJson(response, 200, { outputs: await store.listOutputs(outputsMatch[1] as string) });
        return;
      }
      const outputMatch = /^\/api\/projects\/([^/]+)\/outputs\/([^/]+)$/.exec(pathname);
      if (outputMatch && request.method === "GET") {
        const output = await store.readOutput(outputMatch[1] as string, decodeURIComponent(outputMatch[2] as string));
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Content-Length", output.content.length);
        response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(output.filename)}`);
        response.end(output.content);
        return;
      }

      if (await serveStatic(request, response, staticRoot, pathname)) return;
      throw new ApiError(404, "NOT_FOUND", "Route does not exist");
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.destroy(error instanceof Error ? error : undefined);
    }
  });

  server.on("close", () => stSessions.close());
  return { server, store, stSessions };
}
