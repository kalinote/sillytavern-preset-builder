export type StConnectionStatus = "connected" | "disconnected";

export interface StPairing {
  pairingCode: string;
  expiresAt: string;
  bridgePath: string;
}

export interface StInstanceInfo {
  version: string;
  branch: string | null;
  url: string | null;
}

export interface StConnection {
  connectionId: string;
  status: StConnectionStatus;
  protocolVersion: number;
  bridgeVersion: string;
  st: StInstanceInfo;
  capabilities: string[];
  context: Record<string, unknown> | null;
  connectedAt: string;
  lastSeenAt: string;
  resumableUntil: string | null;
}

export interface StBridgeRequestOptions {
  signal?: AbortSignal;
}

export interface StExtensionArchiveDownload {
  blob: Blob;
  filename: string;
  size: number;
  contentType: string;
}

export interface StBridgeApi {
  createPairing(options?: StBridgeRequestOptions): Promise<StPairing>;
  listConnections(options?: StBridgeRequestOptions): Promise<StConnection[]>;
  downloadExtensionArchive(
    options?: StBridgeRequestOptions,
  ): Promise<StExtensionArchiveDownload>;
}

export interface StBridgeApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface StBridgeApiErrorOptions {
  method: string;
  url: string;
  status: number;
  statusText?: string;
  code?: string;
  details?: unknown;
  requestId?: string | null;
  cause?: unknown;
}

export class StBridgeApiError extends Error {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId: string | null;

  constructor(message: string, options: StBridgeApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "StBridgeApiError";
    this.method = options.method;
    this.url = options.url;
    this.status = options.status;
    this.statusText = options.statusText ?? "";
    this.code = options.code ?? "ST_BRIDGE_API_ERROR";
    this.details = options.details;
    this.requestId = options.requestId ?? null;
  }
}

const ST_API_ROOT = "/api/st";

export const ST_BRIDGE_ENDPOINTS = {
  pairing: `${ST_API_ROOT}/pairing`,
  connections: `${ST_API_ROOT}/connections`,
  extensionArchive: `${ST_API_ROOT}/extension/archive`,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, context: string) {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${context}.${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function parsePairing(value: unknown): StPairing {
  if (!isRecord(value)) throw new TypeError("Pairing response must be an object");
  return {
    pairingCode: requiredString(value, "pairingCode", "pairing"),
    expiresAt: requiredString(value, "expiresAt", "pairing"),
    bridgePath: requiredString(value, "bridgePath", "pairing"),
  };
}

function parseConnection(value: unknown): StConnection {
  if (!isRecord(value)) throw new TypeError("ST connection must be an object");
  if (value.status !== "connected" && value.status !== "disconnected") {
    throw new TypeError("connection.status must be connected or disconnected");
  }
  if (!isRecord(value.st)) throw new TypeError("connection.st must be an object");
  if (!Array.isArray(value.capabilities) || value.capabilities.some((item) => typeof item !== "string")) {
    throw new TypeError("connection.capabilities must be a string array");
  }
  if (typeof value.protocolVersion !== "number" || !Number.isFinite(value.protocolVersion)) {
    throw new TypeError("connection.protocolVersion must be a number");
  }
  if (value.context !== undefined && value.context !== null && !isRecord(value.context)) {
    throw new TypeError("connection.context must be an object when present");
  }

  return {
    connectionId: requiredString(value, "connectionId", "connection"),
    status: value.status,
    protocolVersion: value.protocolVersion,
    bridgeVersion: requiredString(value, "bridgeVersion", "connection"),
    st: {
      version: requiredString(value.st, "version", "connection.st"),
      branch: optionalString(value.st.branch),
      url: optionalString(value.st.url),
    },
    capabilities: value.capabilities as string[],
    context: isRecord(value.context) ? value.context : null,
    connectedAt: requiredString(value, "connectedAt", "connection"),
    lastSeenAt: requiredString(value, "lastSeenAt", "connection"),
    resumableUntil: optionalString(value.resumableUntil),
  };
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}

async function readJson(response: Response, method: "GET" | "POST") {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new StBridgeApiError("Bridge service returned malformed JSON", {
      method,
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      code: "INVALID_RESPONSE",
      cause,
    });
  }
}

function responseError(method: string, url: string, response: Response, payload: unknown) {
  const envelope = isRecord(payload) && isRecord(payload.error) ? payload.error : payload;
  const error = isRecord(envelope) ? envelope : {};
  return new StBridgeApiError(
    typeof error.message === "string"
      ? error.message
      : `${method} ${url} failed with ${response.status}`,
    {
      method,
      url,
      status: response.status,
      statusText: response.statusText,
      code: typeof error.code === "string" ? error.code : "HTTP_ERROR",
      details: error.details ?? payload,
      requestId: response.headers.get("x-request-id"),
    },
  );
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

export class StBridgeApiClient implements StBridgeApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: StBridgeApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request(path: string, method: "GET" | "POST", signal?: AbortSignal) {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        signal,
        headers: { Accept: "application/json" },
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new StBridgeApiError("Unable to reach the SillyTavern Bridge service", {
        method,
        url,
        status: 0,
        code: "NETWORK_ERROR",
        cause,
      });
    }

    const payload = await readJson(response, method);
    if (!response.ok) throw responseError(method, url, response, payload);
    return payload;
  }

  async createPairing(options: StBridgeRequestOptions = {}) {
    const payload = await this.request(ST_BRIDGE_ENDPOINTS.pairing, "POST", options.signal);
    return parsePairing(isRecord(payload) && "pairing" in payload ? payload.pairing : payload);
  }

  async listConnections(options: StBridgeRequestOptions = {}) {
    const payload = await this.request(ST_BRIDGE_ENDPOINTS.connections, "GET", options.signal);
    const connections = isRecord(payload) ? payload.connections : payload;
    if (!Array.isArray(connections)) {
      throw new TypeError("Connection list response must contain an array");
    }
    return connections.map(parseConnection);
  }

  async downloadExtensionArchive(
    options: StBridgeRequestOptions = {},
  ): Promise<StExtensionArchiveDownload> {
    const method = "GET" as const;
    const url = `${this.baseUrl}${ST_BRIDGE_ENDPOINTS.extensionArchive}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        signal: options.signal,
        cache: "no-store",
        headers: { Accept: "application/zip, application/json;q=0.8" },
      });
    } catch (cause) {
      if (isAbortError(cause)) throw cause;
      throw new StBridgeApiError("Unable to download the Bridge extension", {
        method,
        url,
        status: 0,
        code: "NETWORK_ERROR",
        cause,
      });
    }

    if (!response.ok) {
      const payload = await readJson(response, method);
      throw responseError(method, url, response, payload);
    }

    const blob = await response.blob();
    return {
      blob,
      filename:
        filenameFromDisposition(response.headers.get("content-disposition")) ??
        "preset-studio-bridge.zip",
      size: blob.size,
      contentType: response.headers.get("content-type") ?? "application/zip",
    };
  }
}

export function deriveBridgeWebSocketUrl(
  bridgePath: string,
  location: Pick<Location, "protocol" | "host"> = window.location,
) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return new URL(bridgePath, `${protocol}//${location.host}`).toString();
}

export const stBridgeApi = new StBridgeApiClient();
