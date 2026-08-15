import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket, { type RawData } from "ws";
import type { BridgeManager, BridgeManagerOptions } from "../src/bridge.js";
import { createApiServer } from "../src/http.js";

type JsonMessage = Record<string, unknown>;

interface BridgeFixture {
  baseUrl: string;
  bridgeUrl: string;
  bridge: BridgeManager;
  close: () => Promise<void>;
}

function rawText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: JsonMessage) => boolean,
  timeoutMs = 2_000,
): Promise<JsonMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    const onMessage = (data: RawData, isBinary: boolean) => {
      if (isBinary) return;
      let message: unknown;
      try {
        message = JSON.parse(rawText(data)) as unknown;
      } catch {
        return;
      }
      if (typeof message !== "object" || message === null || Array.isArray(message) || !predicate(message as JsonMessage)) {
        return;
      }
      cleanup();
      resolve(message as JsonMessage);
    };
    const onClose = (code: number) => {
      cleanup();
      reject(new Error(`WebSocket closed (${code}) before the expected message`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

async function openWebSocket(url: string, origin = "http://st.example"): Promise<WebSocket> {
  const socket = new WebSocket(url, { origin });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  else socket.close();
  await closed;
}

async function startFixture(bridgeOptions: Partial<BridgeManagerOptions> = {}): Promise<BridgeFixture> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "preset-studio-bridge-"));
  const { server, bridge } = createApiServer({
    workspaceRoot,
    staticRoot: false,
    bridgeOptions: {
      pairingTtlMs: 2_000,
      resumeTtlMs: 2_000,
      helloTimeoutMs: 500,
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 1_000,
      rpcTimeoutMs: 1_000,
      ...bridgeOptions,
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    bridgeUrl: `ws://127.0.0.1:${address.port}/bridge`,
    bridge,
    close: async () => {
      bridge.close();
      await closeServer(server);
      await rm(workspaceRoot, { recursive: true, force: true });
    },
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createPairing(baseUrl: string): Promise<{ pairingCode: string; expiresAt: string; bridgePath: string }> {
  const response = await fetch(`${baseUrl}/api/st/pairing`, { method: "POST" });
  assert.equal(response.status, 201);
  return response.json() as Promise<{ pairingCode: string; expiresAt: string; bridgePath: string }>;
}

function sendHello(socket: WebSocket, credential: { pairingCode: string } | { resumeToken: string }): void {
  socket.send(JSON.stringify({
    type: "bridge.hello",
    protocolVersion: 1,
    ...credential,
    bridgeVersion: "1.0.0-test",
    st: { version: "1.14.0", branch: "release", url: "http://st.example/" },
    capabilities: ["preset.pull"],
    context: {
      currentPresetName: "Bridge fixture",
      characterName: "Alice",
      chatId: "chat-1",
    },
  }));
}

function minimalPreset(): JsonMessage {
  return {
    temperature: 0.75,
    prompts: [{ identifier: "main", name: "Main", content: "Pulled from ST", role: "system" }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    extensions: { future_extension: { preserved: true } },
  };
}

test("Bridge HTTP defaults use documented seconds and MiB units", () => {
  const environmentNames = [
    "PRESET_STUDIO_PAIRING_TTL_SECONDS",
    "PRESET_STUDIO_BRIDGE_RESUME_TTL_SECONDS",
    "PRESET_STUDIO_BRIDGE_HELLO_TIMEOUT_SECONDS",
    "PRESET_STUDIO_BRIDGE_HEARTBEAT_SECONDS",
    "PRESET_STUDIO_BRIDGE_HEARTBEAT_TIMEOUT_SECONDS",
    "PRESET_STUDIO_BRIDGE_RPC_TIMEOUT_SECONDS",
    "PRESET_STUDIO_BRIDGE_MAX_MESSAGE_MIB",
  ] as const;
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  for (const name of environmentNames) delete process.env[name];
  const { bridge } = createApiServer({ staticRoot: false });
  try {
    assert.equal(bridge.options.pairingTtlMs, 300_000);
    assert.equal(bridge.options.resumeTtlMs, 1_800_000);
    assert.equal(bridge.options.helloTimeoutMs, 10_000);
    assert.equal(bridge.options.heartbeatIntervalMs, 15_000);
    assert.equal(bridge.options.heartbeatTimeoutMs, 45_000);
    assert.equal(bridge.options.rpcTimeoutMs, 30_000);
    assert.equal(bridge.options.maxMessageBytes, 32 * 1024 * 1024);
  } finally {
    bridge.close();
    for (const name of environmentNames) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Bridge pairs once, reports context, pulls the ST preset, and builds a semantic roundtrip", async () => {
  const fixture = await startFixture();
  let socket: WebSocket | undefined;
  try {
    const pairing = await createPairing(fixture.baseUrl);
    assert.match(pairing.pairingCode, /^[A-Za-z0-9_-]{16}$/);
    assert.equal(pairing.bridgePath, "/bridge");
    assert(Date.parse(pairing.expiresAt) > Date.now());

    socket = await openWebSocket(fixture.bridgeUrl);
    const ackPromise = waitForMessage(socket, (message) => message.type === "bridge.ack");
    sendHello(socket, { pairingCode: pairing.pairingCode });
    const ack = await ackPromise;
    assert.equal(typeof ack.connectionId, "string");
    assert.equal(typeof ack.resumeToken, "string");
    assert.equal(ack.heartbeatIntervalMs, 100);

    const connectionsResponse = await fetch(`${fixture.baseUrl}/api/st/connections`);
    assert.equal(connectionsResponse.status, 200);
    const connectionsBody = await connectionsResponse.json() as {
      connections: Array<{
        connectionId: string;
        status: string;
        st: { version: string };
        context?: { currentPresetName?: string; characterName?: string };
      }>;
    };
    assert.equal(connectionsBody.connections.length, 1);
    assert.equal(connectionsBody.connections[0]?.connectionId, ack.connectionId);
    assert.equal(connectionsBody.connections[0]?.status, "connected");
    assert.equal(connectionsBody.connections[0]?.st.version, "1.14.0");
    assert.equal(connectionsBody.connections[0]?.context?.currentPresetName, "Bridge fixture");
    assert.equal(connectionsBody.connections[0]?.context?.characterName, "Alice");

    const pongPromise = waitForMessage(socket, (message) => message.type === "pong" && message.timestamp === 123);
    socket.send(JSON.stringify({ type: "ping", timestamp: 123 }));
    await pongPromise;

    const rpcPromise = waitForMessage(socket, (message) => message.type === "rpc.request");
    const createPromise = fetch(`${fixture.baseUrl}/api/projects/create-from-st`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: ack.connectionId, name: "Pulled project", version: "v1" }),
    });
    const rpc = await rpcPromise;
    assert.equal(rpc.method, "preset.pull");
    assert.deepEqual(rpc.params, {});
    assert.equal(typeof rpc.id, "string");
    const preset = minimalPreset();
    socket.send(JSON.stringify({
      type: "rpc.response",
      id: rpc.id,
      ok: true,
      result: { name: "Bridge fixture", preset },
    }));

    const createResponse = await createPromise;
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as {
      project: { id: string; name: string; version: string; source: { type: string; presetName?: string; stVersion?: string } };
      source: { connectionId: string; presetName: string };
    };
    assert.equal(created.project.name, "Pulled project");
    assert.equal(created.project.version, "v1");
    assert.equal(created.project.source.type, "sillytavern");
    assert.equal(created.project.source.presetName, "Bridge fixture");
    assert.equal(created.project.source.stVersion, "1.14.0");
    assert.deepEqual(created.source, { connectionId: ack.connectionId, presetName: "Bridge fixture" });

    const buildResponse = await fetch(`${fixture.baseUrl}/api/projects/${created.project.id}/build`, { method: "POST" });
    assert.equal(buildResponse.status, 200);
    const build = await buildResponse.json() as { preset: JsonMessage };
    assert.deepEqual(build.preset, preset);

    const reused = await openWebSocket(fixture.bridgeUrl);
    try {
      const errorPromise = waitForMessage(reused, (message) => message.type === "bridge.error");
      sendHello(reused, { pairingCode: pairing.pairingCode });
      const error = await errorPromise;
      assert.equal(error.code, "PAIRING_CODE_INVALID");
    } finally {
      await closeSocket(reused);
    }
  } finally {
    if (socket) await closeSocket(socket);
    await fixture.close();
  }
});

test("Bridge rotates the in-memory resume token and preserves the connection id", async () => {
  const fixture = await startFixture();
  let initial: WebSocket | undefined;
  let resumed: WebSocket | undefined;
  try {
    const pairing = await createPairing(fixture.baseUrl);
    initial = await openWebSocket(fixture.bridgeUrl);
    const initialAckPromise = waitForMessage(initial, (message) => message.type === "bridge.ack");
    sendHello(initial, { pairingCode: pairing.pairingCode });
    const initialAck = await initialAckPromise;
    assert.equal(typeof initialAck.resumeToken, "string");
    await closeSocket(initial);
    initial = undefined;

    const disconnected = await (await fetch(`${fixture.baseUrl}/api/st/connections`)).json() as {
      connections: Array<{ status: string }>;
    };
    assert.equal(disconnected.connections[0]?.status, "disconnected");

    resumed = await openWebSocket(fixture.bridgeUrl);
    const resumedAckPromise = waitForMessage(resumed, (message) => message.type === "bridge.ack");
    sendHello(resumed, { resumeToken: initialAck.resumeToken as string });
    const resumedAck = await resumedAckPromise;
    assert.equal(resumedAck.connectionId, initialAck.connectionId);
    assert.notEqual(resumedAck.resumeToken, initialAck.resumeToken);

    const oldTokenSocket = await openWebSocket(fixture.bridgeUrl);
    try {
      const errorPromise = waitForMessage(oldTokenSocket, (message) => message.type === "bridge.error");
      sendHello(oldTokenSocket, { resumeToken: initialAck.resumeToken as string });
      assert.equal((await errorPromise).code, "RESUME_TOKEN_INVALID");
    } finally {
      await closeSocket(oldTokenSocket);
    }
  } finally {
    if (initial) await closeSocket(initial);
    if (resumed) await closeSocket(resumed);
    await fixture.close();
  }
});

test("Bridge rejects unauthenticated upgrades and returns a protocol error before policy close", async () => {
  const fixture = await startFixture();
  try {
    const missingOrigin = new WebSocket(fixture.bridgeUrl);
    const upgradeStatus = await new Promise<number>((resolve, reject) => {
      missingOrigin.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      missingOrigin.once("open", () => reject(new Error("WebSocket without Origin unexpectedly opened")));
      missingOrigin.once("error", () => undefined);
    });
    assert.equal(upgradeStatus, 403);

    const pairing = await createPairing(fixture.baseUrl);
    const socket = await openWebSocket(fixture.bridgeUrl);
    try {
      const errorPromise = waitForMessage(socket, (message) => message.type === "bridge.error");
      socket.send(JSON.stringify({
        type: "bridge.hello",
        protocolVersion: 2,
        pairingCode: pairing.pairingCode,
        bridgeVersion: "bad-client",
        st: { version: "1.14.0", url: "http://st.example/" },
        capabilities: ["preset.pull"],
      }));
      const error = await errorPromise;
      assert.equal(error.code, "PROTOCOL_VERSION_UNSUPPORTED");
      const closeCode = await new Promise<number>((resolve) => socket.once("close", resolve));
      assert.equal(closeCode, 1008);
    } finally {
      await closeSocket(socket);
    }
  } finally {
    await fixture.close();
  }
});

test("Bridge rejects an in-flight preset pull immediately when the ST socket disconnects", async () => {
  const fixture = await startFixture({ rpcTimeoutMs: 5_000 });
  let socket: WebSocket | undefined;
  try {
    const pairing = await createPairing(fixture.baseUrl);
    socket = await openWebSocket(fixture.bridgeUrl);
    const ackPromise = waitForMessage(socket, (message) => message.type === "bridge.ack");
    sendHello(socket, { pairingCode: pairing.pairingCode });
    const ack = await ackPromise;

    const rpcPromise = waitForMessage(socket, (message) => message.type === "rpc.request");
    const requestStartedAt = Date.now();
    const createPromise = fetch(`${fixture.baseUrl}/api/projects/create-from-st`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: ack.connectionId }),
    });
    await rpcPromise;
    await closeSocket(socket);
    socket = undefined;

    const response = await createPromise;
    assert.equal(response.status, 503);
    assert(Date.now() - requestStartedAt < 2_000, "disconnect should reject before the RPC timeout");
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "BRIDGE_DISCONNECTED");
  } finally {
    if (socket) await closeSocket(socket);
    await fixture.close();
  }
});
