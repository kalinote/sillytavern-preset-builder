import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { ApiError } from "./errors.js";

export type StTargetPolicy = "allowlist" | "private" | "any";

export interface StHttpClientOptions {
  origin: string;
  basicAuth?: { username: string; password: string };
  targetPolicy: StTargetPolicy;
  allowedOrigins: ReadonlySet<string>;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  responseLimitBytes: number;
}

export interface StHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: unknown;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK_ADDRESSES.addAddress("::1", "ipv6");

const PRIVATE_ADDRESSES = new BlockList();
PRIVATE_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_ADDRESSES.addSubnet("fc00::", 7, "ipv6");

const FORBIDDEN_SPECIAL_ADDRESSES = new BlockList();
FORBIDDEN_SPECIAL_ADDRESSES.addSubnet("0.0.0.0", 8, "ipv4");
FORBIDDEN_SPECIAL_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4");
FORBIDDEN_SPECIAL_ADDRESSES.addSubnet("224.0.0.0", 4, "ipv4");
FORBIDDEN_SPECIAL_ADDRESSES.addSubnet("240.0.0.0", 4, "ipv4");
FORBIDDEN_SPECIAL_ADDRESSES.addAddress("::", "ipv6");
FORBIDDEN_SPECIAL_ADDRESSES.addSubnet("fe80::", 10, "ipv6");
FORBIDDEN_SPECIAL_ADDRESSES.addSubnet("ff00::", 8, "ipv6");

const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_COOKIES = 50;
const MAX_COOKIE_BYTES = 32 * 1024;

function addressType(family: 4 | 6): "ipv4" | "ipv6" {
  return family === 4 ? "ipv4" : "ipv6";
}

function withoutIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function normalizeStOrigin(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new ApiError(400, "ST_TARGET_INVALID", "SillyTavern origin must be a valid absolute URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ApiError(
      400,
      "ST_TARGET_INVALID",
      "SillyTavern origin must be an HTTP(S) origin without credentials, path, query, or fragment",
    );
  }
  return parsed.origin;
}

export function parseStTargetPolicy(value: string | undefined): StTargetPolicy {
  const normalized = value?.trim().toLowerCase() || "allowlist";
  if (normalized === "allowlist" || normalized === "private" || normalized === "any") return normalized;
  throw new Error("PRESET_STUDIO_ST_TARGET_POLICY must be allowlist, private, or any");
}

export function parseStAllowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map(normalizeStOrigin),
  );
}

function isLoopback(address: ResolvedAddress): boolean {
  return LOOPBACK_ADDRESSES.check(address.address, addressType(address.family));
}

function isPrivate(address: ResolvedAddress): boolean {
  return isLoopback(address) || PRIVATE_ADDRESSES.check(address.address, addressType(address.family));
}

function isForbiddenSpecial(address: ResolvedAddress): boolean {
  // Reject IPv4-mapped IPv6 spellings instead of risking classifier ambiguity.
  if (address.family === 6 && /^::ffff:/i.test(address.address)) return true;
  return FORBIDDEN_SPECIAL_ADDRESSES.check(address.address, addressType(address.family));
}

async function resolveAndAuthorizeTarget(
  origin: string,
  policy: StTargetPolicy,
  allowedOrigins: ReadonlySet<string>,
  connectTimeoutMs: number,
): Promise<ResolvedAddress[]> {
  const url = new URL(origin);
  const hostname = withoutIpv6Brackets(url.hostname);
  let addresses: ResolvedAddress[];
  try {
    if (isIP(hostname)) {
      addresses = [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
    } else {
      let timeout: NodeJS.Timeout | undefined;
      try {
        const resolved = await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(new ApiError(504, "ST_CONNECT_TIMEOUT", "Timed out resolving the SillyTavern host"));
            }, connectTimeoutMs);
            timeout.unref();
          }),
        ]);
        addresses = resolved.map((item) => ({ address: item.address, family: item.family as 4 | 6 }));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, "ST_DNS_FAILED", "Unable to resolve the SillyTavern host", {
      reason: error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "DNS_ERROR",
    });
  }
  addresses = [...new Map(addresses.map((item) => [`${item.family}:${item.address}`, item])).values()];
  if (addresses.length === 0) throw new ApiError(502, "ST_DNS_FAILED", "SillyTavern host resolved to no addresses");
  if (addresses.some(isForbiddenSpecial)) {
    throw new ApiError(403, "ST_TARGET_NOT_ALLOWED", "SillyTavern target resolves to a forbidden special address");
  }

  const allowed = policy === "any"
    || (policy === "private" && addresses.every(isPrivate))
    || (policy === "allowlist" && (allowedOrigins.has(origin) || addresses.every(isLoopback)));
  if (!allowed) {
    throw new ApiError(403, "ST_TARGET_NOT_ALLOWED", "SillyTavern target is not permitted by the configured policy", {
      policy,
    });
  }
  return addresses;
}

class StCookieJar {
  private readonly cookies = new Map<string, string>();

  capture(setCookieHeaders: string[] | undefined): void {
    for (const header of setCookieHeaders ?? []) {
      const parts = header.split(";");
      const pair = parts[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!COOKIE_NAME.test(name) || Buffer.byteLength(name) + Buffer.byteLength(value) > 8192) continue;
      const attributes = parts.slice(1).map((item) => item.trim().toLowerCase());
      const expired = attributes.some((item) => item === "max-age=0")
        || attributes.some((item) => {
          if (!item.startsWith("expires=")) return false;
          const expiresAt = Date.parse(item.slice("expires=".length));
          return Number.isFinite(expiresAt) && expiresAt <= Date.now();
        });
      if (expired || value === "") this.cookies.delete(name);
      else if (this.cookies.has(name) || this.cookies.size < MAX_COOKIES) this.cookies.set(name, value);
    }
  }

  header(): string | undefined {
    const value = [...this.cookies].map(([name, cookie]) => `${name}=${cookie}`).join("; ");
    return value && Buffer.byteLength(value) <= MAX_COOKIE_BYTES ? value : undefined;
  }

  clear(): void {
    this.cookies.clear();
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function transportError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "NETWORK_ERROR";
  const tlsCodes = new Set([
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ]);
  return new ApiError(
    502,
    tlsCodes.has(code) ? "ST_TLS_ERROR" : "ST_UNREACHABLE",
    tlsCodes.has(code) ? "SillyTavern TLS validation failed" : "Unable to reach SillyTavern",
    { reason: code },
  );
}

const RETRYABLE_CONNECT_REASONS = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL"]);

function isRetryableAddressFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "ST_CONNECT_TIMEOUT") return true;
  if (error.code !== "ST_UNREACHABLE" || typeof error.details !== "object" || error.details === null) return false;
  const reason = (error.details as { reason?: unknown }).reason;
  return typeof reason === "string" && RETRYABLE_CONNECT_REASONS.has(reason);
}

export class StHttpClient {
  readonly origin: string;
  readonly usesBasicAuth: boolean;
  private readonly options: Omit<StHttpClientOptions, "origin" | "basicAuth">;
  private basicAuthorization?: string;
  private readonly cookieJar = new StCookieJar();

  constructor(options: StHttpClientOptions) {
    this.origin = normalizeStOrigin(options.origin);
    this.usesBasicAuth = options.basicAuth !== undefined;
    this.options = {
      targetPolicy: options.targetPolicy,
      allowedOrigins: options.allowedOrigins,
      connectTimeoutMs: options.connectTimeoutMs,
      requestTimeoutMs: options.requestTimeoutMs,
      responseLimitBytes: options.responseLimitBytes,
    };
    if (options.basicAuth) {
      this.basicAuthorization = `Basic ${Buffer.from(
        `${options.basicAuth.username}:${options.basicAuth.password}`,
        "utf8",
      ).toString("base64")}`;
    }
  }

  async request(
    path: string,
    options: { method?: "GET" | "POST"; body?: unknown; csrfToken?: string } = {},
  ): Promise<StHttpResponse> {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new ApiError(500, "ST_CLIENT_PATH_INVALID", "Internal SillyTavern request path is invalid");
    }
    const url = new URL(path, `${this.origin}/`);
    if (url.origin !== this.origin) {
      throw new ApiError(500, "ST_CLIENT_PATH_INVALID", "Internal SillyTavern request escaped its configured origin");
    }
    const addresses = await resolveAndAuthorizeTarget(
      this.origin,
      this.options.targetPolicy,
      this.options.allowedOrigins,
      this.options.connectTimeoutMs,
    );
    const method = options.method ?? "GET";
    const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    const cookie = this.cookieJar.header();
    const headers: Record<string, string | number> = {
      Accept: "application/json",
      "User-Agent": "SillyTavern-Preset-Studio/0.1",
      Connection: "close",
      ...(body === undefined ? {} : { "Content-Type": "application/json", "Content-Length": body.byteLength }),
      ...(cookie === undefined ? {} : { Cookie: cookie }),
      ...(this.basicAuthorization === undefined ? {} : { Authorization: this.basicAuthorization }),
      ...(options.csrfToken === undefined ? {} : { "X-CSRF-Token": options.csrfToken }),
    };

    let lastError: unknown;
    for (const selected of addresses) {
      try {
        return await new Promise<StHttpResponse>((resolve, reject) => {
      let settled = false;
      let connectTimer: NodeJS.Timeout | undefined;
      const overallTimer = setTimeout(() => {
        request.destroy(new ApiError(504, "ST_TIMEOUT", "SillyTavern request timed out"));
      }, this.options.requestTimeoutMs);
      overallTimer.unref();
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(overallTimer);
        if (connectTimer) clearTimeout(connectTimer);
        reject(transportError(error));
      };
      const requestOptions: RequestOptions = {
        protocol: url.protocol,
        hostname: withoutIpv6Brackets(url.hostname),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        family: selected.family,
        agent: false,
        lookup: ((_hostname, _lookupOptions, callback) => {
          (callback as (error: NodeJS.ErrnoException | null, address: string, family: number) => void)(
            null,
            selected.address,
            selected.family,
          );
        }) as NonNullable<RequestOptions["lookup"]>,
      };
      const requester = url.protocol === "https:" ? httpsRequest : httpRequest;
      const request = requester(requestOptions, (response) => {
        if (connectTimer) clearTimeout(connectTimer);
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          finishReject(new ApiError(502, "ST_REDIRECT_REJECTED", "SillyTavern returned a redirect; redirects are disabled"));
          return;
        }
        this.cookieJar.capture(response.headers["set-cookie"]);
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.byteLength;
          if (total > this.options.responseLimitBytes) {
            response.destroy(new ApiError(502, "ST_RESPONSE_TOO_LARGE", "SillyTavern response exceeds the configured limit"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("error", finishReject);
        response.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(overallTimer);
          const text = Buffer.concat(chunks, total).toString("utf8");
          resolve({ status, headers: response.headers, text, json: parseJson(text) });
        });
      });
      request.on("socket", (socket) => {
        if (!socket.connecting) return;
        connectTimer = setTimeout(() => {
          request.destroy(new ApiError(504, "ST_CONNECT_TIMEOUT", "Timed out connecting to SillyTavern"));
        }, this.options.connectTimeoutMs);
        connectTimer.unref();
        const connectedEvent = url.protocol === "https:" ? "secureConnect" : "connect";
        socket.once(connectedEvent, () => {
          if (connectTimer) clearTimeout(connectTimer);
        });
      });
      request.on("error", finishReject);
      if (body) request.write(body);
          request.end();
        });
      } catch (error) {
        lastError = error;
        if (!isRetryableAddressFailure(error)) throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ApiError(502, "ST_UNREACHABLE", "Unable to reach SillyTavern");
  }

  clearSensitiveState(): void {
    delete this.basicAuthorization;
    this.cookieJar.clear();
  }
}
