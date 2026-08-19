import { PREVIEW_TEMPLATE_BOOTSTRAP } from "./preview-template-runtime.js";
import { createPreviewScriptTransferManager } from "./preview-script-transfer.js";

const CHILD_BOOTSTRAP = String.raw`
(() => {
  "use strict";
  const compat = window.parent.__presetStudioCompat;
  const frame = compat.registerFrame(window.frameElement);
  const serialize = (value, depth = 0, seen = new WeakSet()) => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return String(value) + "n";
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (value instanceof Node) return "[" + value.nodeName + "]";
    if (typeof value !== "object") return String(value);
    if (depth >= 4) return "[Max depth]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => serialize(item, depth + 1, seen));
    const output = {};
    for (const key of Object.keys(value).slice(0, 100)) {
      try { output[key] = serialize(value[key], depth + 1, seen); }
      catch { output[key] = "[Unreadable]"; }
    }
    return output;
  };
  const serializeValues = (values) => {
    const serialized = values.map((value) => serialize(value));
    try {
      const text = JSON.stringify(serialized);
      if (new TextEncoder().encode(text).byteLength <= 262144) return { values: serialized, truncated: false };
      return { values: [text.slice(0, 262000) + "… [truncated]"], truncated: true };
    } catch {
      return { values: ["[Unserializable console values]"], truncated: true };
    }
  };

  for (const level of ["debug", "info", "log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      original(...values);
      const result = serializeValues(values);
      compat.report("console", {
        frame,
        level: level === "log" ? "info" : level,
        values: result.values,
        truncated: result.truncated,
      });
    };
  }

  addEventListener("error", (event) => {
    const target = event.target;
    const resource = target && target !== window && "src" in target ? target.src : undefined;
    compat.report("runtime-error", {
      frame,
      message: resource ? "External resource failed to load: " + resource : event.message || "Uncaught error",
      filename: event.filename || resource,
      line: event.lineno,
      column: event.colno,
      error: serialize(event.error),
    });
  }, true);
  addEventListener("unhandledrejection", (event) => {
    compat.report("runtime-error", {
      frame,
      message: "Unhandled promise rejection",
      error: serialize(event.reason),
    });
  });

  const globals = compat.globalsForFrame(frame);
  for (const [name, value] of Object.entries(globals)) {
    if ((name === "$" || name === "jQuery") && name in window) continue;
    Object.defineProperty(window, name, { configurable: true, writable: true, value });
  }
  addEventListener("unload", () => compat.unregisterFrame(frame.id), { once: true });
})();
`;

function serialized(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function inlineFunctionSource(value: (...args: never[]) => unknown): string {
  return value.toString().replaceAll("</script", "<\\/script");
}

export function renderPreviewRuntimeDocument(allowedParentOrigins: readonly string[]): string {
  const parentOrigins = serialized(allowedParentOrigins);
  const childBootstrap = serialized(CHILD_BOOTSTRAP);
  const templateBootstrap = serialized(PREVIEW_TEMPLATE_BOOTSTRAP);
  const scriptTransferFactory = inlineFunctionSource(createPreviewScriptTransferManager);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Preset Studio JavaScript Preview</title>
  <link rel="stylesheet" href="/preview-assets/toastr-2.1.4.min.css">
  <script src="/preview-assets/jquery-3.7.1.min.js"></script>
  <script src="/preview-assets/lodash-4.17.21.min.js"></script>
  <script src="/preview-assets/js-yaml-4.1.0.min.js"></script>
  <script src="/preview-assets/showdown-2.1.0.min.js"></script>
  <script src="/preview-assets/toastr-2.1.4.min.js"></script>
  <script src="/preview-assets/zod-3.24.2.umd.js"></script>
  <script>window.YAML = window.jsyaml; window.z = window.Zod;</script>
  <style>
    html, body, #runtime-root, #runtime-frame { width: 100%; height: 100%; margin: 0; border: 0; }
    html, body { overflow: hidden; background: white; }
    #runtime-frame { display: block; background: white; }
    #runtime-status { position: fixed; inset: 0; display: grid; place-items: center; color: #64748b; font: 12px system-ui, sans-serif; }
    body[data-running="true"] #runtime-status { display: none; }
    #preview-sillytavern-root, #preview-project-scripts, #preview-template-root { display: none !important; }
  </style>
</head>
<body>
  <div id="runtime-root">
    <div id="runtime-status">正在等待 Preset Studio 启动动态预览…</div>
  </div>
  <main id="preview-sillytavern-root">
    <section id="chat"></section>
    <div id="extensions_settings"></div><div id="floating_prompt"></div><div id="shadow_popup"></div>
  </main>
  <div id="preview-project-scripts"></div>
  <div id="preview-template-root"></div>
  <script>
  (() => {
    "use strict";
    const protocolVersion = 1;
    const allowedParentOrigins = new Set(${parentOrigins});
    const childBootstrap = ${childBootstrap};
    const templateBootstrap = ${templateBootstrap};
    const __name = (target) => target;
    const createPreviewScriptTransferManager = ${scriptTransferFactory};
    const root = document.getElementById("runtime-root");
    const scriptsRoot = document.getElementById("preview-project-scripts");
    const templateRoot = document.getElementById("preview-template-root");
    const chatRoot = document.getElementById("chat");
    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();
    const knownRequestTypes = new Set([
      "runtime:configure", "script:load", "runtime:start-scripts",
      "script:transfer-begin", "script:transfer-chunk", "script:transfer-commit", "script:transfer-cancel",
      "message:render", "generation:simulate", "state:update", "storage:clear", "runtime:dispose",
    ]);
    const eventListeners = new Map();
    const frameSubscriptions = new Map();
    const registeredFrames = new Map();
    const scriptErrors = new Set();
    const loadedScripts = [];
    const extensionSettings = {
      regex: [],
      preset_allowed_regex: { openai: [] },
      SPreset: { RegexBinding: {} },
      tavern_helper: { variables: {} },
    };
    let channelPort;
    let sessionNonce = "";
    let runtimeFrame;
    let templateFrame;
    let generationRunning = false;
    let configuration;
    let nextFrameId = 0;
    let state = defaultState();

    function defaultState() {
      return {
        variables: { global: {}, chat: {}, message: {} },
        messages: [{ message_id: 0, role: "assistant", message: "", name: "Character", is_user: false, is_system: false }],
        preset: {},
        regexScripts: [],
        context: { user: "User", char: "Character", role: "assistant", mesId: 0 },
        mockGeneration: undefined,
        templateEnabled: true,
      };
    }

    function clone(value) {
      try { return structuredClone(value); }
      catch {
        try { return JSON.parse(JSON.stringify(value)); }
        catch { return value; }
      }
    }

    function mergePresetPatch(current, patch) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return clone(patch);
      const output = current && typeof current === "object" && !Array.isArray(current) ? clone(current) : {};
      for (const [key, value] of Object.entries(patch)) {
        output[key] = value && typeof value === "object" && !Array.isArray(value)
          ? mergePresetPatch(output[key], value)
          : clone(value);
      }
      return output;
    }

    function isRecordValue(value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }

    function replaceObjectContents(target, source) {
      for (const key of Object.keys(target)) delete target[key];
      Object.assign(target, clone(isRecordValue(source) ? source : {}));
      return target;
    }

    function hydrateExtensionSettings() {
      const extensions = isRecordValue(state.preset?.extensions) ? state.preset.extensions : {};
      const spresetSource = isRecordValue(extensions.SPreset)
        ? extensions.SPreset
        : { RegexBinding: {} };
      if (!isRecordValue(extensionSettings.SPreset)) extensionSettings.SPreset = {};
      replaceObjectContents(extensionSettings.SPreset, spresetSource);

      extensionSettings.regex = state.regexScripts;
      if (!isRecordValue(extensionSettings.preset_allowed_regex)) {
        extensionSettings.preset_allowed_regex = {};
      }
      extensionSettings.preset_allowed_regex.openai = state.regexScripts;

      const helperSource = isRecordValue(extensions.tavern_helper) ? extensions.tavern_helper : {};
      const variablesSource = isRecordValue(helperSource.variables) ? helperSource.variables : {};
      if (!isRecordValue(extensionSettings.tavern_helper)) extensionSettings.tavern_helper = {};
      if (!isRecordValue(extensionSettings.tavern_helper.variables)) {
        extensionSettings.tavern_helper.variables = {};
      }
      replaceObjectContents(extensionSettings.tavern_helper.variables, variablesSource);
    }

    function report(type, payload = {}) {
      if (type === "runtime-error" && payload.frame && payload.frame.kind === "project-script") {
        scriptErrors.add(payload.frame.id);
      }
      if (!channelPort) return;
      channelPort.postMessage({
        type: "preview:event",
        protocolVersion,
        sessionNonce,
        payload: { type, timestamp: Date.now(), ...payload },
      });
    }

    function reportStatus(status, message) {
      report("runtime-status", { status, ...(message ? { message } : {}) });
    }

    function frameReference(element) {
      const id = element?.dataset.previewFrameId || "host";
      const kind = element?.dataset.previewFrameKind || "host";
      return {
        id,
        kind,
        ...(element?.dataset.previewFrameName ? { name: element.dataset.previewFrameName } : {}),
        ...(element?.dataset.previewFramePath ? { path: element.dataset.previewFramePath } : {}),
      };
    }

    function registerFrame(element) {
      if (!element) return { id: "host", kind: "host", name: "Preview Host" };
      const frame = frameReference(element);
      registeredFrames.set(frame.id, frame);
      return clone(frame);
    }

    function removeFrameSubscriptions(frameId) {
      const subscriptions = frameSubscriptions.get(frameId) || [];
      for (const { event, record } of subscriptions) {
        const current = eventListeners.get(event) || [];
        eventListeners.set(event, current.filter((item) => item !== record));
      }
      frameSubscriptions.delete(frameId);
      registeredFrames.delete(frameId);
    }

    function unregisterFrame(frameId) {
      if (typeof frameId === "string") removeFrameSubscriptions(frameId);
    }

    function recordCapability(frame, capability, supported, strategy, message) {
      report("capability-used", {
        usage: { capability, frame: clone(frame), supported, strategy, ...(message ? { message } : {}) },
      });
    }

    class PreviewCapabilityError extends Error {
      constructor(capability, suggestedMode = "mock") {
        super(capability + " is unavailable in Preset Studio preview");
        this.name = "PreviewCapabilityError";
        this.code = "PREVIEW_CAPABILITY_UNAVAILABLE";
        this.capability = capability;
        this.suggestedMode = suggestedMode;
      }
    }

    function unavailable(frame, capability, suggestedMode = "mock") {
      recordCapability(frame, capability, false, "stub", "该能力需要 mock 或真实 SillyTavern bridge");
      throw new PreviewCapabilityError(capability, suggestedMode);
    }

    function scopeName(options) {
      const value = options && typeof options === "object" ? options.type || options.scope : undefined;
      return value === "chat" || value === "message" ? value : "global";
    }

    function syncChatDom() {
      chatRoot.replaceChildren();
      for (const message of state.messages) {
        const article = document.createElement("article");
        article.className = "mes";
        article.dataset.mesid = String(message.message_id);
        article.dataset.messageId = String(message.message_id);
        article.dataset.role = String(message.role || "assistant");
        const block = document.createElement("div");
        block.className = "mes_block";
        const text = document.createElement("div");
        text.className = "mes_text";
        text.innerHTML = String(message.message || "");
        block.append(text);
        article.append(block);
        chatRoot.append(article);
      }
    }

    function normalizeMessages() {
      state.messages = state.messages.map((message, index) => ({
        ...message,
        message_id: index,
        role: message.role === "system" || message.role === "user" ? message.role : "assistant",
        message: String(message.message || ""),
        is_user: message.role === "user",
        is_system: message.role === "system",
      }));
      state.context.mesId = Math.min(
        Math.max(Number.isInteger(state.context.mesId) ? state.context.mesId : 0, 0),
        Math.max(0, state.messages.length - 1),
      );
      syncChatDom();
    }

    function normalizePresetBridge() {
      if (!state.preset || typeof state.preset !== "object" || Array.isArray(state.preset)) state.preset = {};
      if (!Array.isArray(state.preset.prompts)) state.preset.prompts = [];
      if (!Array.isArray(state.preset.prompt_order)) state.preset.prompt_order = [];
      if (!state.preset.extensions || typeof state.preset.extensions !== "object" || Array.isArray(state.preset.extensions)) {
        state.preset.extensions = {};
      }
      if (typeof state.preset.preset_settings_openai !== "string" || !state.preset.preset_settings_openai) {
        state.preset.preset_settings_openai = configuration?.projectName || "Preset Studio Preview";
      }
      Object.defineProperty(state.preset.extensions, "regex_scripts", {
        configurable: true,
        enumerable: true,
        get: () => state.regexScripts,
        set: (next) => {
          state.regexScripts = clone(Array.isArray(next) ? next : []);
          hydrateExtensionSettings();
          recordCapability(hostFrame, "preset.regex.sync", true, "memory");
        },
      });
      hydrateExtensionSettings();
    }

    function notifyStateChanged() {
      report("state-changed", { context: clone({
        ...state.context,
        variables: state.variables,
        messages: state.messages,
        mockGeneration: state.mockGeneration,
      }) });
    }

    function resolveMessageId(value) {
      const last = state.messages.length - 1;
      const number = Number(String(value).replaceAll("{{lastMessageId}}", String(last)));
      if (!Number.isInteger(number)) return undefined;
      return number < 0 ? state.messages.length + number : number;
    }

    function selectedMessages(range) {
      if (range === undefined || range === null) return state.messages;
      if (typeof range === "number") {
        const id = resolveMessageId(range);
        return id === undefined ? [] : state.messages.filter((message) => message.message_id === id);
      }
      const text = String(range).replaceAll("{{lastMessageId}}", String(state.messages.length - 1));
      const match = /^(-?\\d+)\\s*-\\s*(-?\\d+)$/.exec(text);
      if (!match) {
        const id = resolveMessageId(text);
        return id === undefined ? [] : state.messages.filter((message) => message.message_id === id);
      }
      const begin = resolveMessageId(match[1]);
      const end = resolveMessageId(match[2]);
      if (begin === undefined || end === undefined) return [];
      const low = Math.min(begin, end);
      const high = Math.max(begin, end);
      return state.messages.filter((message) => message.message_id >= low && message.message_id <= high);
    }

    function trackSubscription(frameId, event, record) {
      const items = frameSubscriptions.get(frameId) || [];
      items.push({ event, record });
      frameSubscriptions.set(frameId, items);
    }

    function onEvent(frame, event, listener, once = false, position = "last") {
      if (typeof listener !== "function") throw new TypeError("event listener must be a function");
      const name = String(event);
      const record = { frameId: frame.id, listener, once };
      const current = eventListeners.get(name) || [];
      if (position === "first") current.unshift(record);
      else current.push(record);
      eventListeners.set(name, current);
      trackSubscription(frame.id, name, record);
      recordCapability(frame, "events", true, "native");
      return () => removeListener(frame, name, listener);
    }

    function removeListener(frame, event, listener) {
      const name = String(event);
      const current = eventListeners.get(name) || [];
      eventListeners.set(name, current.filter((record) => record.frameId !== frame.id || record.listener !== listener));
    }

    async function emitEvent(event, ...args) {
      const name = String(event);
      const current = [...(eventListeners.get(name) || [])];
      report("event", { name, listenerCount: current.length });
      for (const record of current) {
        try { await record.listener(...args); }
        catch (error) {
          report("runtime-error", {
            frame: registeredFrames.get(record.frameId) || { id: record.frameId, kind: "host" },
            message: "Event listener failed: " + name,
            error: String(error),
          });
        }
        if (record.once) removeListener({ id: record.frameId }, name, record.listener);
      }
    }

    const tavernEventNames = [
      "APP_READY", "CHAT_CHANGED", "MESSAGE_RECEIVED", "MESSAGE_SENT", "MESSAGE_UPDATED",
      "MESSAGE_DELETED", "USER_MESSAGE_RENDERED", "CHARACTER_MESSAGE_RENDERED",
      "VARIABLES_UPDATED", "OAI_PRESET_CHANGED_AFTER",
      "GENERATION_STARTED", "GENERATION_ENDED", "GENERATION_STOPPED",
      "GENERATE_BEFORE_COMBINE_PROMPTS", "GENERATE_AFTER_COMBINE_PROMPTS", "GENERATE_AFTER_DATA",
      "CHAT_COMPLETION_PROMPT_READY", "CHAT_COMPLETION_SETTINGS_READY", "TEXT_COMPLETION_SETTINGS_READY",
      "STREAM_TOKEN_RECEIVED",
    ];
    const iframeEventNames = [
      "GENERATION_STARTED", "STREAM_TOKEN_RECEIVED_FULLY",
      "STREAM_TOKEN_RECEIVED_INCREMENTALLY", "GENERATION_ENDED",
    ];
    const eventConstants = (names, normalize = (name) => name) => new Proxy(Object.fromEntries(names.map((name) => [name, normalize(name)])), {
      get(target, property) {
        if (typeof property !== "string") return target[property];
        return target[property] || normalize(property);
      },
    });
    const tavernEvents = eventConstants(tavernEventNames, (name) => name.toLowerCase());
    const iframeEvents = eventConstants(iframeEventNames);

    function snapshotJson(value, info, depth = 0, seen = new WeakSet()) {
      if (value === null || typeof value === "boolean") return value;
      if (typeof value === "string") {
        if (value.length <= 524288) return value;
        info.truncated = true;
        return value.slice(0, 524288) + "… [preview snapshot truncated]";
      }
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "bigint") return String(value);
      if (value === undefined || typeof value === "function" || typeof value === "symbol") return null;
      if (typeof value !== "object") return String(value);
      if (depth >= 12 || seen.has(value)) {
        info.truncated = true;
        return seen.has(value) ? "[Circular]" : "[Max depth]";
      }
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > 2000) info.truncated = true;
        return value.slice(0, 2000).map((item) => snapshotJson(item, info, depth + 1, seen));
      }
      const output = {};
      const entries = Object.entries(value);
      if (entries.length > 500) info.truncated = true;
      for (const [key, item] of entries.slice(0, 500)) output[key] = snapshotJson(item, info, depth + 1, seen);
      return output;
    }

    function generationMessageSnapshot(messages, info) {
      if (!Array.isArray(messages)) return [];
      return messages.map((message) => {
        if (!message || typeof message !== "object") {
          return { role: "system", content: snapshotJson(message, info) };
        }
        return {
          role: String(message.role || "system"),
          content: snapshotJson(message.content === undefined ? "" : message.content, info),
          ...(typeof message.name === "string" && message.name ? { name: message.name } : {}),
        };
      });
    }

    function substitutePromptContent(value) {
      if (typeof value === "string") {
        return value
          .replaceAll("{{user}}", state.context.user)
          .replaceAll("{{char}}", state.context.char)
          .replaceAll("{{lastMessageId}}", String(state.messages.length - 1));
      }
      if (Array.isArray(value)) return value.map(substitutePromptContent);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitutePromptContent(item)]));
      }
      return clone(value);
    }

    function chatMessagesForGeneration() {
      return state.messages.map((message) => ({
        role: message.role === "system" || message.role === "user" ? message.role : "assistant",
        content: String(message.message || ""),
        ...(typeof message.name === "string" && message.name ? { name: message.name } : {}),
      }));
    }

    function buildPresetMessages() {
      const prompts = Array.isArray(state.preset?.prompts) ? state.preset.prompts : [];
      const promptByIdentifier = new Map(prompts
        .filter((prompt) => prompt && typeof prompt === "object" && typeof prompt.identifier === "string")
        .map((prompt) => [prompt.identifier, prompt]));
      const orderGroups = Array.isArray(state.preset?.prompt_order) ? state.preset.prompt_order : [];
      const selectedGroup = orderGroups.find((group) => group && typeof group === "object" && Number(group.character_id) === 100001)
        || orderGroups.find((group) => group && typeof group === "object" && Array.isArray(group.order));
      const ordered = Array.isArray(selectedGroup?.order)
        ? selectedGroup.order.filter((item) => item && typeof item === "object" && item.enabled !== false)
        : prompts.filter((prompt) => prompt && typeof prompt === "object" && prompt.enabled !== false)
          .map((prompt) => ({ identifier: prompt.identifier, enabled: true }));
      const messages = [];
      const chatMessages = chatMessagesForGeneration();
      let insertedChat = false;
      for (const item of ordered) {
        const identifier = String(item.identifier || "");
        if (identifier.toLowerCase() === "chathistory") {
          messages.push(...clone(chatMessages));
          insertedChat = true;
          continue;
        }
        const prompt = promptByIdentifier.get(identifier);
        if (!prompt || prompt.content === undefined || prompt.content === null || prompt.content === "") continue;
        messages.push({
          role: prompt.role === "user" || prompt.role === "assistant" ? prompt.role : "system",
          content: substitutePromptContent(prompt.content),
        });
      }
      if (!insertedChat) messages.push(...clone(chatMessages));
      return messages;
    }

    function promptAsText(messages) {
      return (Array.isArray(messages) ? messages : []).map((message) => {
        const content = message && typeof message === "object" ? message.content : message;
        if (typeof content === "string") return content;
        try { return JSON.stringify(content); }
        catch { return String(content ?? ""); }
      }).join("\\n");
    }

    function promptArray(value, fallback) {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") return [{ role: "system", content: value }];
      return fallback;
    }

    function numberSetting(...values) {
      for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
      }
      return 0;
    }

    function generationSettings(messages) {
      const preset = state.preset && typeof state.preset === "object" ? state.preset : {};
      const source = String(preset.chat_completion_source || "openai");
      const modelKeys = {
        openai: "openai_model", claude: "claude_model", openrouter: "openrouter_model",
        makersuite: "google_model", vertexai: "vertexai_model", mistralai: "mistralai_model",
        custom: "custom_model", deepseek: "deepseek_model", groq: "groq_model",
        chutes: "chutes_model", zai: "zai_model", siliconflow: "siliconflow_model",
        minimax: "minimax_model", moonshot: "moonshot_model",
      };
      const temperature = numberSetting(preset.temp_openai, preset.temperature, 1);
      const settings = {
        messages,
        model: String(preset[modelKeys[source]] || preset.openai_model || "preview-model"),
        temperature,
        temprature: temperature,
        frequency_penalty: numberSetting(preset.freq_pen_openai, preset.frequency_penalty, 0),
        presence_penalty: numberSetting(preset.pres_pen_openai, preset.presence_penalty, 0),
        top_p: numberSetting(preset.top_p_openai, preset.top_p, 1),
        max_tokens: numberSetting(preset.openai_max_tokens, preset.max_tokens, 300),
        stream: preset.stream_openai === true,
        logit_bias: clone(preset.logit_bias || {}),
        stop: clone(Array.isArray(preset.stop) ? preset.stop : []),
        chat_completion_source: source,
        chat_comletion_source: source,
        n: numberSetting(preset.n, 1),
        user_name: state.context.user,
        char_name: state.context.char,
        group_names: [],
        include_reasoning: preset.show_thoughts !== false,
        reasoning_effort: String(preset.reasoning_effort || "auto"),
        json_schema: null,
      };
      for (const key of [
        "top_k_openai", "min_p_openai", "top_a_openai", "repetition_penalty_openai", "seed",
        "custom_url", "custom_include_body", "custom_exclude_body", "custom_include_headers",
        "custom_prompt_post_processing", "verbosity", "enable_web_search", "request_images",
      ]) {
        if (preset[key] !== undefined) settings[key] = clone(preset[key]);
      }
      return settings;
    }

    async function evaluateGenerationTemplates(messages, enabled, eventSequence) {
      if (!enabled) return { messages, count: 0 };
      let count = 0;
      const output = [];
      for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message || typeof message !== "object" || typeof message.content !== "string" || !message.content.includes("<%")) {
          output.push(message);
          continue;
        }
        const result = await evaluateTemplate(message.content, {
          path: "generation/message-" + index + ".ejs",
          phase: "generate",
          reportLifecycle: false,
        });
        output.push({ ...message, content: result.output });
        count += 1;
      }
      if (count > 0) eventSequence.push("PROMPT_TEMPLATE_EJS1");
      return { messages: output, count };
    }

    function reportGeneration(status, data) {
      const info = { truncated: false };
      const generation = {
        status,
        generationId: data.generationId,
        dryRun: data.dryRun,
        eventSequence: [...data.eventSequence],
        initialMessages: generationMessageSnapshot(data.initialMessages, info),
        finalMessages: generationMessageSnapshot(data.finalMessages, info),
        settings: snapshotJson(data.settings, info),
        templateEvaluationCount: data.templateEvaluationCount,
        ...(info.truncated ? { truncated: true } : {}),
        ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
        ...(data.message ? { message: data.message } : {}),
      };
      report("generation-status", { generation });
    }

    async function runGenerationPipeline(frame, options = {}) {
      if (generationRunning) throw new Error("A preview generation pipeline is already running");
      generationRunning = true;
      const startedAt = performance.now();
      const generationId = crypto.randomUUID();
      const dryRun = options.dryRun !== false;
      const eventSequence = [];
      const initialMessages = buildPresetMessages();
      let messages = clone(initialMessages);
      let settings = {};
      let templateEvaluationCount = 0;
      recordCapability(frame, "generation.pipeline", true, "memory", "只模拟前端提示词与事件阶段，不请求模型");
      reportGeneration("running", {
        generationId, dryRun, eventSequence, initialMessages, finalMessages: messages,
        settings, templateEvaluationCount,
      });
      try {
        eventSequence.push("GENERATION_STARTED");
        await emitEvent(tavernEvents.GENERATION_STARTED, "normal", {}, dryRun);

        const beforeData = {
          api: "openai",
          combinedPrompt: null,
          description: "",
          personality: "",
          persona: "",
          scenario: "",
          char: state.context.char,
          user: state.context.user,
          worldInfoBefore: "",
          worldInfoAfter: "",
          beforeScenarioAnchor: "",
          afterScenarioAnchor: "",
          storyString: promptAsText(messages),
          mesExmString: "",
          mesSendString: promptAsText(chatMessagesForGeneration()),
          finalMesSend: clone(state.messages),
          generatedPromptCache: "",
          main: promptAsText(messages),
          jailbreak: "",
          naiPreamble: "",
        };
        eventSequence.push("GENERATE_BEFORE_COMBINE_PROMPTS");
        await emitEvent(tavernEvents.GENERATE_BEFORE_COMBINE_PROMPTS, beforeData);

        const combineData = {
          prompt: beforeData.combinedPrompt === null ? promptAsText(messages) : beforeData.combinedPrompt,
          dryRun,
        };
        eventSequence.push("GENERATE_AFTER_COMBINE_PROMPTS");
        await emitEvent(tavernEvents.GENERATE_AFTER_COMBINE_PROMPTS, combineData);

        const promptReadyData = { chat: messages, dryRun };
        eventSequence.push("CHAT_COMPLETION_PROMPT_READY");
        await emitEvent(tavernEvents.CHAT_COMPLETION_PROMPT_READY, promptReadyData);
        messages = promptArray(promptReadyData.chat, messages);

        const templated = await evaluateGenerationTemplates(messages, options.templateEnabled === true, eventSequence);
        messages = templated.messages;
        templateEvaluationCount = templated.count;

        const generateData = { prompt: messages };
        eventSequence.push("GENERATE_AFTER_DATA");
        await emitEvent(tavernEvents.GENERATE_AFTER_DATA, generateData, dryRun);
        messages = promptArray(generateData.prompt, messages);

        settings = generationSettings(messages);
        if (options.emitSettingsReady !== false) {
          eventSequence.push("CHAT_COMPLETION_SETTINGS_READY");
          await emitEvent(tavernEvents.CHAT_COMPLETION_SETTINGS_READY, settings);
          messages = promptArray(settings.messages, messages);
          settings.messages = messages;
        }
        const durationMs = performance.now() - startedAt;
        reportGeneration("complete", {
          generationId, dryRun, eventSequence, initialMessages, finalMessages: messages,
          settings, templateEvaluationCount, durationMs,
        });
        return { generationId, messages, settings, eventSequence };
      } catch (error) {
        reportGeneration("error", {
          generationId, dryRun, eventSequence, initialMessages, finalMessages: messages,
          settings, templateEvaluationCount, durationMs: performance.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        generationRunning = false;
      }
    }

    function createTavernHelper(frame) {
      const api = {
        getVariables(options = {}) {
          recordCapability(frame, "variables.read", true, "memory");
          return clone(state.variables[scopeName(options)] || {});
        },
        replaceVariables(next, options = {}) {
          recordCapability(frame, "variables.write", true, "memory");
          state.variables[scopeName(options)] = clone(next && typeof next === "object" ? next : {});
          notifyStateChanged();
          void emitEvent(tavernEvents.VARIABLES_UPDATED, scopeName(options));
          return clone(state.variables[scopeName(options)]);
        },
        setVariables(next, options = {}) {
          recordCapability(frame, "variables.write", true, "memory");
          Object.assign(state.variables[scopeName(options)], clone(next && typeof next === "object" ? next : {}));
          notifyStateChanged();
          void emitEvent(tavernEvents.VARIABLES_UPDATED, scopeName(options));
          return clone(state.variables[scopeName(options)]);
        },
        getvar(key, options = {}) { return clone(state.variables[scopeName(options)]?.[String(key)]); },
        setvar(key, value, options = {}) {
          state.variables[scopeName(options)][String(key)] = clone(value);
          notifyStateChanged();
          return clone(value);
        },
        getChatMessages(range = "0-{{lastMessageId}}", options = {}) {
          recordCapability(frame, "messages.read", true, "memory");
          let messages = selectedMessages(range);
          if (options.role && options.role !== "all") messages = messages.filter((message) => message.role === options.role);
          return clone(messages);
        },
        async createChatMessages(messages, options = {}) {
          recordCapability(frame, "messages.create", true, "memory");
          const additions = Array.isArray(messages) ? clone(messages) : [];
          const before = options.insert_before === "end" || options.insert_before === undefined
            ? state.messages.length
            : Math.max(0, resolveMessageId(options.insert_before) ?? state.messages.length);
          state.messages.splice(before, 0, ...additions);
          normalizeMessages();
          notifyStateChanged();
          await emitEvent(tavernEvents.MESSAGE_RECEIVED, clone(additions));
        },
        async setChatMessages(messages) {
          recordCapability(frame, "messages.update", true, "memory");
          for (const update of Array.isArray(messages) ? messages : []) {
            const id = resolveMessageId(update.message_id);
            if (id === undefined || !state.messages[id]) continue;
            state.messages[id] = { ...state.messages[id], ...clone(update), message_id: id };
          }
          normalizeMessages();
          notifyStateChanged();
          await emitEvent(tavernEvents.MESSAGE_UPDATED, clone(messages));
        },
        async deleteChatMessages(ids) {
          recordCapability(frame, "messages.delete", true, "memory");
          const resolved = new Set((Array.isArray(ids) ? ids : []).map(resolveMessageId).filter(Number.isInteger));
          state.messages = state.messages.filter((message) => !resolved.has(message.message_id));
          normalizeMessages();
          notifyStateChanged();
          await emitEvent(tavernEvents.MESSAGE_DELETED, [...resolved]);
        },
        getLastMessageId() { return state.messages.length - 1; },
        getPreset() {
          recordCapability(frame, "preset.read", true, "memory");
          return clone(state.preset);
        },
        async setPreset(nameOrPatch, partialPreset) {
          recordCapability(frame, "preset.write", true, "memory");
          const namedPatch = typeof nameOrPatch === "string" && partialPreset && typeof partialPreset === "object";
          const next = namedPatch ? mergePresetPatch(state.preset, partialPreset) : nameOrPatch;
          state.preset = clone(next || {});
          const extensions = state.preset && typeof state.preset === "object" ? state.preset.extensions : undefined;
          state.regexScripts = clone(Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : []);
          normalizePresetBridge();
          notifyStateChanged();
          void emitEvent(tavernEvents.OAI_PRESET_CHANGED_AFTER, namedPatch ? nameOrPatch : "in_use");
          return clone(state.preset);
        },
        async replacePreset(nameOrPreset, replacement) {
          recordCapability(frame, "preset.write", true, "memory");
          const namedReplacement = typeof nameOrPreset === "string" && replacement && typeof replacement === "object";
          state.preset = clone((namedReplacement ? replacement : nameOrPreset) || {});
          const extensions = state.preset && typeof state.preset === "object" ? state.preset.extensions : undefined;
          state.regexScripts = clone(Array.isArray(extensions?.regex_scripts) ? extensions.regex_scripts : []);
          normalizePresetBridge();
          notifyStateChanged();
          void emitEvent(tavernEvents.OAI_PRESET_CHANGED_AFTER, namedReplacement ? nameOrPreset : "in_use");
          return clone(state.preset);
        },
        getLoadedPresetName: () => configuration?.projectName || "Preset Studio Preview",
        getPresetNames: () => [configuration?.projectName || "Preset Studio Preview"],
        getTavernRegexes() {
          recordCapability(frame, "regex.read", true, "memory");
          return clone(state.regexScripts);
        },
        replaceTavernRegexes(next) {
          recordCapability(frame, "regex.write", true, "memory");
          state.regexScripts = clone(Array.isArray(next) ? next : []);
          hydrateExtensionSettings();
          notifyStateChanged();
          return clone(state.regexScripts);
        },
        eventOn: (event, listener) => onEvent(frame, event, listener),
        eventOnce: (event, listener) => onEvent(frame, event, listener, true),
        eventMakeFirst: (event, listener) => onEvent(frame, event, listener, false, "first"),
        eventMakeLast: (event, listener) => onEvent(frame, event, listener),
        eventEmit: (event, ...args) => { void emitEvent(event, ...args); },
        eventEmitAndWait: (event, ...args) => emitEvent(event, ...args),
        eventRemoveListener: (event, listener) => removeListener(frame, event, listener),
        eventClearEvent(event) {
          const name = String(event);
          eventListeners.set(name, (eventListeners.get(name) || []).filter((record) => record.frameId !== frame.id));
        },
        eventClearListener(listener) {
          for (const [event, records] of eventListeners) {
            eventListeners.set(event, records.filter((record) => record.frameId !== frame.id || record.listener !== listener));
          }
        },
        eventClearAll: () => removeFrameSubscriptions(frame.id),
        getIframeName: () => frame.id,
        getMessageId: () => frame.kind === "message" ? state.context.mesId : undefined,
        getCurrentMessageId: () => frame.kind === "message" ? state.context.mesId : undefined,
        getScriptId: () => frame.kind === "project-script" ? frame.id : undefined,
        getScriptName: () => frame.kind === "project-script" ? frame.name : undefined,
        getScriptInfo: () => ({ id: frame.id, name: frame.name, path: frame.path }),
        getButtonEvent: (name) => "preset-studio:script-button:" + frame.id + ":" + String(name),
        getScriptTrees: () => clone(loadedScripts),
        getAllEnabledScriptButtons: () => [],
        reloadIframe: () => frame.kind === "host" ? location.reload() : document.querySelector('[data-preview-frame-id="' + CSS.escape(frame.id) + '"]')?.contentWindow?.location.reload(),
        substitudeMacros(text) {
          return String(text)
            .replaceAll("{{user}}", state.context.user)
            .replaceAll("{{char}}", state.context.char)
            .replaceAll("{{lastMessageId}}", String(state.messages.length - 1));
        },
        substituteMacros(text) { return api.substitudeMacros(text); },
        async generate() {
          recordCapability(frame, "generation", Boolean(state.mockGeneration), state.mockGeneration ? "memory" : "stub");
          if (typeof state.mockGeneration !== "string") return unavailable(frame, "generate", "mock");
          const { generationId } = await runGenerationPipeline(frame, {
            dryRun: false,
            emitSettingsReady: true,
            templateEnabled: state.templateEnabled,
          });
          await emitEvent(tavernEvents.STREAM_TOKEN_RECEIVED, state.mockGeneration);
          await emitEvent(iframeEvents.STREAM_TOKEN_RECEIVED_FULLY, state.mockGeneration, generationId);
          await emitEvent(iframeEvents.GENERATION_ENDED, state.mockGeneration, generationId);
          return state.mockGeneration;
        },
        generateRaw() { return api.generate(); },
        triggerSlash: () => unavailable(frame, "triggerSlash", "live-bridge"),
        getWorldbookNames: () => unavailable(frame, "getWorldbookNames", "mock"),
        getWorldbook: () => unavailable(frame, "getWorldbook", "mock"),
        replaceWorldbook: () => unavailable(frame, "replaceWorldbook", "live-bridge"),
        getCharacterNames: () => [state.context.char],
        getCurrentCharacterName: () => state.context.char,
        getTavernHelperVersion: () => "preset-studio-m3",
        getTavernHelperExtensionId: () => "preset-studio-preview",
        getTavernVersion: () => "preview-mock",
      };
      return Object.freeze(api);
    }

    const hostFrame = { id: "host", kind: "host", name: "Preview Host" };
    const hostTavernHelper = createTavernHelper(hostFrame);
    const eventListenerViews = new Map();
    const eventSourceEvents = new Proxy({}, {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        const records = eventListeners.get(property);
        if (!records) return undefined;
        let view = eventListenerViews.get(property);
        if (!view) {
          view = new Proxy([], {
            get(_listeners, key) {
              const current = eventListeners.get(property) || [];
              if (key === "length") return current.length;
              if (key === Symbol.iterator) return function* () {
                for (const record of current) yield record.listener;
              };
              const index = typeof key === "string" && /^\d+$/.test(key) ? Number(key) : undefined;
              return index === undefined ? undefined : current[index]?.listener;
            },
            set(_listeners, key, listener) {
              const current = eventListeners.get(property) || [];
              const index = typeof key === "string" && /^\d+$/.test(key) ? Number(key) : undefined;
              if (index === undefined || !current[index] || typeof listener !== "function") return false;
              current[index].listener = listener;
              return true;
            },
          });
          eventListenerViews.set(property, view);
        }
        return view;
      },
    });
    const eventSource = {
      events: eventSourceEvents,
      on: (event, listener) => onEvent(hostFrame, event, listener),
      once: (event, listener) => onEvent(hostFrame, event, listener, true),
      makeFirst: (event, listener) => onEvent(hostFrame, event, listener, false, "first"),
      makeLast: (event, listener) => onEvent(hostFrame, event, listener),
      off: (event, listener) => removeListener(hostFrame, event, listener),
      removeListener: (event, listener) => removeListener(hostFrame, event, listener),
      emit: (event, ...args) => emitEvent(event, ...args),
    };
    const popupTypes = eventConstants(["TEXT", "CONFIRM", "DISPLAY", "INPUT"]);
    const contextBridge = {
      eventSource,
      eventTypes: tavernEvents,
      extensionSettings,
      this_chid: 0,
      POPUP_TYPE: popupTypes,
      getCurrentChatId: () => configuration?.projectId || "preview",
      saveSettingsDebounced() {
        recordCapability(hostFrame, "settings.save", true, "memory");
      },
      reloadCurrentChat() {
        recordCapability(hostFrame, "chat.reload", true, "memory");
        syncChatDom();
        void emitEvent(tavernEvents.CHAT_CHANGED, configuration?.projectId || "preview");
      },
      uuidv4: () => crypto.randomUUID(),
      substituteParams: (value) => hostTavernHelper.substituteMacros(value),
      substituteParamsExtended: (value) => hostTavernHelper.substituteMacros(value),
      isMobile: () => false,
      renderExtensionTemplateAsync() {
        recordCapability(hostFrame, "extensions.template", false, "stub", "扩展设置模板未在预览中实现");
        return Promise.resolve("");
      },
      t(strings, ...values) {
        if (!Array.isArray(strings)) return String(strings);
        return strings.reduce((output, part, index) => output + part + (index < values.length ? values[index] : ""), "");
      },
      callGenericPopup() {
        recordCapability(hostFrame, "SillyTavern.callGenericPopup", false, "stub", "完整 SillyTavern 弹窗宿主未在预览中实现");
        return Promise.resolve(false);
      },
      registerFunctionTool() {
        recordCapability(hostFrame, "tools.register", false, "stub", "函数工具只在真实 SillyTavern 生成链路中生效");
      },
      unregisterFunctionTool() {
        recordCapability(hostFrame, "tools.unregister", false, "stub", "函数工具只在真实 SillyTavern 生成链路中生效");
      },
    };
    Object.defineProperties(contextBridge, {
      chat: { enumerable: true, get: () => state.messages },
      name1: { enumerable: true, get: () => state.context.user },
      name2: { enumerable: true, get: () => state.context.char },
      characters: { enumerable: true, get: () => [{ name: state.context.char }] },
      chatCompletionSettings: { enumerable: true, get: () => state.preset },
    });
    const sillyTavern = {
      extensionSettings,
      getContext() {
        recordCapability(hostFrame, "SillyTavern.getContext", true, "memory");
        return contextBridge;
      },
      getCurrentChatId() { return configuration?.projectId || "preview"; },
    };
    Object.defineProperties(sillyTavern, {
      chat: { enumerable: true, get: () => state.messages },
      name1: { enumerable: true, get: () => state.context.user },
      name2: { enumerable: true, get: () => state.context.char },
    });

    const ejsTemplate = Object.freeze({
      async evalTemplate(source, extraContext = {}, options = {}) {
        recordCapability(hostFrame, "EjsTemplate.evalTemplate", true, "native");
        const phase = options && options.when === "generate" ? "generate" : "render";
        const result = await evaluateTemplate(String(source), {
          path: "EjsTemplate.evalTemplate",
          phase,
          extraContext,
          reportLifecycle: false,
        });
        return result.output;
      },
      async prepareContext(extraContext = {}) {
        recordCapability(hostFrame, "EjsTemplate.prepareContext", true, "memory");
        return clone({
          ...extraContext,
          user: state.context.user,
          char: state.context.char,
          userName: state.context.user,
          assistantName: state.context.char,
          charName: state.context.char,
          mesId: state.context.mesId,
          role: state.context.role,
          variables: { ...state.variables.global, ...state.variables.chat, ...state.variables.message },
          messages: state.messages,
        });
      },
      allVariables() {
        return clone({ ...state.variables.global, ...state.variables.chat, ...state.variables.message });
      },
      async saveVariables() {},
      getFeatures: () => ({ enabled: true, render_enabled: true, generate_enabled: true }),
      setFeatures: () => unavailable(hostFrame, "EjsTemplate.setFeatures", "preview-context"),
      resetFeatures: () => unavailable(hostFrame, "EjsTemplate.resetFeatures", "preview-context"),
      refreshWorldInfo: () => unavailable(hostFrame, "EjsTemplate.refreshWorldInfo", "mock"),
      compileTemplate: () => unavailable(hostFrame, "EjsTemplate.compileTemplate", "full-prompt-template"),
      defines: Object.freeze({}),
      initialVariables: Object.freeze({}),
    });

    function globalsForFrame(frame) {
      const helper = createTavernHelper(frame);
      return {
        TavernHelper: helper,
        SillyTavern: sillyTavern,
        tavern_events: tavernEvents,
        iframe_events: iframeEvents,
        PreviewCapabilityError,
        _: window._,
        $: window.$,
        jQuery: window.jQuery,
        toastr: window.toastr,
        YAML: window.YAML,
        showdown: window.showdown,
        z: window.z,
        EjsTemplate: ejsTemplate,
        ...helper,
      };
    }

    window.TavernHelper = hostTavernHelper;
    window.SillyTavern = sillyTavern;
    window.tavern_events = tavernEvents;
    window.iframe_events = iframeEvents;
    window.PreviewCapabilityError = PreviewCapabilityError;
    window.EjsTemplate = ejsTemplate;
    for (const [name, value] of Object.entries(hostTavernHelper)) {
      if (!(name in window)) Object.defineProperty(window, name, { configurable: true, writable: true, value });
    }
    Object.defineProperty(window, "__presetStudioCompat", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ registerFrame, unregisterFrame, globalsForFrame, report }),
    });

    function childHead() {
      return '<scr' + 'ipt src="/preview-assets/jquery-3.7.1.min.js"></scr' + 'ipt>'
        + '<scr' + 'ipt>' + childBootstrap + '\\n//# sourceURL=preset-studio-preview-bootstrap.js\\n</scr' + 'ipt>';
    }

    function buildDocument(source) {
      const bootstrap = childHead();
      if (/<head(?:\\s[^>]*)?>/i.test(source)) {
        return source.replace(/<head(?:\\s[^>]*)?>/i, (match) => match + bootstrap);
      }
      if (/<html(?:\\s[^>]*)?>/i.test(source)) {
        return source.replace(/<html(?:\\s[^>]*)?>/i, (match) => match + "<head>" + bootstrap + "</head>");
      }
      return '<!doctype html><html><head><meta charset="utf-8">' + bootstrap + "</head><body>" + source + "</body></html>";
    }

    function createFrame(kind, id, name, path) {
      const frame = document.createElement("iframe");
      frame.dataset.previewFrameKind = kind;
      frame.dataset.previewFrameId = id;
      frame.dataset.previewFrameName = name;
      frame.dataset.previewFramePath = path;
      frame.referrerPolicy = "no-referrer";
      frame.title = name;
      return frame;
    }

    function waitForFrame(frame, timeoutMs = 30000) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Frame load timed out: " + frame.title)), timeoutMs);
        frame.addEventListener("load", () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
    }

    function unwrapHtmlFence(value) {
      const trimmed = String(value).trim();
      const fence = String.fromCharCode(96).repeat(3);
      const match = new RegExp("^" + fence + "(?:html)?\\s*\\r?\\n([\\s\\S]*?)\\r?\\n" + fence + "$", "i").exec(trimmed);
      return match ? match[1] || "" : String(value);
    }

    function textPreviewDocument(value) {
      const escaped = String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      return '<!doctype html><html><head><meta charset="utf-8"><style>'
        + 'html,body{margin:0;min-height:100%;background:#fff;color:#1e293b}'
        + '#prompt-template-output{box-sizing:border-box;min-height:100vh;margin:0;padding:24px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace}'
        + '</style></head><body><pre id="prompt-template-output">' + escaped + '</pre></body></html>';
    }

    function templateDocument() {
      return '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="referrer" content="no-referrer">'
        + '<link rel="stylesheet" href="/preview-assets/toastr-2.1.4.min.css">'
        + '<scr' + 'ipt src="/preview-assets/jquery-3.7.1.min.js"></scr' + 'ipt>'
        + '<scr' + 'ipt src="/preview-assets/lodash-4.17.21.min.js"></scr' + 'ipt>'
        + '<scr' + 'ipt src="/preview-assets/js-yaml-4.1.0.min.js"></scr' + 'ipt>'
        + '<scr' + 'ipt src="/preview-assets/toastr-2.1.4.min.js"></scr' + 'ipt>'
        + '<scr' + 'ipt src="/preview-assets/zod-3.24.2.umd.js"></scr' + 'ipt>'
        + '<scr' + 'ipt src="/preview-assets/ejs-3.1.10.min.js"></scr' + 'ipt>'
        + '</head><body><scr' + 'ipt>' + templateBootstrap
        + '\\n//# sourceURL=preset-studio-template-bootstrap.js\\n</scr' + 'ipt></body></html>';
    }

    function destroyTemplateFrame() {
      if (!templateFrame) return;
      templateFrame.remove();
      templateFrame = undefined;
    }

    async function evaluateTemplate(source, options) {
      const startedAt = performance.now();
      const path = String(options.path || "preview-template.ejs");
      const phase = options.phase === "generate" ? "generate" : "render";
      const reportLifecycle = options.reportLifecycle !== false;
      destroyTemplateFrame();
      nextFrameId += 1;
      const frame = createFrame("template", "template-" + nextFrameId, "Prompt Template / EJS", path);
      frame.sandbox.value = "allow-scripts";
      frame.hidden = true;
      templateFrame = frame;

      if (reportLifecycle) {
        report("template-status", {
          template: { status: "evaluating", detected: true, enabled: true, phase, path },
        });
      }

      let readyResolve;
      let readyReject;
      const readyPromise = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      const readyTimeout = setTimeout(() => readyReject(new Error("Prompt Template frame initialization timed out")), 5000);
      const handleReady = (event) => {
        if (event.source !== frame.contentWindow || !event.data || event.data.type !== "template:ready") return;
        clearTimeout(readyTimeout);
        window.removeEventListener("message", handleReady);
        readyResolve();
      };
      window.addEventListener("message", handleReady);
      frame.srcdoc = templateDocument();
      templateRoot.append(frame);

      let port;
      try {
        await readyPromise;
        if (templateFrame !== frame) throw new Error("Prompt Template frame was replaced");
        const channel = new MessageChannel();
        port = channel.port1;
        const requestId = crypto.randomUUID();
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Prompt Template evaluation timed out after 5 seconds")), 5000);
          port.onmessage = (event) => {
            const message = event.data;
            if (!message || typeof message.type !== "string") return;
            if (message.type === "template:log") {
              report("console", {
                frame: frameReference(frame),
                level: message.level || "info",
                values: Array.isArray(message.values) ? message.values : [],
              });
              return;
            }
            if (message.requestId !== requestId) return;
            clearTimeout(timeout);
            if (message.type === "template:result") resolve(message.payload);
            else if (message.type === "template:error") {
              const error = new Error(message.payload?.message || "Prompt Template evaluation failed");
              error.name = message.payload?.name || "PreviewTemplateError";
              error.stack = message.payload?.stack || error.stack;
              if (Number.isInteger(message.payload?.line)) error.line = message.payload.line;
              reject(error);
            }
          };
          port.start();
        });
        frame.contentWindow.postMessage({ type: "template:connect" }, "*", [channel.port2]);
        port.postMessage({
          type: "template:evaluate",
          requestId,
          payload: {
            source,
            path,
            phase,
            extraContext: clone(options.extraContext || {}),
            user: state.context.user,
            char: state.context.char,
            role: state.context.role,
            mesId: state.context.mesId,
            variables: clone(state.variables),
            messages: clone(state.messages),
          },
        });
        const result = await resultPromise;
        if (!result || typeof result.output !== "string" || !result.variables || typeof result.variables !== "object") {
          throw new TypeError("Prompt Template frame returned an invalid result");
        }
        state.variables = clone(result.variables);
        notifyStateChanged();
        const durationMs = performance.now() - startedAt;
        if (reportLifecycle) {
          report("template-status", {
            template: {
              status: "rendered",
              detected: true,
              enabled: true,
              phase,
              path,
              durationMs,
              inputBytes: textEncoder.encode(source).byteLength,
              outputBytes: textEncoder.encode(result.output).byteLength,
            },
          });
        }
        return { output: result.output, durationMs };
      } catch (error) {
        const diagnostic = {
          status: "error",
          detected: true,
          enabled: true,
          phase,
          path,
          message: error instanceof Error ? error.message : String(error),
          ...(Number.isInteger(error?.line) ? { line: error.line } : {}),
        };
        if (reportLifecycle) report("template-status", { template: diagnostic });
        report("runtime-error", {
          frame: frameReference(frame),
          message: diagnostic.message,
          ...(diagnostic.line ? { line: diagnostic.line } : {}),
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
        });
        throw error;
      } finally {
        clearTimeout(readyTimeout);
        window.removeEventListener("message", handleReady);
        port?.close();
        if (templateFrame === frame) destroyTemplateFrame();
      }
    }

    async function configure(payload) {
      if (!payload || typeof payload.projectId !== "string" || !payload.context || typeof payload.context !== "object") {
        throw new TypeError("runtime:configure payload is invalid");
      }
      disposeFrames();
      configuration = clone(payload);
      state = defaultState();
      state.variables = clone(payload.context.variables || state.variables);
      state.messages = clone(Array.isArray(payload.context.messages) ? payload.context.messages : state.messages);
      state.preset = clone(payload.preset || {});
      state.regexScripts = clone(Array.isArray(payload.regexScripts) ? payload.regexScripts : []);
      normalizePresetBridge();
      state.context = {
        user: String(payload.context.user || "User"),
        char: String(payload.context.char || "Character"),
        role: payload.context.role || "assistant",
        mesId: Number.isInteger(payload.context.mesId) ? payload.context.mesId : 0,
      };
      state.mockGeneration = typeof payload.context.mockGeneration === "string" ? payload.context.mockGeneration : undefined;
      state.templateEnabled = payload.templateEnabled !== false;
      normalizeMessages();
      reportStatus("loading-scripts");
    }

    async function loadProjectScript(payload) {
      if (!payload || !payload.script || typeof payload.source !== "string") throw new TypeError("script:load payload is invalid");
      if (textEncoder.encode(payload.source).byteLength > 16 * 1024 * 1024) throw new Error("Project script exceeds 16 MiB: " + payload.script.path);
      const script = payload.script;
      const id = String(script.id || script.uid || "script-" + script.index);
      const name = String(script.name || id);
      const path = String(script.path || "content.js");
      const frame = createFrame("project-script", id, name, path);
      frame.hidden = true;
      const sourceUrl = "preset-studio://project/" + encodeURIComponent(configuration.projectId) + "/scripts/" + encodeURIComponent(script.uid || id) + "/content.js";
      const blobUrl = URL.createObjectURL(new Blob([payload.source, "\\n//# sourceURL=" + sourceUrl + "\\n"], { type: "text/javascript" }));
      // TavernHelper executes project scripts as ES modules in their own iframes.
      // Keeping that execution mode is important: existing presets commonly use
      // top-level await and module-only syntax.
      const external = '<scr' + 'ipt type="module" src="' + blobUrl.replaceAll('"', "&quot;") + '"></scr' + 'ipt>';
      frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8">' + childHead() + "</head><body>" + external + "</body></html>";
      const loaded = waitForFrame(frame);
      scriptsRoot.append(frame);
      loadedScripts.push({ id, name, path, index: script.index, enabled: true });
      report("script-status", { script: { id, name, path, index: script.index, status: "loading" } });
      try {
        await loaded;
        const status = scriptErrors.has(id) ? "error" : "running";
        report("script-status", { script: { id, name, path, index: script.index, status } });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    async function digestSha256(value) {
      const digest = await crypto.subtle.digest("SHA-256", value);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }

    function reportScriptTransferProgress({ script, transferredBytes, totalBytes }) {
      const id = String(script.id || script.uid || "script-" + script.index);
      const name = String(script.name || id);
      const path = String(script.path || "content.js");
      report("script-status", {
        script: {
          id,
          name,
          path,
          index: Number.isInteger(script.index) ? script.index : 0,
          status: "loading",
          transferredBytes,
          byteLength: totalBytes,
        },
      });
    }

    const scriptTransfers = createPreviewScriptTransferManager({
      textEncoder,
      textDecoder,
      digestSha256,
      maxScriptBytes: 16 * 1024 * 1024,
      maxChunkBytes: 1024 * 1024,
      maxChunks: 128,
      load: loadProjectScript,
      onProgress: reportScriptTransferProgress,
    });

    async function startScripts() {
      await emitEvent(tavernEvents.APP_READY);
      reportStatus("running");
    }

    async function renderMessage(payload) {
      if (!payload || typeof payload.source !== "string" || typeof payload.path !== "string") {
        throw new TypeError("message:render payload is invalid");
      }
      if (textEncoder.encode(payload.source).byteLength > 8 * 1024 * 1024) throw new Error("HTML preview exceeds 8 MiB");
      const startedAt = performance.now();
      const templateDetected = payload.source.includes("<%");
      const templateEnabled = payload.template?.enabled === true;
      const templatePhase = payload.template?.phase === "generate" ? "generate" : "render";
      let source = payload.source;
      if (templateDetected && templateEnabled) {
        const evaluated = await evaluateTemplate(source, {
          path: payload.path,
          phase: templatePhase,
          extraContext: payload.template?.extraContext,
          reportLifecycle: true,
        });
        source = evaluated.output;
      } else if (templateDetected) {
        report("template-status", {
          template: {
            status: "disabled",
            detected: true,
            enabled: false,
            phase: templatePhase,
            path: payload.path,
            message: "检测到 EJS 标签，但 Prompt Template / EJS 求值已关闭；源码保持不变。",
          },
        });
      } else {
        report("template-status", {
          template: { status: "none", detected: false, enabled: templateEnabled, phase: templatePhase, path: payload.path },
        });
      }
      source = payload.contentMode === "text" ? textPreviewDocument(source) : unwrapHtmlFence(source);
      if (textEncoder.encode(source).byteLength > 8 * 1024 * 1024) throw new Error("Rendered HTML preview exceeds 8 MiB");
      if (runtimeFrame) {
        removeFrameSubscriptions(runtimeFrame.dataset.previewFrameId);
        runtimeFrame.remove();
      }
      nextFrameId += 1;
      runtimeFrame = createFrame("message", "message-" + nextFrameId, payload.path, payload.path);
      runtimeFrame.id = "runtime-frame";
      runtimeFrame.srcdoc = buildDocument(source);
      const loaded = waitForFrame(runtimeFrame);
      root.append(runtimeFrame);
      document.body.dataset.running = "true";
      await loaded;
      report("rendered", { path: payload.path, durationMs: performance.now() - startedAt });
    }

    async function simulateGeneration(payload) {
      await runGenerationPipeline(hostFrame, {
        dryRun: true,
        emitSettingsReady: true,
        templateEnabled: payload?.templateEnabled === true,
      });
    }

    function updateState(payload) {
      if (!payload || typeof payload !== "object") throw new TypeError("state:update payload is invalid");
      if (payload.variables && typeof payload.variables === "object") state.variables = clone(payload.variables);
      if (Array.isArray(payload.messages)) state.messages = clone(payload.messages);
      if (typeof payload.user === "string") state.context.user = payload.user;
      if (typeof payload.char === "string") state.context.char = payload.char;
      if (typeof payload.role === "string") state.context.role = payload.role;
      if (Number.isInteger(payload.mesId)) state.context.mesId = payload.mesId;
      if (typeof payload.mockGeneration === "string" || payload.mockGeneration === null) {
        state.mockGeneration = payload.mockGeneration === null ? undefined : payload.mockGeneration;
      }
      if (typeof payload.templateEnabled === "boolean") state.templateEnabled = payload.templateEnabled;
      normalizeMessages();
      notifyStateChanged();
    }

    function disposeFrames() {
      generationRunning = false;
      scriptTransfers.clear();
      destroyTemplateFrame();
      if (runtimeFrame) {
        removeFrameSubscriptions(runtimeFrame.dataset.previewFrameId);
        runtimeFrame.remove();
        runtimeFrame = undefined;
      }
      for (const frame of [...scriptsRoot.querySelectorAll("iframe")]) {
        removeFrameSubscriptions(frame.dataset.previewFrameId);
        frame.remove();
      }
      loadedScripts.length = 0;
      scriptErrors.clear();
      delete document.body.dataset.running;
    }

    function deleteDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("Unable to delete IndexedDB database: " + name));
        request.onblocked = () => reject(new Error("IndexedDB deletion was blocked: " + name));
      });
    }

    async function clearSiteStorage() {
      disposeFrames();
      localStorage.clear();
      sessionStorage.clear();
      if (typeof indexedDB.databases === "function") {
        const databases = await indexedDB.databases();
        for (const database of databases) {
          if (database.name) await deleteDatabase(database.name);
        }
      }
      if (globalThis.caches && typeof globalThis.caches.keys === "function") {
        const keys = await globalThis.caches.keys();
        await Promise.all(keys.map((key) => globalThis.caches.delete(key)));
      }
      state = defaultState();
      configuration = undefined;
      reportStatus("stopped", "Preview Origin 站点存储已清空");
    }

    async function handleRequest(message) {
      if (message.type === "runtime:configure") await configure(message.payload);
      else if (message.type === "script:load") await loadProjectScript(message.payload);
      else if (message.type === "script:transfer-begin") scriptTransfers.begin(message.payload);
      else if (message.type === "script:transfer-chunk") scriptTransfers.append(message.payload);
      else if (message.type === "script:transfer-commit") await scriptTransfers.commit(message.payload);
      else if (message.type === "script:transfer-cancel") scriptTransfers.cancel(message.payload);
      else if (message.type === "runtime:start-scripts") await startScripts();
      else if (message.type === "message:render") await renderMessage(message.payload);
      else if (message.type === "generation:simulate") await simulateGeneration(message.payload);
      else if (message.type === "state:update") updateState(message.payload);
      else if (message.type === "storage:clear") await clearSiteStorage();
      else if (message.type === "runtime:dispose") {
        disposeFrames();
        state = defaultState();
        configuration = undefined;
        reportStatus("stopped");
      }
    }

    async function handlePortMessage(event) {
      const message = event.data;
      if (
        !message
        || message.protocolVersion !== protocolVersion
        || message.sessionNonce !== sessionNonce
        || typeof message.requestId !== "string"
        || !knownRequestTypes.has(message.type)
      ) return;
      try {
        await handleRequest(message);
        channelPort.postMessage({ type: "preview:ack", protocolVersion, sessionNonce, requestId: message.requestId });
      } catch (error) {
        channelPort.postMessage({
          type: "preview:error",
          protocolVersion,
          sessionNonce,
          requestId: message.requestId,
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    function ready() {
      window.parent.postMessage({ type: "preview:ready", protocolVersion }, "*");
    }
    const readyTimer = window.setInterval(ready, 300);
    ready();
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (event.source !== window.parent || !message || message.type !== "preview:connect" || message.protocolVersion !== protocolVersion) return;
      if (!allowedParentOrigins.has(event.origin)) return;
      const port = event.ports[0];
      if (!port || typeof message.sessionNonce !== "string" || message.sessionNonce.length < 16) return;
      window.clearInterval(readyTimer);
      channelPort?.close();
      channelPort = port;
      sessionNonce = message.sessionNonce;
      channelPort.onmessage = handlePortMessage;
      channelPort.start();
      channelPort.postMessage({ type: "preview:connected", protocolVersion, sessionNonce });
      reportStatus("booting");
    });
  })();
  </script>
</body>
</html>`;
}
