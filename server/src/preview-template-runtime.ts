/**
 * Bootstrap for the disposable Prompt Template evaluation frame.
 *
 * The frame is sandboxed without allow-same-origin and communicates with the
 * Preview Host through a transferred MessagePort. User EJS therefore executes
 * in the Preview browsing context, never in the Studio page or Node process.
 */
export const PREVIEW_TEMPLATE_BOOTSTRAP = String.raw`
(() => {
  "use strict";

  let channelPort;

  function clone(value) {
    try { return structuredClone(value); }
    catch {
      try { return JSON.parse(JSON.stringify(value)); }
      catch { return value; }
    }
  }

  function serialize(value, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return String(value) + "n";
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (typeof Node !== "undefined" && value instanceof Node) return "[" + value.nodeName + "]";
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
  }

  function send(type, payload = {}) {
    channelPort?.postMessage({ type, ...payload });
  }

  for (const level of ["debug", "info", "log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      original(...values);
      send("template:log", {
        level: level === "log" ? "info" : level,
        values: values.map((value) => serialize(value)),
      });
    };
  }

  function optionObject(options) {
    if (typeof options === "string") return { flags: options };
    return options && typeof options === "object" ? options : {};
  }

  function readScopeName(options) {
    const value = optionObject(options).scope;
    if (value === "global") return "global";
    if (value === "local" || value === "chat") return "chat";
    if (value === "message") return "message";
    return "cache";
  }

  function writeScopeName(options) {
    const normalized = optionObject(options);
    const value = normalized.outscope || normalized.scope;
    if (value === "global") return "global";
    if (value === "local" || value === "chat") return "chat";
    return "message";
  }

  function buildContext(payload) {
    const variablesByScope = clone(payload.variables || { global: {}, chat: {}, message: {} });
    variablesByScope.global = variablesByScope.global && typeof variablesByScope.global === "object" ? variablesByScope.global : {};
    variablesByScope.chat = variablesByScope.chat && typeof variablesByScope.chat === "object" ? variablesByScope.chat : {};
    variablesByScope.message = variablesByScope.message && typeof variablesByScope.message === "object" ? variablesByScope.message : {};
    const messages = Array.isArray(payload.messages) ? clone(payload.messages) : [];
    const mesId = Number.isInteger(payload.mesId) ? Math.max(0, Math.min(payload.mesId, Math.max(0, messages.length - 1))) : 0;
    const currentMessage = messages[mesId] || {};

    const mergedVariables = () => window._.merge(
      {},
      variablesByScope.global,
      variablesByScope.chat,
      variablesByScope.message,
    );

    function getvar(key, options = {}) {
      const normalized = optionObject(options);
      const scope = readScopeName(normalized);
      const source = scope === "cache" ? mergedVariables() : variablesByScope[scope];
      if (key === null || key === undefined || key === "") return clone(source);
      const result = window._.get(source, String(key));
      return result === undefined ? clone(normalized.defaults) : clone(result);
    }

    function setvar(key, value, options = {}) {
      if (key === null || key === undefined || key === "") throw new TypeError("setvar key must not be empty");
      const normalized = optionObject(options);
      const target = variablesByScope[writeScopeName(normalized)];
      const oldValue = clone(window._.get(target, String(key)));
      window._.set(target, String(key), clone(value));
      if (normalized.results === "old") return oldValue;
      if (normalized.results === "fullcache") return mergedVariables();
      return clone(value);
    }

    function delvar(key, options = {}) {
      const target = variablesByScope[writeScopeName(options)];
      const oldValue = clone(window._.get(target, String(key)));
      window._.unset(target, String(key));
      return oldValue;
    }

    function changevar(key, amount, options, direction) {
      const normalized = optionObject(options);
      const current = Number(getvar(key, { ...normalized, scope: normalized.inscope || normalized.scope, defaults: normalized.defaults ?? 0 }));
      const delta = Number(amount ?? 1);
      let next = current + direction * (Number.isFinite(delta) ? delta : 0);
      if (Number.isFinite(normalized.min)) next = Math.max(next, Number(normalized.min));
      if (Number.isFinite(normalized.max)) next = Math.min(next, Number(normalized.max));
      return setvar(key, next, normalized);
    }

    function substituteMacros(value) {
      return String(value)
        .replaceAll("{{user}}", String(payload.user || "User"))
        .replaceAll("{{char}}", String(payload.char || "Character"))
        .replaceAll("{{lastMessageId}}", String(Math.max(0, messages.length - 1)))
        .replace(/{{getvar::([^}]+)}}/gi, (_match, key) => String(getvar(String(key).trim(), { scope: "local", defaults: "" })))
        .replace(/{{getglobalvar::([^}]+)}}/gi, (_match, key) => String(getvar(String(key).trim(), { scope: "global", defaults: "" })))
        .replace(/{{getmessagevar::([^}]+)}}/gi, (_match, key) => String(getvar(String(key).trim(), { scope: "message", defaults: "" })));
    }

    const context = Object.assign({}, clone(payload.extraContext || {}), {
      _: window._,
      $: window.$,
      jQuery: window.jQuery,
      z: window.Zod,
      YAML: window.jsyaml,
      toastr: window.toastr,
      console,
      user: String(payload.user || "User"),
      char: String(payload.char || "Character"),
      userName: String(payload.user || "User"),
      assistantName: String(payload.char || "Character"),
      charName: String(payload.char || "Character"),
      mesId,
      messageId: mesId,
      role: payload.role || currentMessage.role || "assistant",
      is_user: (payload.role || currentMessage.role) === "user",
      is_system: (payload.role || currentMessage.role) === "system",
      messages,
      chat: messages,
      message: currentMessage,
      lastMessageId: Math.max(0, messages.length - 1),
      phase: payload.phase === "generate" ? "generate" : "render",
      isGenerating: payload.phase === "generate",
      isRendering: payload.phase !== "generate",
      getvar,
      setvar,
      getLocalVar: (key, options = {}) => getvar(key, { ...optionObject(options), scope: "local" }),
      setLocalVar: (key, value, options = {}) => setvar(key, value, { ...optionObject(options), scope: "local" }),
      getGlobalVar: (key, options = {}) => getvar(key, { ...optionObject(options), scope: "global" }),
      setGlobalVar: (key, value, options = {}) => setvar(key, value, { ...optionObject(options), scope: "global" }),
      getMessageVar: (key, options = {}) => getvar(key, { ...optionObject(options), scope: "message" }),
      setMessageVar: (key, value, options = {}) => setvar(key, value, { ...optionObject(options), scope: "message" }),
      incvar: (key, value = 1, options = {}) => changevar(key, value, options, 1),
      decvar: (key, value = 1, options = {}) => changevar(key, value, options, -1),
      delvar,
      substitudeMacros: substituteMacros,
      substituteMacros,
    });
    Object.defineProperty(context, "variables", { enumerable: true, get: mergedVariables });

    const ejsTemplate = {
      async evalTemplate(source, extraContext = {}) {
        const nested = Object.assign(Object.create(context), clone(extraContext || {}));
        Object.defineProperty(nested, "variables", { enumerable: true, get: mergedVariables });
        return await window.ejs.render(String(source), nested, {
          async: true,
          outputFunctionName: "print",
          filename: String(payload.path || "preview-template.ejs"),
          compileDebug: true,
        });
      },
      async prepareContext(extraContext = {}) {
        return Object.assign({}, context, clone(extraContext || {}), { variables: mergedVariables() });
      },
      allVariables: mergedVariables,
      async saveVariables() {},
      getFeatures() { return { enabled: true, render_enabled: true, generate_enabled: true }; },
      defines: {},
      initialVariables: {},
    };
    context.EjsTemplate = ejsTemplate;
    return { context, variablesByScope };
  }

  function includeRequested(source) {
    return /<%(?![#%])(?:(?!%>)[\s\S])*?\binclude\s*(?:\(|\S)/.test(source);
  }

  function errorDetails(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lineMatch = /(?:^|\n)[^\n]*?:(\d+)\n/.exec(message);
    return {
      name: error instanceof Error ? error.name : "Error",
      message,
      stack: error instanceof Error ? error.stack : undefined,
      ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
    };
  }

  async function evaluate(payload) {
    if (!payload || typeof payload.source !== "string") throw new TypeError("Template source must be a string");
    if (!window.ejs || typeof window.ejs.render !== "function") throw new Error("EJS 3.1.10 failed to load in the template frame");
    if (includeRequested(payload.source)) {
      const error = new Error("EJS include is not supported in Preset Studio preview (EJS-1)");
      error.name = "PreviewTemplateUnsupportedError";
      throw error;
    }
    const { context, variablesByScope } = buildContext(payload);
    const output = await window.ejs.render(payload.source, context, {
      async: true,
      outputFunctionName: "print",
      filename: String(payload.path || "preview-template.ejs"),
      compileDebug: true,
    });
    return { output: String(output), variables: clone(variablesByScope) };
  }

  addEventListener("message", (event) => {
    if (event.source !== window.parent || !event.data || event.data.type !== "template:connect") return;
    const port = event.ports[0];
    if (!port || channelPort) return;
    channelPort = port;
    channelPort.onmessage = async (portEvent) => {
      const request = portEvent.data;
      if (!request || request.type !== "template:evaluate" || typeof request.requestId !== "string") return;
      try {
        const result = await evaluate(request.payload);
        send("template:result", { requestId: request.requestId, payload: result });
      } catch (error) {
        send("template:error", { requestId: request.requestId, payload: errorDetails(error) });
      }
    };
    channelPort.start();
    send("template:connected");
  });

  window.parent.postMessage({ type: "template:ready" }, "*");
})();
`;
