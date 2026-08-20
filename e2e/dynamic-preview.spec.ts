import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type CDPSession,
  type Frame,
  type Page,
  type TestInfo,
} from "@playwright/test";

const PORT = 3101;
const STUDIO_ORIGIN = `http://127.0.0.1:${PORT}`;
const PREVIEW_ORIGIN = `http://localhost:${PORT}`;
const E2E_WORKSPACE = join(process.cwd(), "test-results", "workspace");

interface ImportedProject {
  id: string;
  preview: { javascriptEnabled: boolean };
}

interface WebSocketProbe {
  readonly url: string;
  connectionCount(): number;
  closedCount(): number;
  waitForConnections(count: number): Promise<void>;
  waitForClosed(count: number): Promise<void>;
  dispose(): Promise<void>;
}

async function waitForValue(read: () => number, expected: number, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (read() < expected) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for value ${expected}; received ${read()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function createWebSocketProbe(): Promise<WebSocketProbe> {
  const sockets = new Set<Socket>();
  let connections = 0;
  let closed = 0;
  const server = createServer();
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"));
    connections += 1;
    sockets.add(socket);
    socket.on("data", (data) => {
      if (data.length > 0 && (data[0]! & 0x0f) === 0x08) {
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
      }
    });
    socket.once("close", () => {
      sockets.delete(socket);
      closed += 1;
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("WebSocket probe did not bind a TCP port");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    connectionCount: () => connections,
    closedCount: () => closed,
    waitForConnections: (count) => waitForValue(() => connections, count),
    waitForClosed: (count) => waitForValue(() => closed, count),
    async dispose() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function largeScriptSource(webSocketUrl?: string): string {
  const webSocketSetup = webSocketUrl
    ? `const e2eSocket = new WebSocket(${JSON.stringify(webSocketUrl)}); e2eSocket.addEventListener("open", () => console.log("E2E_WEBSOCKET_OPEN"));`
    : "";
  const studioApiUrl = `${STUDIO_ORIGIN}/api/health`;
  const executable = String.raw`
const variables = getVariables();
variables.order = [...(variables.order || []), "large"];
replaceVariables(variables);
setvar("scope-value", "global", { type: "global" });
setvar("scope-value", "chat", { type: "chat" });
setvar("scope-value", "message", { type: "message" });
console.log("E2E_VARIABLE_SCOPES", getvar("scope-value"), getvar("scope-value", { type: "chat" }), getvar("scope-value", { type: "message" }));
let messageUpdated = 0;
eventOn(tavern_events.MESSAGE_UPDATED, () => { messageUpdated += 1; });
await createChatMessages([{ role: "assistant", message: "created" }]);
const createdMessageId = getLastMessageId();
await setChatMessages([{ message_id: createdMessageId, message: "updated" }]);
console.log("E2E_MESSAGE_CRUD", getChatMessages(createdMessageId)[0].message, messageUpdated);
await deleteChatMessages([createdMessageId]);
console.log("E2E_MESSAGE_DELETE", getLastMessageId());
try { await generate(); }
catch (error) { console.log("E2E_CAPABILITY_STUB", error.name, error.capability); }
const dynamicModuleUrl = URL.createObjectURL(new Blob(["export default 42"], { type: "text/javascript" }));
try {
  const dynamicModule = await import(dynamicModuleUrl);
  console.log("E2E_DYNAMIC_IMPORT", dynamicModule.default);
} finally {
  URL.revokeObjectURL(dynamicModuleUrl);
}
let studioIsolation = "unverified";
try {
  void window.top.document.body;
  studioIsolation = "leaked";
} catch {
  studioIsolation = "blocked";
}
const previewApiStatus = (await fetch("/api/health")).status;
let studioApiAccess = "blocked";
try {
  const studioApiResponse = await fetch(${JSON.stringify(studioApiUrl)}, { credentials: "include" });
  studioApiAccess = "read-" + studioApiResponse.status;
} catch {}
const previousStorage = localStorage.getItem("preset-studio-e2e");
localStorage.setItem("preset-studio-e2e", "set");
console.log("E2E_SCRIPT_EXECUTION", studioIsolation, previewApiStatus);
console.log("E2E_SCRIPT_ORDER", getVariables().order.join(">"));
console.log("E2E_STORAGE_PREVIOUS", previousStorage || "empty");
console.log("E2E_STUDIO_COOKIE", document.cookie.includes("studio-only") ? "leaked" : "isolated");
console.log("E2E_LIBRARIES", $.fn.jquery, _.VERSION, typeof YAML.load, typeof showdown.Converter, typeof z.string);
console.log("E2E_PARENT_API", typeof window.parent.TavernHelper.getVariables);
console.log("E2E_STUDIO_API", studioApiAccess);
const complexLog = { bigint: 1n, node: document.body };
complexLog.self = complexLog;
console.log("E2E_COMPLEX_LOG", complexLog);
console.log("E2E_LARGE_LOG", "L".repeat(270000));
let timerTick = 0;
setInterval(() => {
  timerTick += 1;
  if (timerTick <= 2) console.log("E2E_TIMER_TICK", timerTick);
}, 40);
Promise.reject(new Error("E2E_UNHANDLED_REJECTION"));
${webSocketSetup}
`;
  return `${executable}\n/*${"x".repeat(768 * 1024)}*/`;
}

function presetFixture(webSocketUrl?: string) {
  const regexBindingFixture = {
    id: "e2e-message",
    scriptName: "E2E message",
    disabled: false,
    runOnEdit: true,
    findRegex: "/<e2e>([\\s\\S]*?)<\\/e2e>/g",
    replaceString: String.raw`<!doctype html><html><body><button id="e2e-button" onclick="document.body.dataset.clicked='yes'">$1</button><button id="e2e-popup" onclick="const opened=window.open('about:blank','_blank');document.body.dataset.popup=opened?'opened':'blocked'">Open popup</button><a id="e2e-download" download="preview.txt" href="data:text/plain,preview" onclick="document.body.dataset.download='requested'">Download preview</a><output id="e2e-template"><%= userName %></output><script src="/preview-assets/ejs-3.1.10.min.js" onload="console.log('E2E_EXTERNAL_SCRIPT', typeof ejs.render)"></script><script>document.body.dataset.inline='yes'; console.log('E2E_MESSAGE_PARENT', typeof window.parent.TavernHelper.getVariables); fetch('/preview-assets/ejs-3.1.10.min.js').then(response => console.log('E2E_EXTERNAL_FETCH', response.status));</script><script type="module">const moduleUrl=URL.createObjectURL(new Blob(['export default 84'],{type:'text/javascript'}));try{const value=await import(moduleUrl);document.body.dataset.module=String(value.default);console.log('E2E_MESSAGE_MODULE',value.default);}finally{URL.revokeObjectURL(moduleUrl);}</script></body></html>`,
    placement: [2],
    minDepth: null,
    maxDepth: null,
  };
  return {
    temperature: 1,
    prompts: [{ identifier: "main", name: "Main", role: "system", content: "E2E preview <%= userName %>" }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    extensions: {
      regex_scripts: [structuredClone(regexBindingFixture)],
      SPreset: { RegexBinding: { regexes: [structuredClone(regexBindingFixture)] } },
      unmapped_plugin: { secret: true },
      tavern_helper: {
        variables: { fixtureFlag: "loaded" },
        scripts: [
          {
            type: "script",
            id: "e2e-first-script",
            name: "E2E first script",
            enabled: true,
            content: "const variables = getVariables(); variables.order = [...(variables.order || []), 'first']; replaceVariables(variables); console.log('E2E_FIRST_SCRIPT');",
            data: {},
          },
          {
            type: "script",
            id: "e2e-regex-binding-script",
            name: "E2E RegexBinding context",
            enabled: true,
            content: String.raw`
const regexBindingContext = SillyTavern.getContext();
const extensionSettingsReference = regexBindingContext.extensionSettings;
const spresetSettingsReference = regexBindingContext.extensionSettings.SPreset;
const boundRegexes = regexBindingContext.chatCompletionSettings.extensions.SPreset.RegexBinding.regexes;
regexBindingContext.chatCompletionSettings.extensions.regex_scripts = boundRegexes;
const promptCountBeforePatch = regexBindingContext.chatCompletionSettings.prompts.length;
await setPreset("in_use", { settings: { allow_sending_images: "auto" } });
let presetChangedEvents = 0;
regexBindingContext.eventSource.on(tavern_events.OAI_PRESET_CHANGED_AFTER, () => { presetChangedEvents += 1; });
await regexBindingContext.eventSource.emit(tavern_events.OAI_PRESET_CHANGED_AFTER);
regexBindingContext.saveSettingsDebounced();
console.log(
  "E2E_REGEX_BINDING",
  regexBindingContext.chatCompletionSettings.prompts[0].identifier,
  regexBindingContext.chatCompletionSettings.preset_settings_openai,
  TavernHelper.getTavernRegexes().length,
  presetChangedEvents,
  Array.isArray(regexBindingContext.extensionSettings.regex),
  regexBindingContext.extensionSettings.SPreset.RegexBinding.regexes.length,
  regexBindingContext.extensionSettings.tavern_helper.variables.fixtureFlag,
  regexBindingContext.extensionSettings === extensionSettingsReference,
  regexBindingContext.extensionSettings.SPreset === spresetSettingsReference,
  regexBindingContext.extensionSettings.unmapped_plugin === undefined
    && regexBindingContext.chatCompletionSettings.extensions.unmapped_plugin.secret === true,
  regexBindingContext.chatCompletionSettings.prompts.length === promptCountBeforePatch,
  regexBindingContext.chatCompletionSettings.settings.allow_sending_images,
);
const e2eGenerationEvents = [];
eventOn(tavern_events.GENERATE_BEFORE_COMBINE_PROMPTS, () => {
  e2eGenerationEvents.push("before-combine");
});
eventOn(tavern_events.GENERATE_AFTER_COMBINE_PROMPTS, (eventData) => {
  e2eGenerationEvents.push("after-combine");
  eventData.prompt += "\nE2E_COMBINED_PROMPT";
});
eventOn(tavern_events.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
  e2eGenerationEvents.push("prompt-ready");
  eventData.chat.push({ role: "user", content: "E2E_PROMPT_READY" });
});
eventOn(tavern_events.GENERATE_AFTER_DATA, (generateData, dryRun) => {
  e2eGenerationEvents.push("after-data:" + dryRun);
  generateData.prompt.push({ role: "system", content: "E2E_AFTER_DATA" });
});
eventOn(tavern_events.CHAT_COMPLETION_SETTINGS_READY, (generateData) => {
  e2eGenerationEvents.push("settings-ready");
  generateData.stop.push("E2E_STOP");
  generateData.messages.push({ role: "assistant", content: "E2E_SETTINGS_READY" });
  console.log("E2E_GENERATION_EVENTS", e2eGenerationEvents.join(">"));
});
`,
            data: {},
          },
          {
            type: "script",
            id: "e2e-error-script",
            name: "E2E error script",
            enabled: true,
            content: "console.log('E2E_ERROR_BEFORE_THROW'); throw new Error('E2E_EXPECTED_ERROR');",
            data: {},
          },
          {
            type: "script",
            id: "e2e-disabled-script",
            name: "E2E disabled script",
            enabled: false,
            content: "console.error('E2E_DISABLED_MUST_NOT_RUN');",
            data: {},
          },
          {
            type: "script",
            id: "e2e-large-script",
            name: "E2E large script",
            enabled: true,
            content: largeScriptSource(webSocketUrl),
            data: {},
          },
        ],
      },
    },
  };
}

function memoryPresetFixture() {
  return {
    temperature: 1,
    prompts: [{ identifier: "main", name: "Main", role: "system", content: "Memory preview" }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    extensions: {
      tavern_helper: {
        variables: {},
        scripts: [{
          type: "script",
          id: "memory-script",
          name: "Memory script",
          enabled: true,
          content: String.raw`
globalThis.__memoryPayload = Array.from({ length: 12000 }, (_, index) => ({ index, text: "x".repeat(64) }));
for (let index = 0; index < 100; index += 1) {
  const node = document.createElement("span");
  node.textContent = String(index);
  document.body.append(node);
}
window.addEventListener("preset-studio-memory", () => undefined);
setInterval(() => undefined, 1000);
document.documentElement.dataset.memoryReady = "yes";
`,
          data: {},
        }],
      },
    },
  };
}

async function importFixture(
  request: APIRequestContext,
  javascriptEnabled = true,
  preset: ReturnType<typeof presetFixture> | ReturnType<typeof memoryPresetFixture> = presetFixture(),
): Promise<ImportedProject> {
  const response = await request.post(`${STUDIO_ORIGIN}/api/projects/import/json`, {
    data: {
      name: `Playwright dynamic preview ${Date.now()}`,
      version: "e2e",
      preview: { javascriptEnabled },
      preset,
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { project: ImportedProject };
  return body.project;
}

async function openPreview(page: Page): Promise<void> {
  await page.goto(STUDIO_ORIGIN);
  await expect(page.getByText("工程服务正常", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "预览" }).click();
}

async function setStudioOnlyCookie(context: BrowserContext): Promise<void> {
  await context.addCookies([{
    name: "studio-only",
    value: "must-not-reach-preview",
    url: STUDIO_ORIGIN,
    sameSite: "Strict",
  }]);
}

test("isolated Preview Host covers chunking, compatibility, message HTML, storage, and lifecycle", async ({ context, page, request }) => {
  test.setTimeout(180_000);
  const webSocketProbe = await createWebSocketProbe();
  try {
    const studioHealth = await request.get(`${STUDIO_ORIGIN}/api/health`);
    expect(studioHealth.status()).toBe(200);
    const health = await studioHealth.json() as { previewRuntime: { enabled: boolean; origin?: string } };
    expect(health.previewRuntime).toEqual({ enabled: true, origin: PREVIEW_ORIGIN });
    const previewApi = await request.get(`${PREVIEW_ORIGIN}/api/health`);
    expect(previewApi.status()).toBe(404);
    const previewVersion = await request.get(`${PREVIEW_ORIGIN}/version`);
    expect(previewVersion.status()).toBe(200);
    expect(await previewVersion.json()).toEqual({ pkgVersion: "1.18.0", previewRuntime: true });

    await importFixture(request, true, presetFixture(webSocketProbe.url));
    await setStudioOnlyCookie(context);
    const previewStudioApiCookies: string[] = [];
    page.on("request", (browserRequest) => {
      if (
        browserRequest.url() === `${STUDIO_ORIGIN}/api/health`
        && browserRequest.frame() !== page.mainFrame()
      ) {
        void browserRequest.allHeaders().then((headers) => {
          previewStudioApiCookies.push(headers.cookie ?? "");
        });
      }
    });
    await openPreview(page);
    for (const pluginId of ["core", "spreset", "regex", "tavern-helper", "extension:unmapped_plugin"]) {
      await expect(page.locator(`button[data-plugin-id="${pluginId}"]`)).toBeVisible();
    }
    await expect(page.locator('button[data-tree-path="spreset/config"]')).toBeVisible();
    await expect(page.locator('button[data-tree-path="regex/regex"]')).toBeVisible();
    await expect(page.locator('button[data-tree-path="tavern-helper/scripts"]')).toBeVisible();
    await expect(page.locator('button[aria-label^="新建 "]')).toHaveCount(0);
    const regexItemDirectory = page.locator('button[data-tree-path^="regex/regex/"]').first();
    await regexItemDirectory.click();
    const replacementFile = page.locator('button[data-source-path$="/replace.html"]').first();
    await replacementFile.click();
    await expect(page.locator("main").first().getByText("replace.html", { exact: true })).toBeVisible();
    await regexItemDirectory.click();
    await expect(page.getByTestId("regex-mirror-status")).toContainText("extensions.regex_scripts");
    await expect(page.getByTestId("regex-mirror-status")).toContainText("镜像一致");
    const runtimeFrame = page.locator('iframe[title="项目动态 JavaScript 预览"]');
    await expect(runtimeFrame).toHaveCount(0);
    await page.getByRole("button", { name: "启动", exact: true }).click();
    await expect(page.getByText("脚本运行中", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /日志/ }).click();

    const transferLog = page.getByText(/分 \d+ 块传输 \d+ 字节/);
  await expect(transferLog).toHaveCount(1);
  await expect(page.getByText(/E2E_SCRIPT_EXECUTION blocked 404/)).toHaveCount(1);
  await expect(page.getByText(/E2E_SCRIPT_ORDER first>large/)).toHaveCount(1);
  await expect(page.getByText(/E2E_EXPECTED_ERROR/)).toHaveCount(1);
  await expect(page.getByText(/Unhandled promise rejection/)).toHaveCount(1);
  await expect(page.getByText(/E2E_STUDIO_COOKIE isolated/)).toHaveCount(1);
  await expect(page.getByText(/E2E_LIBRARIES 3\.7\.1 4\.17\.21 function function function/)).toHaveCount(1);
  await expect(page.getByText(/E2E_PARENT_API function/)).toHaveCount(1);
  await expect(page.getByText(/E2E_STUDIO_API blocked/)).toHaveCount(1);
  await expect(page.getByText(/E2E_COMPLEX_LOG/)).toHaveCount(1);
  await expect(page.getByText(/E2E_LARGE_LOG.*\[truncated\]/)).toHaveCount(1);
  await expect.poll(() => previewStudioApiCookies.length).toBeGreaterThan(0);
  expect(previewStudioApiCookies.every((cookie) => cookie.length === 0)).toBe(true);
  await expect(page.getByText(/E2E_DYNAMIC_IMPORT 42/)).toHaveCount(1);
  await expect(page.getByText(/E2E_VARIABLE_SCOPES global chat message/)).toHaveCount(1);
  await expect(page.getByText(/E2E_REGEX_BINDING main Playwright dynamic preview \d+ 1 1 true 1 loaded true true true true auto/)).toHaveCount(1);
  await expect(page.getByText(/E2E_MESSAGE_CRUD updated 1/)).toHaveCount(1);
  await expect(page.getByText(/E2E_MESSAGE_DELETE 0/)).toHaveCount(1);
  await expect(page.getByText(/E2E_CAPABILITY_STUB PreviewCapabilityError generate/)).toHaveCount(1);
  await expect(page.getByText(/E2E_WEBSOCKET_OPEN/)).toHaveCount(1);
  await webSocketProbe.waitForConnections(1);
  await expect(page.getByText(/E2E_DISABLED_MUST_NOT_RUN/)).toHaveCount(0);
  await expect(runtimeFrame).toHaveAttribute("src", `${PREVIEW_ORIGIN}/preview-runtime`);
  await expect(runtimeFrame).toHaveAttribute("sandbox", /allow-popups/);
  await expect(runtimeFrame).toHaveAttribute("sandbox", /allow-downloads/);
  expect(new URL(await runtimeFrame.getAttribute("src") ?? "").origin).not.toBe(STUDIO_ORIGIN);

  for (const device of ["平板", "手机", "桌面"]) {
    await page.getByRole("button", { name: device, exact: true }).click();
    await expect(page.getByText(/E2E_SCRIPT_EXECUTION blocked 404/)).toHaveCount(1);
    await expect(runtimeFrame).toHaveCount(1);
  }

  const canvasPanel = page.getByTestId("preview-canvas-panel");
  const canvasStage = page.getByTestId("preview-stage");
  const previewCanvas = page.getByTestId("preview-canvas");
  const inlineStageWidth = await canvasStage.evaluate((element) => element.clientWidth);
  await page.getByRole("button", { name: "展开大画布", exact: true }).click();
  await expect(canvasPanel).toHaveAttribute("data-expanded", "true");
  await expect(page.getByRole("button", { name: "退出大画布", exact: true })).toBeVisible();
  await expect.poll(() => canvasStage.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(inlineStageWidth * 2);

  await page.getByRole("button", { name: "拖动画布", exact: true }).click();
  const stageBounds = await canvasStage.boundingBox();
  if (!stageBounds) throw new Error("Preview canvas stage is not visible");
  const stageCenter = {
    x: stageBounds.x + stageBounds.width / 2,
    y: stageBounds.y + stageBounds.height / 2,
  };
  const canvasWidthBeforeWheel = await previewCanvas.evaluate((element) => element.getBoundingClientRect().width);
  await page.mouse.move(stageCenter.x, stageCenter.y);
  await page.mouse.wheel(0, -900);
  await expect.poll(() => previewCanvas.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(canvasWidthBeforeWheel);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const hasScrollableCanvas = await canvasStage.evaluate((element) =>
      element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight,
    );
    if (hasScrollableCanvas) break;
    await page.getByRole("button", { name: "放大画布", exact: true }).click();
  }
  await expect.poll(() => canvasStage.evaluate((element) =>
    element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight,
  )).toBe(true);

  const scrollBeforeDrag = await canvasStage.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  await page.mouse.move(stageCenter.x, stageCenter.y);
  await page.mouse.down();
  await page.mouse.move(stageCenter.x - 120, stageCenter.y - 90, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => canvasStage.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(scrollBeforeDrag.left);
  await expect.poll(() => canvasStage.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(scrollBeforeDrag.top);

  await page.getByRole("button", { name: "拖动画布", exact: true }).click();
  await page.getByRole("button", { name: "适合容器", exact: true }).click();
  await page.getByRole("button", { name: "退出大画布", exact: true }).click();
  await expect(canvasPanel).toHaveAttribute("data-expanded", "false");

  // Nested frame pointer coordinates are unreliable while the outer canvas is
  // CSS-scaled. Use the mobile viewport at 100% so these are genuine trusted
  // mouse activations, not dispatchEvent/evaluate substitutes.
  await page.getByRole("button", { name: "手机", exact: true }).click();
  for (let attempt = 0; attempt < 12 && await page.getByText("100%", { exact: true }).count() === 0; attempt += 1) {
    await page.getByRole("button", { name: "放大画布", exact: true }).click();
  }
  await expect(page.getByText("100%", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "E2E message 3", exact: true }).click();
  await page.getByRole("button", { name: "replace.html", exact: true }).click();
  await page.getByRole("button", { name: "上下文", exact: true }).click();
  await page.getByLabel("正则样本文本 / 当前消息").fill("<e2e>Hello iframe</e2e>");
  const messageFrame = page
    .frameLocator('iframe[title="项目动态 JavaScript 预览"]')
    .frameLocator("#runtime-frame");
  await expect(messageFrame.getByRole("button", { name: "Hello iframe" })).toBeVisible({ timeout: 15_000 });
  await expect(messageFrame.locator("#e2e-template")).toHaveText("User");
  await expect(messageFrame.locator("body")).toHaveAttribute("data-inline", "yes");
  await expect(messageFrame.locator("body")).toHaveAttribute("data-module", "84");
  await messageFrame.getByRole("button", { name: "Hello iframe" }).click();
  await expect(messageFrame.locator("body")).toHaveAttribute("data-clicked", "yes");
  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 5_000 }),
    messageFrame.getByRole("button", { name: "Open popup" }).click(),
  ]);
  await expect(messageFrame.locator("body")).toHaveAttribute("data-popup", "opened");
  await expect(popup).toHaveURL("about:blank");
  await popup.close();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5_000 }),
    messageFrame.getByRole("link", { name: "Download preview" }).click(),
  ]);
  await expect(messageFrame.locator("body")).toHaveAttribute("data-download", "requested");
  expect(download.suggestedFilename()).toBe("preview.txt");
  await download.delete();
  await expect(page.getByText(/E2E_MESSAGE_PARENT function/)).toHaveCount(1);
  await expect(page.getByText(/E2E_EXTERNAL_FETCH 200/)).toHaveCount(1);
  await expect(page.getByText(/E2E_EXTERNAL_SCRIPT function/)).toHaveCount(1);
  await expect(page.getByText(/E2E_MESSAGE_MODULE 84/)).toHaveCount(1);
  await expect(page.getByText(/E2E_SCRIPT_EXECUTION blocked 404/)).toHaveCount(1);

  await page.getByRole("button", { name: "模拟生成管线", exact: true }).click();
  const generationResult = page.getByTestId("preview-generation-result");
  await expect(generationResult.getByText("生成管线完成", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(generationResult).toContainText("E2E preview User");
  await expect(generationResult).toContainText("E2E_PROMPT_READY");
  await expect(generationResult).toContainText("E2E_AFTER_DATA");
  await expect(generationResult).toContainText("E2E_SETTINGS_READY");
  await expect(generationResult).toContainText("E2E_STOP");
  await expect(generationResult).toContainText("GENERATION_STARTED → GENERATE_BEFORE_COMBINE_PROMPTS → GENERATE_AFTER_COMBINE_PROMPTS → CHAT_COMPLETION_PROMPT_READY → PROMPT_TEMPLATE_EJS1 → GENERATE_AFTER_DATA → CHAT_COMPLETION_SETTINGS_READY");
  await expect(page.getByText(/E2E_GENERATION_EVENTS before-combine>after-combine>prompt-ready>after-data:true>settings-ready/)).toHaveCount(1);

  await page.getByRole("button", { name: "E2E first script 2", exact: true }).click();
  await page.getByRole("button", { name: "content.js", exact: true }).click();
  const scriptEditor = page.getByRole("textbox", { name: "content.js 源码编辑器" });
  await scriptEditor.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("// E2E dirty change");
  await expect(page.getByText("脚本已修改 · 需要重启", { exact: true })).toBeVisible();
  await expect(page.getByText(/E2E_SCRIPT_EXECUTION blocked 404/)).toHaveCount(1);
  await expect(page.getByText("工程已保存", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "重启", exact: true }).click();
  await expect(page.getByText(/E2E_SCRIPT_EXECUTION blocked 404/)).toHaveCount(2, { timeout: 30_000 });
  await expect(transferLog).toHaveCount(2);
  await expect(page.getByText(/E2E_STORAGE_PREVIOUS set/)).toHaveCount(1);
  await webSocketProbe.waitForConnections(2);
  await webSocketProbe.waitForClosed(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清空存储", exact: true }).click();
  await expect(page.getByText(/E2E_SCRIPT_EXECUTION blocked 404/)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByText(/E2E_STORAGE_PREVIOUS empty/)).toHaveCount(2);
  await webSocketProbe.waitForConnections(3);
  await webSocketProbe.waitForClosed(2);

  const stopDuration = await page.getByRole("button", { name: "停止", exact: true }).evaluate(async (button) => {
    const runtime = document.querySelector('iframe[title="项目动态 JavaScript 预览"]');
    const startedAt = performance.now();
    (button as HTMLButtonElement).click();
    while (runtime?.isConnected && performance.now() - startedAt < 2_000) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return performance.now() - startedAt;
  });
  await expect(page.getByRole("button", { name: "启动", exact: true })).toBeVisible();
  await expect(runtimeFrame).toHaveCount(0);
  expect(stopDuration).toBeLessThan(1_000);
  await webSocketProbe.waitForClosed(3);
  await page.waitForTimeout(250);
  const settledTicksAfterStop = await page.getByText(/E2E_TIMER_TICK/).count();
  await page.waitForTimeout(250);
  expect(await page.getByText(/E2E_TIMER_TICK/).count()).toBe(settledTicksAfterStop);
  } finally {
    await webSocketProbe.dispose();
  }
});

test("project-level JavaScript switch keeps user code dormant", async ({ page, request }) => {
  await importFixture(request, false);
  await openPreview(page);
  await expect(page.getByRole("switch", { name: "允许动态 JavaScript 预览" })).not.toBeChecked();
  await expect(page.locator('iframe[title="项目动态 JavaScript 预览"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "启动", exact: true })).toBeDisabled();
  await expect(page.getByText(/E2E_SCRIPT_EXECUTION/)).toHaveCount(0);
});

test("legacy projects without preview settings stay in static mode", async ({ page, request }) => {
  const project = await importFixture(request);
  const manifestPath = join(E2E_WORKSPACE, project.id, "project.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  delete manifest.preview;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await openPreview(page);
  await expect(page.getByRole("switch", { name: "允许动态 JavaScript 预览" })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "启动", exact: true })).toBeDisabled();
  await expect(page.locator('iframe[title="项目动态 JavaScript 预览"]')).toHaveCount(0);
});

test("a failed handshake and a running Preview Host reload can both be retried safely", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Fault recovery is covered once in Chromium");
  test.setTimeout(45_000);
  await importFixture(request, true, memoryPresetFixture());
  await page.route(`${PREVIEW_ORIGIN}/preview-runtime`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>broken preview host</title>",
  }));
  await openPreview(page);
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("运行失败", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('iframe[title="项目动态 JavaScript 预览"]')).toHaveCount(0);

  await page.unroute(`${PREVIEW_ORIGIN}/preview-runtime`);
  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("脚本运行中", { exact: true })).toBeVisible({ timeout: 20_000 });
  const runtimeFrame = page.locator('iframe[title="项目动态 JavaScript 预览"]');
  await expect(runtimeFrame).toHaveCount(1);

  const runtimeHandle = await runtimeFrame.elementHandle();
  const runtimeContentFrame = await runtimeHandle?.contentFrame();
  if (!runtimeContentFrame) throw new Error("Preview Host frame is unavailable for crash simulation");
  await runtimeContentFrame.evaluate(() => location.reload()).catch(() => undefined);
  await expect(page.getByText("运行失败", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(runtimeFrame).toHaveCount(0);
  await runtimeHandle?.dispose();

  await page.getByRole("button", { name: "启动", exact: true }).click();
  await expect(page.getByText("脚本运行中", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(runtimeFrame).toHaveCount(1);
});

interface MemorySample {
  cycle: number;
  samplingMode: "separate-preview-target" | "combined-page-target";
  studioUsedBytes: number;
  previewUsedBytes: number;
  studioDocuments: number;
  studioNodes: number;
  previewDocuments: number;
  previewNodes: number;
  pageFrames: number;
}

async function collectHeapAndDom(session: CDPSession) {
  await session.send("HeapProfiler.collectGarbage");
  const heap = await session.send("Runtime.getHeapUsage") as { usedSize: number };
  const dom = await session.send("Memory.getDOMCounters") as { documents: number; nodes: number };
  return { usedBytes: heap.usedSize, documents: dom.documents, nodes: dom.nodes };
}

async function createPreviewMemorySession(
  context: BrowserContext,
  frame: Frame,
): Promise<CDPSession | undefined> {
  try {
    return await context.newCDPSession(frame);
  } catch (error) {
    if (error instanceof Error && error.message.includes("part of the parent frame's session")) {
      return undefined;
    }
    throw error;
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

async function attachMemoryReport(testInfo: TestInfo, samples: readonly MemorySample[]): Promise<void> {
  const report = JSON.stringify({ samples }, null, 2);
  await testInfo.attach("preview-memory-samples.json", {
    body: Buffer.from(report),
    contentType: "application/json",
  });
  await writeFile(join(process.cwd(), "test-results", "preview-memory-latest.json"), `${report}\n`, "utf8");
}

test("20 restarts keep preview frames, DOM, and heap within a bounded envelope", async ({ context, page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Chromium CDP provides the required heap and DOM counters");
  test.setTimeout(180_000);
  await importFixture(request, true, memoryPresetFixture());
  await openPreview(page);
  await page.locator('button[data-source-path="project.json"]').click();
  const runtimeFrame = page.locator('iframe[title="项目动态 JavaScript 预览"]');
  const studioSession = await context.newCDPSession(page);
  const samples: MemorySample[] = [];
  try {
    await page.getByRole("button", { name: "启动", exact: true }).click();
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      await expect(page.getByText("脚本运行中", { exact: true })).toBeVisible({ timeout: 20_000 });
      const projectScriptFrame = page
        .frameLocator('iframe[title="项目动态 JavaScript 预览"]')
        .frameLocator('iframe[data-preview-frame-kind="project-script"]');
      await expect(projectScriptFrame.locator("html")).toHaveAttribute("data-memory-ready", "yes", { timeout: 20_000 });
      await expect(runtimeFrame).toHaveCount(1);

      const outerHandle = await runtimeFrame.elementHandle();
      const outerFrame = await outerHandle?.contentFrame();
      if (!outerHandle || !outerFrame) throw new Error("Preview Host frame is unavailable for memory sampling");
      const previewSession = await createPreviewMemorySession(context, outerFrame);
      const studio = await collectHeapAndDom(studioSession);
      const preview = previewSession === undefined
        ? { usedBytes: 0, documents: 0, nodes: 0 }
        : await collectHeapAndDom(previewSession);
      await previewSession?.detach();
      samples.push({
        cycle,
        samplingMode: previewSession === undefined ? "combined-page-target" : "separate-preview-target",
        studioUsedBytes: studio.usedBytes,
        previewUsedBytes: preview.usedBytes,
        studioDocuments: studio.documents,
        studioNodes: studio.nodes,
        previewDocuments: preview.documents,
        previewNodes: preview.nodes,
        pageFrames: page.frames().length,
      });

      if (cycle < 20) {
        await page.getByRole("button", { name: "重启", exact: true }).click();
        await expect.poll(
          () => outerHandle.evaluate((element) => element.isConnected).catch(() => false),
          { timeout: 20_000 },
        ).toBe(false);
      }
      await outerHandle.dispose();
    }

    await attachMemoryReport(testInfo, samples);
    expect(new Set(samples.map((sample) => sample.pageFrames))).toEqual(new Set([3]));
    const firstFive = samples.slice(0, 5);
    const lastFive = samples.slice(-5);
    const firstHeapMedian = median(firstFive.map((sample) => sample.studioUsedBytes + sample.previewUsedBytes));
    const lastHeapMedian = median(lastFive.map((sample) => sample.studioUsedBytes + sample.previewUsedBytes));
    expect(lastHeapMedian).toBeLessThan(firstHeapMedian * 1.2 + 4 * 1024 * 1024);
    expect(Math.max(...lastFive.map((sample) => sample.studioNodes))).toBeLessThanOrEqual(
      Math.max(...firstFive.map((sample) => sample.studioNodes)) + 10,
    );
    const previewNodeCounts = samples
      .filter((sample) => sample.samplingMode === "separate-preview-target")
      .map((sample) => sample.previewNodes);
    if (previewNodeCounts.length > 0) {
      expect(Math.max(...previewNodeCounts) - Math.min(...previewNodeCounts)).toBeLessThanOrEqual(10);
    }

    await page.getByRole("button", { name: "停止", exact: true }).click();
    await expect(runtimeFrame).toHaveCount(0);
    await expect.poll(() => page.frames().length).toBe(1);
  } finally {
    await studioSession.detach();
  }
});
