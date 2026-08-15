import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { ApiError } from "./errors.js";
import { isJsonObject } from "./json.js";
import type { JsonObject, JsonValue } from "./types.js";

export const BRIDGE_PATH = "/bridge";
export const BRIDGE_PROTOCOL_VERSION = 1;

export interface BridgeManagerOptions {
  pairingTtlMs: number;
  resumeTtlMs: number;
  helloTimeoutMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  rpcTimeoutMs: number;
  maxMessageBytes: number;
  maxPairingCodes: number;
  maxConnections: number;
  maxPendingRpcPerConnection: number;
}

const DEFAULT_OPTIONS: BridgeManagerOptions = {
  pairingTtlMs: 5 * 60_000,
  resumeTtlMs: 30 * 60_000,
  helloTimeoutMs: 10_000,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 45_000,
  rpcTimeoutMs: 30_000,
  maxMessageBytes: 32 * 1024 * 1024,
  maxPairingCodes: 20,
  maxConnections: 100,
  maxPendingRpcPerConnection: 32,
};

interface PairingRecord {
  expiresAt: number;
}

interface BridgeHello {
  bridgeVersion: string;
  st: {
    version: string;
    branch?: string;
    url?: string;
  };
  capabilities: string[];
  context?: JsonObject;
  pairingCode?: string;
  resumeToken?: string;
}

interface PendingRpc {
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface ConnectionRecord {
  connectionId: string;
  protocolVersion: 1;
  bridgeVersion: string;
  st: BridgeHello["st"];
  capabilities: string[];
  context?: JsonObject;
  origin: string;
  connectedAt: number;
  lastSeenAt: number;
  lastPongAt: number;
  resumableUntil: number;
  resumeTokenHash: string;
  socket?: WebSocket;
  pendingRpc: Map<string, PendingRpc>;
}

export interface PublicBridgeConnection {
  connectionId: string;
  status: "connected" | "disconnected";
  protocolVersion: 1;
  bridgeVersion: string;
  st: BridgeHello["st"];
  capabilities: string[];
  context?: JsonObject;
  connectedAt: string;
  lastSeenAt: string;
  resumableUntil: string;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function parseOrigin(request: IncomingMessage): string {
  const raw = request.headers.origin;
  if (!raw || raw.length > 512) {
    throw new ApiError(403, "BRIDGE_ORIGIN_REQUIRED", "WebSocket upgrade requires an HTTP(S) Origin");
  }
  try {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== raw) throw new Error("invalid");
    return url.origin;
  } catch {
    throw new ApiError(403, "BRIDGE_ORIGIN_INVALID", "WebSocket Origin must be an HTTP(S) origin");
  }
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = Buffer.from(message);
  const reason = status === 403 ? "Forbidden" : status === 404 ? "Not Found" : "Bad Request";
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n`,
  );
  socket.write(body);
  socket.destroy();
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function requireShortString(value: JsonValue | undefined, field: string, maxLength = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ApiError(400, "INVALID_HELLO", `${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function parseHello(value: unknown, origin: string): BridgeHello {
  if (!isJsonObject(value) || value.type !== "bridge.hello") {
    throw new ApiError(400, "HELLO_REQUIRED", "The first Bridge message must be bridge.hello");
  }
  if (value.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw new ApiError(400, "PROTOCOL_VERSION_UNSUPPORTED", "Bridge protocolVersion must be 1");
  }
  if (!isJsonObject(value.st)) throw new ApiError(400, "INVALID_HELLO", "st must be an object");
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 128) {
    throw new ApiError(400, "INVALID_HELLO", "capabilities must be an array with at most 128 entries");
  }
  const capabilities = value.capabilities.map((capability, index) =>
    requireShortString(capability, `capabilities[${index}]`, 128));
  if (new Set(capabilities).size !== capabilities.length) {
    throw new ApiError(400, "INVALID_HELLO", "capabilities must not contain duplicates");
  }
  const pairingCode = typeof value.pairingCode === "string" ? value.pairingCode : undefined;
  const resumeToken = typeof value.resumeToken === "string" ? value.resumeToken : undefined;
  if ((pairingCode === undefined) === (resumeToken === undefined)) {
    throw new ApiError(400, "PAIRING_CODE_REQUIRED", "Exactly one of pairingCode or resumeToken is required");
  }

  const stUrl = typeof value.st.url === "string" ? value.st.url : undefined;
  if (stUrl !== undefined) {
    if (stUrl.length > 2048) throw new ApiError(400, "INVALID_HELLO", "st.url is too long");
    try {
      const parsed = new URL(stUrl);
      if (parsed.origin !== origin) {
        throw new ApiError(403, "ORIGIN_MISMATCH", "st.url origin does not match the WebSocket Origin");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "INVALID_HELLO", "st.url must be an absolute HTTP(S) URL");
    }
  }
  const context = value.context === undefined
    ? undefined
    : isJsonObject(value.context)
      ? structuredClone(value.context)
      : (() => { throw new ApiError(400, "INVALID_HELLO", "context must be an object"); })();

  return {
    bridgeVersion: requireShortString(value.bridgeVersion, "bridgeVersion", 128),
    st: {
      version: requireShortString(value.st.version, "st.version", 128),
      ...(typeof value.st.branch === "string"
        ? { branch: requireShortString(value.st.branch, "st.branch", 128) }
        : {}),
      ...(stUrl === undefined ? {} : { url: stUrl }),
    },
    capabilities,
    ...(context === undefined ? {} : { context }),
    ...(pairingCode === undefined ? {} : { pairingCode }),
    ...(resumeToken === undefined ? {} : { resumeToken }),
  };
}

function publicConnection(record: ConnectionRecord): PublicBridgeConnection {
  return {
    connectionId: record.connectionId,
    status: record.socket?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    bridgeVersion: record.bridgeVersion,
    st: structuredClone(record.st),
    capabilities: [...record.capabilities],
    ...(record.context === undefined ? {} : { context: structuredClone(record.context) }),
    connectedAt: new Date(record.connectedAt).toISOString(),
    lastSeenAt: new Date(record.lastSeenAt).toISOString(),
    resumableUntil: new Date(record.resumableUntil).toISOString(),
  };
}

export class BridgeManager {
  readonly options: BridgeManagerOptions;
  private readonly server: Server;
  private readonly webSocketServer: WebSocketServer;
  private readonly pairingCodes = new Map<string, PairingRecord>();
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly resumeTokens = new Map<string, string>();
  private readonly unauthenticatedSockets = new Set<WebSocket>();
  private readonly heartbeatTimer: NodeJS.Timeout;
  private closed = false;

  constructor(server: Server, options: Partial<BridgeManagerOptions> = {}) {
    this.server = server;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: this.options.maxMessageBytes });
    this.server.on("upgrade", this.handleUpgrade);
    this.server.on("close", this.close);
    this.webSocketServer.on("connection", (socket, request) => this.handleSocket(socket, request));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.options.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  createPairing(): { pairingCode: string; expiresAt: string; bridgePath: typeof BRIDGE_PATH } {
    this.cleanupExpired();
    const activePairingCodes = [...this.pairingCodes.values()].filter((record) => record.expiresAt > Date.now()).length;
    if (activePairingCodes >= this.options.maxPairingCodes) {
      throw new ApiError(429, "PAIRING_LIMIT_REACHED", "Too many active pairing codes");
    }
    let pairingCode: string;
    let hash: string;
    do {
      pairingCode = createSecret(12);
      hash = tokenHash(pairingCode);
    } while (this.pairingCodes.has(hash));
    const expiresAt = Date.now() + this.options.pairingTtlMs;
    this.pairingCodes.set(hash, { expiresAt });
    return { pairingCode, expiresAt: new Date(expiresAt).toISOString(), bridgePath: BRIDGE_PATH };
  }

  listConnections(): PublicBridgeConnection[] {
    this.cleanupExpired();
    return [...this.connections.values()]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .map(publicConnection);
  }

  async request(
    connectionId: string,
    method: "preset.pull",
    params: JsonObject = {},
    timeoutMs = this.options.rpcTimeoutMs,
  ): Promise<unknown> {
    this.cleanupExpired();
    const connection = this.connections.get(connectionId);
    if (!connection) throw new ApiError(404, "BRIDGE_CONNECTION_NOT_FOUND", "Bridge connection does not exist");
    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new ApiError(409, "BRIDGE_DISCONNECTED", "Bridge connection is currently disconnected");
    }
    if (!connection.capabilities.includes(method)) {
      throw new ApiError(409, "BRIDGE_CAPABILITY_UNAVAILABLE", `Bridge does not advertise ${method}`);
    }
    if (connection.pendingRpc.size >= this.options.maxPendingRpcPerConnection) {
      throw new ApiError(429, "BRIDGE_RPC_LIMIT", "Too many RPC requests are pending for this connection");
    }
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pendingRpc.delete(id);
        reject(new ApiError(504, "RPC_TIMEOUT", `Bridge RPC ${method} timed out`));
      }, timeoutMs);
      timer.unref();
      connection.pendingRpc.set(id, { timer, resolve, reject });
      const message = JSON.stringify({ type: "rpc.request", id, method, params });
      socket.send(message, (error) => {
        if (!error) return;
        const pending = connection.pendingRpc.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        connection.pendingRpc.delete(id);
        pending.reject(new ApiError(503, "BRIDGE_SEND_FAILED", "Failed to send Bridge RPC request"));
      });
    });
  }

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    this.server.off("upgrade", this.handleUpgrade);
    for (const socket of this.unauthenticatedSockets) socket.terminate();
    for (const connection of this.connections.values()) {
      this.rejectPending(connection, new ApiError(503, "BRIDGE_CLOSED", "Bridge service is shutting down"));
      connection.socket?.terminate();
      delete connection.socket;
    }
    this.webSocketServer.close();
  };

  private handleUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (this.closed) {
      rejectUpgrade(socket, 503, "Bridge service is shutting down");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "", "http://localhost");
    } catch {
      rejectUpgrade(socket, 400, "Invalid WebSocket URL");
      return;
    }
    if (url.pathname !== BRIDGE_PATH || url.search) {
      rejectUpgrade(socket, 404, "Bridge endpoint not found");
      return;
    }
    try {
      parseOrigin(request);
    } catch (error) {
      rejectUpgrade(socket, error instanceof ApiError ? error.status : 403, "Bridge Origin is not allowed");
      return;
    }
    if (this.unauthenticatedSockets.size >= this.options.maxPairingCodes + 10) {
      rejectUpgrade(socket, 503, "Too many unauthenticated Bridge connections");
      return;
    }
    this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.webSocketServer.emit("connection", webSocket, request);
    });
  };

  private handleSocket(socket: WebSocket, request: IncomingMessage): void {
    const origin = parseOrigin(request);
    this.unauthenticatedSockets.add(socket);
    let connection: ConnectionRecord | undefined;
    const helloTimer = setTimeout(() => {
      if (!connection) this.failSocket(socket, 1008, "HELLO_TIMEOUT", "Bridge hello was not received in time");
    }, this.options.helloTimeoutMs);
    helloTimer.unref();
    socket.on("error", () => undefined);
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.failSocket(socket, 1008, "BINARY_MESSAGE_NOT_ALLOWED", "Bridge messages must be JSON text");
        return;
      }
      const buffer = rawDataToBuffer(data);
      if (buffer.byteLength > this.options.maxMessageBytes) {
        this.failSocket(socket, 1009, "MESSAGE_TOO_LARGE", "Bridge message exceeds the configured size limit");
        return;
      }
      let message: unknown;
      try {
        message = JSON.parse(buffer.toString("utf8")) as unknown;
      } catch {
        this.failSocket(socket, 1008, "INVALID_JSON", "Bridge message is not valid JSON");
        return;
      }

      if (!connection) {
        try {
          const hello = parseHello(message, origin);
          connection = this.authenticate(socket, origin, hello);
          this.unauthenticatedSockets.delete(socket);
          clearTimeout(helloTimer);
        } catch (error) {
          const apiError = error instanceof ApiError ? error : new ApiError(500, "BRIDGE_INTERNAL_ERROR", "Bridge authentication failed");
          this.failSocket(socket, apiError.status >= 500 ? 1011 : 1008, apiError.code, apiError.message);
        }
        return;
      }
      this.handleAuthenticatedMessage(connection, socket, message);
    });
    socket.on("close", () => {
      clearTimeout(helloTimer);
      this.unauthenticatedSockets.delete(socket);
      if (connection) this.disconnect(connection, socket);
    });
  }

  private authenticate(socket: WebSocket, origin: string, hello: BridgeHello): ConnectionRecord {
    this.cleanupExpired();
    let connection: ConnectionRecord;
    if (hello.resumeToken !== undefined) {
      const resumeHash = tokenHash(hello.resumeToken);
      const connectionId = this.resumeTokens.get(resumeHash);
      const existing = connectionId ? this.connections.get(connectionId) : undefined;
      if (!existing || existing.resumableUntil <= Date.now()) {
        throw new ApiError(403, "RESUME_TOKEN_INVALID", "Resume token is invalid or expired");
      }
      if (existing.origin !== origin) {
        throw new ApiError(403, "ORIGIN_MISMATCH", "Resume token cannot be used from a different Origin");
      }
      connection = existing;
      this.resumeTokens.delete(existing.resumeTokenHash);
    } else {
      const pairingHash = tokenHash(hello.pairingCode as string);
      const pairing = this.pairingCodes.get(pairingHash);
      if (!pairing) throw new ApiError(403, "PAIRING_CODE_INVALID", "Pairing code is invalid or already used");
      if (pairing.expiresAt <= Date.now()) {
        this.pairingCodes.delete(pairingHash);
        throw new ApiError(403, "PAIRING_CODE_EXPIRED", "Pairing code has expired");
      }
      if (this.connections.size >= this.options.maxConnections) {
        throw new ApiError(429, "BRIDGE_CONNECTION_LIMIT", "Too many Bridge connections");
      }
      this.pairingCodes.delete(pairingHash); // One-time use only after a valid hello.
      const now = Date.now();
      connection = {
        connectionId: randomUUID(),
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        bridgeVersion: hello.bridgeVersion,
        st: structuredClone(hello.st),
        capabilities: [...hello.capabilities],
        ...(hello.context === undefined ? {} : { context: structuredClone(hello.context) }),
        origin,
        connectedAt: now,
        lastSeenAt: now,
        lastPongAt: now,
        resumableUntil: now + this.options.resumeTtlMs,
        resumeTokenHash: "",
        pendingRpc: new Map(),
      };
      this.connections.set(connection.connectionId, connection);
    }

    const oldSocket = connection.socket;
    connection.socket = socket;
    connection.bridgeVersion = hello.bridgeVersion;
    connection.st = structuredClone(hello.st);
    connection.capabilities = [...hello.capabilities];
    if (hello.context === undefined) delete connection.context;
    else connection.context = structuredClone(hello.context);
    connection.lastSeenAt = Date.now();
    connection.lastPongAt = Date.now();
    connection.resumableUntil = Date.now() + this.options.resumeTtlMs;
    const resumeToken = createSecret(32);
    connection.resumeTokenHash = tokenHash(resumeToken);
    this.resumeTokens.set(connection.resumeTokenHash, connection.connectionId);
    if (oldSocket && oldSocket !== socket && oldSocket.readyState === WebSocket.OPEN) {
      oldSocket.close(4001, "Bridge connection replaced by resume");
    }
    socket.send(JSON.stringify({
      type: "bridge.ack",
      connectionId: connection.connectionId,
      resumeToken,
      heartbeatIntervalMs: this.options.heartbeatIntervalMs,
    }));
    return connection;
  }

  private handleAuthenticatedMessage(connection: ConnectionRecord, socket: WebSocket, message: unknown): void {
    if (!isJsonObject(message) || typeof message.type !== "string") {
      this.failSocket(socket, 1008, "INVALID_MESSAGE", "Bridge message must contain a type");
      return;
    }
    connection.lastSeenAt = Date.now();
    if (message.type === "pong") {
      if (typeof message.timestamp !== "number") {
        this.failSocket(socket, 1008, "INVALID_PONG", "pong.timestamp must be a number");
        return;
      }
      connection.lastPongAt = Date.now();
      return;
    }
    if (message.type === "ping") {
      if (typeof message.timestamp !== "number") {
        this.failSocket(socket, 1008, "INVALID_PING", "ping.timestamp must be a number");
        return;
      }
      socket.send(JSON.stringify({ type: "pong", timestamp: message.timestamp }));
      return;
    }
    if (message.type === "rpc.response") {
      this.handleRpcResponse(connection, message);
      return;
    }
    if (message.type === "bridge.hello") {
      this.failSocket(socket, 1008, "DUPLICATE_HELLO", "bridge.hello may only be sent once per socket");
      return;
    }
    this.sendBridgeError(socket, "UNKNOWN_MESSAGE_TYPE", `Unsupported Bridge message type: ${message.type}`);
  }

  private handleRpcResponse(connection: ConnectionRecord, message: JsonObject): void {
    if (typeof message.id !== "string") return;
    const pending = connection.pendingRpc.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    connection.pendingRpc.delete(message.id);
    if (message.ok === true) {
      pending.resolve(message.result);
      return;
    }
    if (message.ok === false && isJsonObject(message.error)) {
      const remoteCode = typeof message.error.code === "string" ? message.error.code : "REMOTE_ERROR";
      const remoteMessage = typeof message.error.message === "string" ? message.error.message : "Bridge RPC failed";
      pending.reject(new ApiError(502, "RPC_REMOTE_ERROR", remoteMessage, {
        remoteCode,
        ...(message.error.details === undefined ? {} : { remoteDetails: message.error.details }),
      }));
      return;
    }
    pending.reject(new ApiError(502, "RPC_INVALID_RESPONSE", "Bridge returned an invalid RPC response"));
  }

  private heartbeat(): void {
    if (this.closed) return;
    const now = Date.now();
    this.cleanupExpired(now);
    for (const connection of this.connections.values()) {
      const socket = connection.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) continue;
      if (now - connection.lastPongAt > this.options.heartbeatTimeoutMs) {
        socket.close(4000, "Heartbeat timeout");
        continue;
      }
      socket.send(JSON.stringify({ type: "ping", timestamp: now }), (error) => {
        if (error) socket.terminate();
      });
    }
  }

  private disconnect(connection: ConnectionRecord, socket: WebSocket): void {
    if (connection.socket !== socket) return;
    delete connection.socket;
    connection.lastSeenAt = Date.now();
    connection.resumableUntil = Date.now() + this.options.resumeTtlMs;
    this.rejectPending(connection, new ApiError(503, "BRIDGE_DISCONNECTED", "Bridge disconnected during RPC"));
  }

  private rejectPending(connection: ConnectionRecord, error: ApiError): void {
    for (const pending of connection.pendingRpc.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    connection.pendingRpc.clear();
  }

  private cleanupExpired(now = Date.now()): void {
    for (const [hash, pairing] of this.pairingCodes) {
      // Keep a short-lived tombstone so a client receives PAIRING_CODE_EXPIRED
      // rather than the less useful invalid-code response immediately after TTL.
      if (pairing.expiresAt + this.options.pairingTtlMs <= now) this.pairingCodes.delete(hash);
    }
    for (const [id, connection] of this.connections) {
      if (!connection.socket && connection.resumableUntil <= now) {
        this.rejectPending(connection, new ApiError(503, "RESUME_TOKEN_EXPIRED", "Bridge resume session expired"));
        this.resumeTokens.delete(connection.resumeTokenHash);
        this.connections.delete(id);
      }
    }
  }

  private sendBridgeError(socket: WebSocket, code: string, message: string): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "bridge.error", code, message }));
  }

  private failSocket(socket: WebSocket, closeCode: number, code: string, message: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      this.sendBridgeError(socket, code, message);
      socket.close(closeCode, message.slice(0, 120));
    } else {
      socket.terminate();
    }
  }
}
