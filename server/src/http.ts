import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ARCHIVE_LIMITS, type ArchiveLimits } from "./archive.js";
import { BridgeManager, type BridgeManagerOptions } from "./bridge.js";
import { ApiError, asApiError } from "./errors.js";
import { buildExtensionArchive, EXTENSION_ARCHIVE_FILENAME } from "./extension-archive.js";
import { isJsonObject } from "./json.js";
import { ProjectStore } from "./project-store.js";
import type { ImportProjectInput, JsonObject } from "./types.js";

const DEFAULT_BODY_LIMIT = 64 * 1024 * 1024;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

export interface ApiServerOptions {
  workspaceRoot?: string;
  bodyLimitBytes?: number;
  staticRoot?: string | false;
  archiveLimits?: Partial<ArchiveLimits>;
  allowedOrigins?: string[];
  exposeWorkspacePath?: boolean;
  bridgeOptions?: Partial<BridgeManagerOptions>;
  extensionRoot?: string;
}

interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

const CORS_METHODS = ["GET", "HEAD", "POST", "PUT", "OPTIONS"] as const;
const CORS_HEADERS = ["content-type", "if-match", "x-project-name", "x-project-version"] as const;

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

function normalizeConfiguredOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid PRESET_STUDIO_ALLOWED_ORIGINS entry: ${value}`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Allowed origin must be an HTTP(S) origin without path, query, or credentials: ${value}`);
  }
  return url.origin;
}

function configuredOrigins(options: ApiServerOptions): Set<string> {
  const values = options.allowedOrigins ?? (process.env.PRESET_STUDIO_ALLOWED_ORIGINS ?? "").split(",");
  return new Set(values.map((value) => value.trim()).filter(Boolean).map(normalizeConfiguredOrigin));
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
): void {
  const header = request.headers.origin;
  if (header === undefined) return; // CLI, healthcheck, and server-to-server requests.
  let origin: string;
  try {
    origin = normalizeConfiguredOrigin(header);
  } catch {
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Request Origin is not allowed");
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
    return {
      preset: parsed,
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
      ...(sourcePresetName === undefined ? {} : { sourcePresetName }),
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
): Promise<{ archive: Buffer; name?: string; version?: string }> {
  const contentType = request.headers["content-type"] ?? "application/octet-stream";
  const multipartAllowance = 1024 * 1024;
  const body = await readRequestBody(request, maxArchiveBytes + multipartAllowance);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const parts = parseMultipart(body, contentType);
    const file = parts.find((part) => part.name === "file");
    if (!file) throw new ApiError(400, "FILE_REQUIRED", "Multipart project import requires a file field");
    const name = textPart(parts, "name");
    const version = textPart(parts, "version");
    return {
      archive: file.data,
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
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
  bridge: BridgeManager;
} {
  const workspaceRoot = options.workspaceRoot ?? process.env.PRESET_STUDIO_WORKSPACE ?? join(REPOSITORY_ROOT, "workspace-data");
  const bodyLimit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT;
  const staticRoot = options.staticRoot ?? process.env.PRESET_STUDIO_STATIC_ROOT ?? join(REPOSITORY_ROOT, "dist");
  const extensionRoot = options.extensionRoot ?? join(REPOSITORY_ROOT, "sillytavern-extension");
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
  const exposeWorkspacePath = options.exposeWorkspacePath
    ?? process.env.PRESET_STUDIO_EXPOSE_WORKSPACE_PATH?.toLowerCase() === "true";
  const environmentBridgeOptions: Partial<BridgeManagerOptions> = {
    // positiveEnvironmentNumber only applies the multiplier to configured
    // values, so fallbacks are already expressed in their target units.
    pairingTtlMs: positiveEnvironmentNumber("PRESET_STUDIO_PAIRING_TTL_SECONDS", 300_000, 1000),
    resumeTtlMs: positiveEnvironmentNumber("PRESET_STUDIO_BRIDGE_RESUME_TTL_SECONDS", 1_800_000, 1000),
    helloTimeoutMs: positiveEnvironmentNumber("PRESET_STUDIO_BRIDGE_HELLO_TIMEOUT_SECONDS", 10_000, 1000),
    heartbeatIntervalMs: positiveEnvironmentNumber("PRESET_STUDIO_BRIDGE_HEARTBEAT_SECONDS", 15_000, 1000),
    heartbeatTimeoutMs: positiveEnvironmentNumber("PRESET_STUDIO_BRIDGE_HEARTBEAT_TIMEOUT_SECONDS", 45_000, 1000),
    rpcTimeoutMs: positiveEnvironmentNumber("PRESET_STUDIO_BRIDGE_RPC_TIMEOUT_SECONDS", 30_000, 1000),
    maxMessageBytes: positiveEnvironmentNumber(
      "PRESET_STUDIO_BRIDGE_MAX_MESSAGE_MIB",
      32 * 1024 * 1024,
      1024 * 1024,
    ),
  };
  let bridge!: BridgeManager;

  const server = createServer(async (request, response) => {
    setCommonHeaders(response);
    try {
      authorizeOrigin(request, response, allowedOrigins);
      if (request.method === "OPTIONS") {
        handlePreflight(request, response);
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = url.pathname;
      if (pathname === "/api/health" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          ...(exposeWorkspacePath ? { workspaceRoot: store.workspaceRoot } : {}),
        });
        return;
      }
      if (pathname === "/api/st/pairing" && request.method === "POST") {
        const pairingBody = await readRequestBody(request, 16 * 1024);
        if (pairingBody.length > 0 && !isJsonObject(parseJsonBuffer(pairingBody))) {
          throw new ApiError(400, "INVALID_INPUT", "Pairing request body must be an object when provided");
        }
        sendJson(response, 201, bridge.createPairing());
        return;
      }
      if (pathname === "/api/st/extension/archive" && request.method === "GET") {
        const archive = await buildExtensionArchive(extensionRoot);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader("Content-Length", archive.length);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(EXTENSION_ARCHIVE_FILENAME)}`,
        );
        response.setHeader("Cache-Control", "no-store");
        response.end(archive);
        return;
      }
      if (pathname === "/api/st/connections" && request.method === "GET") {
        sendJson(response, 200, { connections: bridge.listConnections() });
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
        const body = parseJsonBuffer(await readRequestBody(request, bodyLimit));
        if (!isJsonObject(body) || typeof body.connectionId !== "string" || !body.connectionId) {
          throw new ApiError(400, "INVALID_INPUT", "connectionId is required");
        }
        const rpcResult = await bridge.request(body.connectionId, "preset.pull", {});
        if (
          !isJsonObject(rpcResult) ||
          typeof rpcResult.name !== "string" ||
          rpcResult.name.trim().length === 0 ||
          rpcResult.name.length > 120 ||
          !isJsonObject(rpcResult.preset)
        ) {
          throw new ApiError(502, "RPC_INVALID_PRESET", "preset.pull returned an invalid name or preset object");
        }
        const connection = bridge.listConnections().find((item) => item.connectionId === body.connectionId);
        const sourcePresetName = rpcResult.name.trim();
        const project = await store.importProject({
          preset: rpcResult.preset,
          sourceType: "sillytavern",
          sourcePresetName,
          ...(connection?.st.version ? { sourceStVersion: connection.st.version } : {}),
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.version === "string" ? { version: body.version } : {}),
        });
        sendJson(response, 201, {
          project,
          source: { connectionId: body.connectionId, presetName: sourcePresetName },
        });
        return;
      }

      const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
      if (projectMatch && request.method === "GET") {
        sendJson(response, 200, { project: await store.getProject(projectMatch[1] as string) });
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
        const built = await store.buildProject(buildMatch[1] as string);
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

  bridge = new BridgeManager(server, { ...environmentBridgeOptions, ...options.bridgeOptions });
  return { server, store, bridge };
}
