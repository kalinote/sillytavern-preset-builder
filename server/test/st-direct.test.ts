import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SillyTavern118Adapter } from "../src/st-1-18-adapter.js";
import { createApiServer } from "../src/http.js";
import { StHttpClient } from "../src/st-http-client.js";
import type { JsonObject } from "../src/types.js";

interface MockStOptions {
  basic?: { username: string; password: string };
  account?: { handle: string; password: string };
  version?: string;
}

interface MockRequestLog {
  path: string;
  authorization?: string;
  cookie?: string;
  csrf?: string;
}

function preset(content: string): JsonObject {
  return {
    temperature: 0.8,
    prompts: [{ identifier: "main", name: "Main", content, role: "system" }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    extensions: { unknown: { preserve: true } },
  };
}

async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json", "content-length": body.byteLength });
  response.end(body);
}

async function createMockSt(options: MockStOptions = {}) {
  const presets = new Map<string, JsonObject>([["Existing", preset("Remote original")]]);
  const logs: MockRequestLog[] = [];
  const expectedBasic = options.basic
    ? `Basic ${Buffer.from(`${options.basic.username}:${options.basic.password}`).toString("base64")}`
    : undefined;
  let csrfGeneration = 1;
  let rejectNextProtected = false;
  let saveDelayMs = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://mock-st");
    const log: MockRequestLog = {
      path: `${url.pathname}${url.search}`,
      ...(typeof request.headers.authorization === "string" ? { authorization: request.headers.authorization } : {}),
      ...(typeof request.headers.cookie === "string" ? { cookie: request.headers.cookie } : {}),
      ...(typeof request.headers["x-csrf-token"] === "string" ? { csrf: request.headers["x-csrf-token"] } : {}),
    };
    logs.push(log);

    if (expectedBasic && request.headers.authorization !== expectedBasic) {
      response.writeHead(401, { "www-authenticate": "Basic realm=\"SillyTavern\"" });
      response.end("basic required");
      return;
    }
    if (url.pathname === "/csrf-token" && request.method === "GET") {
      if (!request.headers.cookie) response.setHeader("set-cookie", "st_session=anonymous; Path=/; HttpOnly");
      sendJson(response, 200, { token: `csrf-${csrfGeneration}` });
      return;
    }
    if (request.method === "POST" && request.headers["x-csrf-token"] !== `csrf-${csrfGeneration}`) {
      response.writeHead(403);
      response.end("Invalid CSRF token");
      return;
    }
    if (url.pathname === "/api/users/login" && request.method === "POST") {
      const body = await requestJson(request);
      if (!options.account || body.handle !== options.account.handle || body.password !== options.account.password) {
        sendJson(response, 403, { error: "Incorrect credentials" });
        return;
      }
      response.setHeader("set-cookie", "st_session=account; Path=/; HttpOnly");
      sendJson(response, 200, { handle: options.account.handle });
      return;
    }
    const accountAuthenticated = request.headers.cookie?.includes("st_session=account") === true;
    if (options.account && !accountAuthenticated) {
      response.writeHead(302, { location: "/login" });
      response.end();
      return;
    }
    if (url.pathname === "/version" && request.method === "GET") {
      sendJson(response, 200, { pkgVersion: options.version ?? "1.18.0", gitBranch: "release" });
      return;
    }
    if (url.pathname === "/api/ping" && request.method === "POST") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/api/settings/get" && request.method === "POST") {
      if (rejectNextProtected) {
        rejectNextProtected = false;
        csrfGeneration += 1;
        response.writeHead(403);
        response.end("Invalid CSRF token");
        return;
      }
      const names = [...presets.keys()].sort();
      sendJson(response, 200, {
        settings: JSON.stringify({ oai_settings: { preset_settings_openai: "Existing" } }),
        openai_setting_names: names,
        openai_settings: names.map((name) => JSON.stringify(presets.get(name))),
      });
      return;
    }
    if (url.pathname === "/api/presets/save" && request.method === "POST") {
      const body = await requestJson(request);
      if (body.apiId !== "openai" || typeof body.name !== "string" || typeof body.preset !== "object" || !body.preset) {
        response.writeHead(400);
        response.end();
        return;
      }
      if (saveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, saveDelayMs));
      presets.set(body.name, structuredClone(body.preset as JsonObject));
      sendJson(response, 200, { name: body.name });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    presets,
    logs,
    rejectNextProtected: () => { rejectNextProtected = true; },
    setSaveDelay: (value: number) => { saveDelayMs = value; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  assert(header);
  return header.split(";", 1)[0] as string;
}

async function jsonFetch(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

async function editMainPrompt(baseUrl: string, projectId: string, content: string): Promise<void> {
  const files = await (await fetch(`${baseUrl}/api/projects/${projectId}/files`)).json() as {
    files: Array<{ path: string; type: string }>;
  };
  const entry = files.files.find((file) => file.type === "file" && file.path.endsWith("/content.md"));
  assert(entry);
  const path = entry.path.split("/").map(encodeURIComponent).join("/");
  const current = await (await fetch(`${baseUrl}/api/projects/${projectId}/files/${path}`)).json() as {
    revision: string;
  };
  const saved = await jsonFetch(baseUrl, `/api/projects/${projectId}/files/${path}`, {
    method: "PUT",
    body: { content, ifRevision: current.revision },
  });
  assert.equal(saved.status, 200);
}

test("direct ST session supports cookies, CSRF refresh, catalog/read/create, and guarded two-phase push", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-direct-st-"));
  const mock = await createMockSt({
    basic: { username: "basic-user", password: "basic-secret" },
    account: { handle: "alice", password: "account-secret" },
  });
  const { server, stSessions, store } = createApiServer({
    workspaceRoot: root,
    staticRoot: false,
    stSessionOptions: {
      targetPolicy: "allowlist",
      allowedOrigins: new Set(),
      connectTimeoutMs: 1_000,
      requestTimeoutMs: 3_000,
      responseLimitBytes: 4 * 1024 * 1024,
      sessionIdleMs: 60_000,
      maxSessions: 2,
      maxPreviews: 2,
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let mockClosed = false;

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const invalidOrigin = await jsonFetch(baseUrl, "/api/st/session", {
        body: { origin: `${mock.origin}/not-an-origin` },
      });
      assert.equal(invalidOrigin.status, 400);
      assert.equal((await invalidOrigin.json() as { error: { code: string } }).error.code, "ST_TARGET_INVALID");
    }

    const missingBasic = await jsonFetch(baseUrl, "/api/st/session", {
      body: { origin: mock.origin },
    });
    assert.equal(missingBasic.status, 401);
    assert.equal((await missingBasic.json() as { error: { code: string } }).error.code, "ST_BASIC_AUTH_REQUIRED");

    const basicWithoutAccount = await jsonFetch(baseUrl, "/api/st/session", {
      body: { origin: mock.origin, basicAuth: { username: "basic-user", password: "basic-secret" } },
    });
    assert.equal(basicWithoutAccount.status, 401);
    assert.equal((await basicWithoutAccount.json() as { error: { code: string } }).error.code, "ST_ACCOUNT_AUTH_REQUIRED");

    const connected = await jsonFetch(baseUrl, "/api/st/session", {
      body: {
        origin: mock.origin,
        basicAuth: { username: "basic-user", password: "basic-secret" },
        accountAuth: { handle: "alice", password: "account-secret" },
      },
    });
    assert.equal(connected.status, 201);
    const setCookie = connected.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/api/i);
    assert.doesNotMatch(setCookie, /Max-Age|Expires/i);
    const cookie = cookieFrom(connected);
    const connectedText = await connected.text();
    assert.doesNotMatch(connectedText, /basic-secret|account-secret/);
    const connectedBody = JSON.parse(connectedText) as { session: Record<string, unknown> };
    assert.equal(connectedBody.session.status, "connected");
    assert.equal(connectedBody.session.version, "1.18.0");
    assert.equal(connectedBody.session.compatibility, "supported");
    assert.equal(connectedBody.session.targetPolicy, "allowlist");
    assert.deepEqual(connectedBody.session.authModes, ["basic", "account"]);
    assert.deepEqual(connectedBody.session.capabilities, ["preset.list", "preset.read", "preset.save"]);
    assert.equal(connectedBody.session.userHandle, "alice");
    assert.equal(mock.logs.find((entry) => entry.path === "/csrf-token" && entry.authorization)?.authorization,
      `Basic ${Buffer.from("basic-user:basic-secret").toString("base64")}`);

    const badReplacement = await jsonFetch(baseUrl, "/api/st/session", {
      cookie,
      body: {
        origin: mock.origin,
        basicAuth: { username: "basic-user", password: "wrong-password" },
        accountAuth: { handle: "alice", password: "account-secret" },
      },
    });
    assert.equal(badReplacement.status, 401);
    const badText = await badReplacement.text();
    assert.match(badText, /ST_BASIC_AUTH_FAILED/);
    assert.doesNotMatch(badText, /wrong-password|account-secret/);
    assert.equal((await (await jsonFetch(baseUrl, "/api/st/session", { cookie })).json() as { session: unknown }).session !== null, true);

    mock.rejectNextProtected();
    const catalogResponse = await jsonFetch(baseUrl, "/api/st/presets", { cookie });
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json() as {
      presets: Array<{ name: string; revision: string; size: number }>;
      persistedSelectedPresetName?: string;
    };
    assert.equal(catalog.presets[0]?.name, "Existing");
    assert.equal(catalog.persistedSelectedPresetName, "Existing");
    assert(mock.logs.filter((entry) => entry.path === "/csrf-token").length >= 4, "403 should refresh CSRF once");

    const read = await jsonFetch(baseUrl, "/api/st/presets/read", { cookie, body: { name: "Existing" } });
    assert.equal(read.status, 200);
    assert.equal(((await read.json() as { preset: { prompts: Array<{ content: string }> } }).preset.prompts[0]?.content), "Remote original");

    const createdResponse = await jsonFetch(baseUrl, "/api/projects/create-from-st", {
      cookie,
      body: { presetName: "Existing", name: "Direct snapshot", version: "v1" },
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { project: { id: string }; source: { presetName: string } };
    assert.equal(created.source.presetName, "Existing");
    await editMainPrompt(baseUrl, created.project.id, "Edited in Studio");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const invalidPreview = await jsonFetch(baseUrl, `/api/projects/${created.project.id}/push-preview`, {
        cookie,
        body: { targetName: "Existing", mode: "invalid" },
      });
      assert.equal(invalidPreview.status, 400);
      assert.equal((await invalidPreview.json() as { error: { code: string } }).error.code, "INVALID_INPUT");
    }

    const previewResponse = await jsonFetch(baseUrl, `/api/projects/${created.project.id}/push-preview`, {
      cookie,
      body: { targetName: "Existing", mode: "overwrite" },
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json() as {
      previewToken: string;
      target: { name: string; exists: boolean; revision?: string; size?: number };
      build: { projectRevision: string; revision: string; size: number; diagnostics: unknown[] };
      change: string;
      canCommit: boolean;
    };
    assert.equal(preview.target.exists, true);
    assert.equal(preview.change, "changed");
    assert.equal(preview.canCommit, true);
    assert.equal(preview.previewToken.length, 43);

    const committed = await jsonFetch(baseUrl, `/api/projects/${created.project.id}/push-preset`, {
      cookie,
      body: { previewToken: preview.previewToken },
    });
    assert.equal(committed.status, 200);
    const commit = await committed.json() as {
      presetName: string;
      revision: string;
      outcome: string;
      requiresStReload: boolean;
      stUrl: string;
    };
    assert.equal(commit.outcome, "overwritten");
    assert.equal(commit.requiresStReload, true);
    assert.equal(commit.stUrl, mock.origin);
    assert.equal((mock.presets.get("Existing")?.prompts as Array<{ content: string }>)[0]?.content, "Edited in Studio");
    assert.equal((await store.getProject(created.project.id)).targetPresetName, "Existing");

    const replay = await jsonFetch(baseUrl, `/api/projects/${created.project.id}/push-preset`, {
      cookie,
      body: { previewToken: preview.previewToken },
    });
    assert.equal(replay.status, 404);
    assert.equal((await replay.json() as { error: { code: string } }).error.code, "ST_PREVIEW_INVALID");

    await editMainPrompt(baseUrl, created.project.id, "Changed after preview");
    const stalePreview = await (await jsonFetch(baseUrl, `/api/projects/${created.project.id}/push-preview`, {
      cookie,
      body: { targetName: "Existing", mode: "overwrite" },
    })).json() as { previewToken: string };
    await editMainPrompt(baseUrl, created.project.id, "Changed once more");
    const staleCommit = await jsonFetch(baseUrl, `/api/projects/${created.project.id}/push-preset`, {
      cookie,
      body: { previewToken: stalePreview.previewToken },
    });
    assert.equal(staleCommit.status, 409);
    assert.equal((await staleCommit.json() as { error: { code: string } }).error.code, "PROJECT_CHANGED");

    const secureSession = await jsonFetch(baseUrl, "/api/st/session", {
      body: {
        origin: mock.origin,
        basicAuth: { username: "basic-user", password: "basic-secret" },
        accountAuth: { handle: "alice", password: "account-secret" },
      },
      headers: { "x-forwarded-proto": "https" },
    });
    assert.equal(secureSession.status, 201);
    assert.match(secureSession.headers.get("set-cookie") ?? "", /; Secure/i);
    const secondCookie = cookieFrom(secureSession);

    const projectA = await (await jsonFetch(baseUrl, "/api/projects/create-from-st", {
      cookie,
      body: { presetName: "Existing", name: "Concurrent A" },
    })).json() as { project: { id: string } };
    const projectB = await (await jsonFetch(baseUrl, "/api/projects/create-from-st", {
      cookie: secondCookie,
      body: { presetName: "Existing", name: "Concurrent B" },
    })).json() as { project: { id: string } };
    await editMainPrompt(baseUrl, projectA.project.id, "Concurrent A");
    await editMainPrompt(baseUrl, projectB.project.id, "Concurrent B");
    const previewA = await (await jsonFetch(baseUrl, `/api/projects/${projectA.project.id}/push-preview`, {
      cookie,
      body: { targetName: "Existing", mode: "overwrite" },
    })).json() as { previewToken: string };
    const previewB = await (await jsonFetch(baseUrl, `/api/projects/${projectB.project.id}/push-preview`, {
      cookie: secondCookie,
      body: { targetName: "Existing", mode: "overwrite" },
    })).json() as { previewToken: string };
    mock.setSaveDelay(40);
    const [commitA, commitB] = await Promise.all([
      jsonFetch(baseUrl, `/api/projects/${projectA.project.id}/push-preset`, {
        cookie,
        body: { previewToken: previewA.previewToken },
      }),
      jsonFetch(baseUrl, `/api/projects/${projectB.project.id}/push-preset`, {
        cookie: secondCookie,
        body: { previewToken: previewB.previewToken },
      }),
    ]);
    assert.deepEqual([commitA.status, commitB.status].sort(), [200, 409]);
    const conflict = commitA.status === 409 ? commitA : commitB;
    assert.equal((await conflict.json() as { error: { code: string } }).error.code, "ST_PRESET_CHANGED");

    stSessions.destroySession(secondCookie.slice(secondCookie.indexOf("=") + 1));

    await mock.close();
    mockClosed = true;
    const checked = await jsonFetch(baseUrl, "/api/st/session/check", { cookie, body: {} });
    assert.equal(checked.status, 200);
    assert.equal((await checked.json() as { session: { status: string } }).session.status, "unreachable");

    const deleted = await jsonFetch(baseUrl, "/api/st/session", { cookie, method: "DELETE" });
    assert.equal(deleted.status, 204);
    assert.match(deleted.headers.get("set-cookie") ?? "", /Max-Age=0/i);
    const afterDelete = await (await jsonFetch(baseUrl, "/api/st/session", { cookie })).json() as { session: unknown };
    assert.equal(afterDelete.session, null);

    const oldPairing = await fetch(`${baseUrl}/api/st/pairing`, { method: "POST" });
    assert.equal(oldPairing.status, 404);
    const oldExtension = await fetch(`${baseUrl}/api/st/extension/archive`);
    assert.equal(oldExtension.status, 404);
  } finally {
    stSessions.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (!mockClosed) await mock.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ST 1.18 adapter supports no-auth, Basic-only, account-only, and combined authentication", async () => {
  const modes: MockStOptions[] = [
    {},
    { basic: { username: "basic", password: "pass" } },
    { account: { handle: "user", password: "pass" } },
    { basic: { username: "basic", password: "pass" }, account: { handle: "user", password: "pass" } },
  ];
  for (const mode of modes) {
    const mock = await createMockSt(mode);
    try {
      const client = new StHttpClient({
        origin: mock.origin,
        ...(mode.basic === undefined ? {} : { basicAuth: mode.basic }),
        targetPolicy: "allowlist",
        allowedOrigins: new Set(),
        connectTimeoutMs: 1_000,
        requestTimeoutMs: 2_000,
        responseLimitBytes: 1024 * 1024,
      });
      const adapter = new SillyTavern118Adapter(client);
      const initialized = await adapter.initialize(mode.account);
      assert.equal(initialized.version.version, "1.18.0");
      assert.equal(initialized.version.compatibility, "supported");
      assert.equal(initialized.userHandle, mode.account?.handle);
      assert.equal((await adapter.listPresets()).presets.length, 1);
      if (mode.basic) {
        assert.equal(mock.logs[0]?.path, "/csrf-token");
        assert.equal(mock.logs[0]?.authorization,
          `Basic ${Buffer.from(`${mode.basic.username}:${mode.basic.password}`).toString("base64")}`);
      }
      adapter.clearSensitiveState();
    } finally {
      await mock.close();
    }
  }
});

test("target policy rejects non-origin URLs and non-allowlisted private targets before connecting", async () => {
  assert.throws(
    () => new StHttpClient({
      origin: "http://127.0.0.1:8000/not-an-origin",
      targetPolicy: "allowlist",
      allowedOrigins: new Set(),
      connectTimeoutMs: 100,
      requestTimeoutMs: 100,
      responseLimitBytes: 1024,
    }),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ST_TARGET_INVALID",
  );
  const client = new StHttpClient({
    origin: "http://192.168.1.10:8000",
    targetPolicy: "allowlist",
    allowedOrigins: new Set(),
    connectTimeoutMs: 100,
    requestTimeoutMs: 100,
    responseLimitBytes: 1024,
  });
  await assert.rejects(
    client.request("/csrf-token"),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ST_TARGET_NOT_ALLOWED",
  );
});
