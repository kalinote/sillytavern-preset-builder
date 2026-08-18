import { useCallback, useEffect, useRef, useState } from "react";

import {
  projectApi,
  type JsonValue,
  type PreviewRuntimeManifest,
  type Project,
  type ProjectApi,
  type ProjectFile,
  type ProjectStructure,
} from "../lib/project-api";
import { PreviewRuntimeController, type PreviewFramePresentation } from "./preview-runtime-controller";
import {
  PREVIEW_LIMITS,
  isRecord,
  utf8Bytes,
  type PreviewCapabilityUsage,
  type PreviewContextState,
  type PreviewGenerationState,
  type PreviewRuntimeEvent,
  type PreviewRuntimeLogEntry,
  type PreviewRuntimeStatus,
  type PreviewScriptRuntimeState,
  type PreviewTemplatePhase,
  type PreviewTemplateState,
} from "./protocol";
import {
  runRegexPreview,
  type RegexPreviewResult,
  type RegexPreviewRule,
} from "./regex-preview-pipeline";
import { transferProjectScript } from "./script-transfer";

const HTML_REFRESH_DEBOUNCE_MS = 500;

export interface UseProjectPreviewRuntimeOptions {
  api?: ProjectApi;
  project: Project | null;
  structure: ProjectStructure | null;
  activeFile: ProjectFile | null;
  content: string;
  saveState: "saved" | "saving" | "dirty" | "error";
  previewOrigin?: string;
}

export interface ProjectPreviewRuntime {
  status: PreviewRuntimeStatus;
  statusMessage?: string;
  manifest?: PreviewRuntimeManifest;
  scripts: PreviewScriptRuntimeState[];
  logs: PreviewRuntimeLogEntry[];
  capabilities: PreviewCapabilityUsage[];
  context: PreviewContextState;
  regexMode: "current" | "project";
  includeDisabledRegex: boolean;
  regexResult?: RegexPreviewResult;
  regexBusy: boolean;
  templateEnabled: boolean;
  templatePhase: PreviewTemplatePhase;
  templateState?: PreviewTemplateState;
  generationState?: PreviewGenerationState;
  generationBusy: boolean;
  largeScriptWarning: boolean;
  start: () => Promise<void>;
  stop: (clearDiagnostics?: boolean) => Promise<void>;
  restart: () => Promise<void>;
  refreshMessage: () => Promise<void>;
  simulateGeneration: () => Promise<void>;
  attach: (container: HTMLElement, presentation: PreviewFramePresentation) => void;
  detach: (container: HTMLElement) => void;
  setPresentation: (presentation: PreviewFramePresentation) => void;
  clearLogs: () => void;
  clearSiteStorage: () => Promise<void>;
  updateContext: (update: Partial<PreviewContextState>) => void;
  updateSampleText: (value: string) => void;
  setMockGeneration: (value: string | undefined) => void;
  resetContext: () => void;
  setRegexMode: (mode: "current" | "project") => void;
  setIncludeDisabledRegex: (enabled: boolean) => void;
  setTemplateEnabled: (enabled: boolean) => void;
  setTemplatePhase: (phase: PreviewTemplatePhase) => void;
}

interface LatestRuntimeInput {
  project: Project | null;
  structure: ProjectStructure | null;
  activeFile: ProjectFile | null;
  content: string;
  saveState: UseProjectPreviewRuntimeOptions["saveState"];
  previewOrigin?: string;
  context: PreviewContextState;
  regexMode: "current" | "project";
  includeDisabledRegex: boolean;
  templateEnabled: boolean;
  templatePhase: PreviewTemplatePhase;
}

function defaultContext(): PreviewContextState {
  return {
    user: "User",
    char: "Character",
    role: "assistant",
    mesId: 0,
    variables: { global: {}, chat: {}, message: {} },
    messages: [{
      message_id: 0,
      role: "assistant",
      message: "",
      name: "Character",
      is_user: false,
      is_system: false,
    }],
  };
}

function logValue(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function parseRegexPath(path: string): { uid: string; filename: string } | undefined {
  const match = /^regex\/([^/]+)\/(find\.txt|replace\.html|meta\.json)$/.exec(path);
  return match ? { uid: match[1] as string, filename: match[2] as string } : undefined;
}

function isHtmlPath(path: string): boolean {
  return path.toLowerCase().endsWith(".html");
}

function isPromptContentPath(path: string): boolean {
  return /^prompts\/[^/]+\/content\.md$/i.test(path);
}

function jsonObject(value: unknown): Record<string, JsonValue> {
  return isRecord(value) ? value as Record<string, JsonValue> : {};
}

function presetRegexScripts(preset: JsonValue): JsonValue[] {
  if (!isRecord(preset) || !isRecord(preset.extensions) || !Array.isArray(preset.extensions.regex_scripts)) return [];
  return preset.extensions.regex_scripts as JsonValue[];
}

export function useProjectPreviewRuntime({
  api = projectApi,
  project,
  structure,
  activeFile,
  content,
  saveState,
  previewOrigin,
}: UseProjectPreviewRuntimeOptions): ProjectPreviewRuntime {
  const [status, setStatus] = useState<PreviewRuntimeStatus>(
    project?.preview.javascriptEnabled ? "stopped" : "disabled",
  );
  const [statusMessage, setStatusMessage] = useState<string>();
  const [manifest, setManifest] = useState<PreviewRuntimeManifest>();
  const [scripts, setScripts] = useState<PreviewScriptRuntimeState[]>([]);
  const [logs, setLogs] = useState<PreviewRuntimeLogEntry[]>([]);
  const [capabilities, setCapabilities] = useState<PreviewCapabilityUsage[]>([]);
  const [context, setContext] = useState<PreviewContextState>(defaultContext);
  const [regexMode, setRegexModeState] = useState<"current" | "project">("current");
  const [includeDisabledRegex, setIncludeDisabledRegexState] = useState(true);
  const [regexResult, setRegexResult] = useState<RegexPreviewResult>();
  const [regexBusy, setRegexBusy] = useState(false);
  const [templateEnabled, setTemplateEnabledState] = useState(true);
  const [templatePhase, setTemplatePhaseState] = useState<PreviewTemplatePhase>("render");
  const [templateState, setTemplateState] = useState<PreviewTemplateState>();
  const [generationState, setGenerationState] = useState<PreviewGenerationState>();
  const [generationBusy, setGenerationBusy] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);
  const controllerRef = useRef<PreviewRuntimeController | undefined>(undefined);
  const sessionRef = useRef(0);
  const logIdRef = useRef(0);
  const mountRef = useRef<HTMLElement | undefined>(undefined);
  const presentationRef = useRef<PreviewFramePresentation>({ width: 1280, height: 720, scale: 1 });
  const manifestRef = useRef<PreviewRuntimeManifest | undefined>(undefined);
  const statusRef = useRef<PreviewRuntimeStatus>(status);
  const startedStructureRevisionRef = useRef<string | undefined>(undefined);
  const regexRuleCacheRef = useRef(new Map<string, Promise<RegexPreviewRule>>());
  const latestRef = useRef<LatestRuntimeInput>({
    project,
    structure,
    activeFile,
    content,
    saveState,
    previewOrigin,
    context,
    regexMode,
    includeDisabledRegex,
    templateEnabled,
    templatePhase,
  });

  statusRef.current = status;
  manifestRef.current = manifest;
  latestRef.current = {
    project,
    structure,
    activeFile,
    content,
    saveState,
    previewOrigin,
    context,
    regexMode,
    includeDisabledRegex,
    templateEnabled,
    templatePhase,
  };

  const appendLog = useCallback((entry: Omit<PreviewRuntimeLogEntry, "id">) => {
    logIdRef.current += 1;
    const next = { ...entry, id: logIdRef.current };
    setLogs((current) => [...current.slice(-(PREVIEW_LIMITS.logEntries - 1)), next]);
  }, []);

  const handleRuntimeEvent = useCallback((event: PreviewRuntimeEvent) => {
    if (event.type === "console") {
      const level = event.level === "debug" || event.level === "warn" || event.level === "error"
        ? event.level
        : "info";
      appendLog({
        timestamp: event.timestamp,
        level,
        frame: event.frame,
        values: event.values,
        message: event.values.map(logValue).join(" "),
        ...(event.truncated ? { truncated: true } : {}),
      });
      return;
    }
    if (event.type === "runtime-error") {
      appendLog({
        timestamp: event.timestamp,
        level: "error",
        frame: event.frame,
        message: event.message,
        values: event.error === undefined ? undefined : [event.error],
        ...(event.filename ? { filename: event.filename } : {}),
        ...(event.line ? { line: event.line } : {}),
        ...(event.column ? { column: event.column } : {}),
      });
      return;
    }
    if (event.type === "runtime-status") {
      const next = event.status === "loading-scripts" || event.status === "running" || event.status === "stopped" || event.status === "failed"
        ? event.status
        : event.status === "booting" ? "booting" : undefined;
      if (next) {
        statusRef.current = next;
        setStatus(next);
      }
      setStatusMessage(event.message);
      if (next === "failed") {
        sessionRef.current += 1;
        const controller = controllerRef.current;
        controllerRef.current = undefined;
        appendLog({
          timestamp: event.timestamp,
          level: "error",
          frame: { kind: "host", id: "preview-host", name: "Preview Host" },
          message: event.message ?? "Preview Host 已意外停止",
        });
        void controller?.dispose();
      }
      return;
    }
    if (event.type === "script-status") {
      setScripts((current) => {
        const found = current.some((script) => script.id === event.script.id);
        return found
          ? current.map((script) => script.id === event.script.id ? { ...script, ...event.script } : script)
          : [...current, event.script].sort((left, right) => left.index - right.index);
      });
      return;
    }
    if (event.type === "capability-used") {
      setCapabilities((current) => {
        const usage = event.usage;
        const key = `${usage.capability}:${usage.frame.id ?? usage.frame.kind}`;
        const found = current.find((item) => `${item.capability}:${item.frame.id ?? item.frame.kind}` === key);
        if (!found) return [...current, { ...usage, count: 1 }];
        return current.map((item) => item === found ? { ...item, count: item.count + 1 } : item);
      });
      return;
    }
    if (event.type === "template-status") {
      setTemplateState(event.template);
      return;
    }
    if (event.type === "generation-status") {
      setGenerationState(event.generation);
      setGenerationBusy(event.generation.status === "running");
      return;
    }
    if (event.type === "state-changed") setContext(event.context);
  }, [appendLog]);

  const loadRegexRule = useCallback(async (
    projectId: string,
    descriptor: PreviewRuntimeManifest["regexScripts"][number],
    cacheRevision: string,
    override?: { path: string; content: string },
  ): Promise<RegexPreviewRule> => {
    const cacheKey = `${projectId}:${cacheRevision}:${descriptor.uid}`;
    let pending = regexRuleCacheRef.current.get(cacheKey);
    if (!pending) {
      pending = Promise.all([
        api.getProjectFile(projectId, descriptor.findPath),
        api.getProjectFile(projectId, descriptor.replacePath),
        api.getProjectFile(projectId, descriptor.metaPath),
      ]).then(([find, replace, meta]) => ({
        ...descriptor,
        find: find.content,
        replace: replace.content,
        meta: jsonObject(JSON.parse(meta.content) as unknown),
      }));
      regexRuleCacheRef.current.set(cacheKey, pending);
    }
    const base = await pending;
    if (!override) return base;
    if (override.path === descriptor.findPath) return { ...base, find: override.content };
    if (override.path === descriptor.replacePath) return { ...base, replace: override.content };
    if (override.path === descriptor.metaPath) return { ...base, meta: jsonObject(JSON.parse(override.content) as unknown) };
    return base;
  }, [api]);

  const buildCurrentMessage = useCallback(async (
    runtimeManifest: PreviewRuntimeManifest,
  ): Promise<{ path: string; source: string; contentMode: "html" | "text" } | undefined> => {
    const latest = latestRef.current;
    const file = latest.activeFile;
    if (!file) return undefined;
    const regexPath = parseRegexPath(file.path);
    if (!regexPath) {
      if (!isHtmlPath(file.path) && !isPromptContentPath(file.path)) return undefined;
      setRegexResult(undefined);
      return {
        path: file.path,
        source: latest.content,
        contentMode: isPromptContentPath(file.path) ? "text" : "html",
      };
    }

    const current = runtimeManifest.regexScripts.find((rule) => rule.uid === regexPath.uid);
    if (!current) throw new Error("当前正则不在 runtime manifest 中");
    const descriptors = latest.regexMode === "project" ? runtimeManifest.regexScripts : [current];
    setRegexBusy(true);
    try {
      const rules = await Promise.all(descriptors.map((descriptor) => loadRegexRule(
        runtimeManifest.projectId,
        descriptor,
        latest.structure?.revision ?? runtimeManifest.projectUpdatedAt,
        { path: file.path, content: latest.content },
      )));
      const result = runRegexPreview({
        input: latest.context.messages[latest.context.mesId]?.message ?? "",
        rules,
        currentUid: current.uid,
        mode: latest.regexMode,
        includeDisabledCurrent: latest.includeDisabledRegex,
      });
      setRegexResult(result);
      return { path: current.replacePath, source: result.rawOutput, contentMode: "html" };
    } finally {
      setRegexBusy(false);
    }
  }, [loadRegexRule]);

  const renderCurrentWith = useCallback(async (
    controller: PreviewRuntimeController,
    runtimeManifest: PreviewRuntimeManifest,
  ) => {
    const message = await buildCurrentMessage(runtimeManifest);
    if (!message) return;
    const bytes = utf8Bytes(message.source);
    if (bytes > PREVIEW_LIMITS.htmlBytes) throw new Error("当前 HTML 超过 8 MiB 运行上限");
    await controller.request("message:render", {
      ...message,
      template: {
        enabled: latestRef.current.templateEnabled,
        phase: latestRef.current.templatePhase,
      },
    });
  }, [buildCurrentMessage]);

  const stop = useCallback(async (clearDiagnostics = false) => {
    sessionRef.current += 1;
    const controller = controllerRef.current;
    controllerRef.current = undefined;
    await controller?.dispose();
    manifestRef.current = undefined;
    setManifest(undefined);
    setScripts([]);
    setRegexResult(undefined);
    setTemplateState(undefined);
    setGenerationBusy(false);
    setStatusMessage(undefined);
    const enabled = latestRef.current.project?.preview.javascriptEnabled === true;
    statusRef.current = enabled ? "stopped" : "disabled";
    setStatus(enabled ? "stopped" : "disabled");
    if (clearDiagnostics) {
      setLogs([]);
      setCapabilities([]);
    }
  }, []);

  const start = useCallback(async () => {
    const latest = latestRef.current;
    if (!latest.project?.preview.javascriptEnabled) throw new Error("当前项目未允许 JavaScript 预览");
    if (!latest.previewOrigin) throw new Error("服务端尚未配置独立 Preview Host");
    if (controllerRef.current) return;
    const session = sessionRef.current + 1;
    sessionRef.current = session;
    statusRef.current = "booting";
    setStatus("booting");
    setStatusMessage(undefined);
    setScripts([]);
    setCapabilities([]);
    setTemplateState(undefined);
    setGenerationState(undefined);
    setGenerationBusy(false);

    let controller: PreviewRuntimeController | undefined;
    try {
      controller = new PreviewRuntimeController(latest.previewOrigin);
      controllerRef.current = controller;
      controller.subscribe(handleRuntimeEvent);
      if (mountRef.current) controller.attach(mountRef.current, presentationRef.current);
      await controller.connect();
      if (session !== sessionRef.current) return;
      statusRef.current = "loading-scripts";
      setStatus("loading-scripts");

      const [runtimeManifest, sourceFile] = await Promise.all([
        api.getPreviewRuntimeManifest(latest.project.id),
        api.getProjectFile(latest.project.id, "preset.json"),
      ]);
      if (!runtimeManifest.javascriptEnabled) throw new Error("项目设置已关闭 JavaScript 预览");
      const preset = JSON.parse(sourceFile.content) as JsonValue;
      manifestRef.current = runtimeManifest;
      setManifest(runtimeManifest);
      setScripts(runtimeManifest.scripts
        .filter((script) => script.enabled && script.executable)
        .map((script) => ({
          id: script.id,
          name: script.name,
          path: script.path,
          index: script.index,
          status: "pending",
          byteLength: script.byteLength,
          transferredBytes: 0,
        })));
      await controller.request("runtime:configure", {
        projectId: runtimeManifest.projectId,
        projectName: latest.project.name,
        preset,
        regexScripts: presetRegexScripts(preset),
        context: latest.context,
        templateEnabled: latest.templateEnabled,
      });

      for (const script of runtimeManifest.scripts
        .filter((item) => item.enabled && item.executable)
        .sort((left, right) => left.index - right.index)) {
        if (session !== sessionRef.current) return;
        try {
          if (script.byteLength > PREVIEW_LIMITS.scriptBytes) {
            throw new Error(`${script.name} 超过 16 MiB 单脚本上限`);
          }
          const file = await api.getProjectFile(runtimeManifest.projectId, script.path);
          if (file.size !== script.byteLength || (file.revision && file.revision !== script.contentHash)) {
            throw new Error(`${script.name} 在启动过程中发生变化，请重启预览`);
          }
          if (script.byteLength >= PREVIEW_LIMITS.scriptChunkThresholdBytes) {
            const transfer = await transferProjectScript(
              controller,
              script,
              file.content,
              () => session !== sessionRef.current,
            );
            appendLog({
              timestamp: Date.now(),
              level: "info",
              frame: { kind: "project-script", id: script.id, name: script.name, path: script.path },
              message: `分 ${transfer.chunkCount} 块传输 ${transfer.transferredBytes} 字节，耗时 ${transfer.durationMs.toFixed(1)} ms`,
            });
          } else {
            await controller.request("script:load", { script, source: file.content });
          }
        } catch (error) {
          if (session !== sessionRef.current) return;
          const message = error instanceof Error ? error.message : String(error);
          setScripts((current) => current.map((item) => item.id === script.id
            ? { ...item, status: "error", message }
            : item));
          appendLog({
            timestamp: Date.now(),
            level: "error",
            frame: { kind: "project-script", id: script.id, name: script.name, path: script.path },
            message,
          });
        }
      }
      if (session !== sessionRef.current) return;
      await controller.request("runtime:start-scripts");
      startedStructureRevisionRef.current = latest.structure?.revision;
      statusRef.current = "running";
      setStatus("running");
      try {
        await renderCurrentWith(controller, runtimeManifest);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`项目脚本仍在运行，但消息预览失败：${message}`);
        appendLog({
          timestamp: Date.now(),
          level: "error",
          frame: { kind: "host", id: "preview-host", name: "Preview Host" },
          message,
        });
      }
    } catch (error) {
      if (session !== sessionRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      statusRef.current = "failed";
      setStatus("failed");
      setStatusMessage(message);
      await controller?.dispose();
      if (controllerRef.current === controller) controllerRef.current = undefined;
      throw error;
    }
  }, [api, appendLog, handleRuntimeEvent, renderCurrentWith]);

  const restart = useCallback(async () => {
    await stop(false);
    await start();
  }, [start, stop]);

  const clearSiteStorage = useCallback(async () => {
    const latest = latestRef.current;
    if (!latest.previewOrigin) throw new Error("服务端尚未配置独立 Preview Host");
    const shouldRestart = controllerRef.current !== undefined;
    await stop(false);
    const controller = new PreviewRuntimeController(latest.previewOrigin);
    try {
      await controller.request("storage:clear");
      setStatusMessage("Preview Origin 站点存储已清空");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      await controller.dispose();
    }
    if (shouldRestart && latestRef.current.project?.preview.javascriptEnabled) await start();
  }, [start, stop]);

  const refreshMessage = useCallback(async () => {
    const controller = controllerRef.current;
    const runtimeManifest = manifestRef.current;
    if (!controller || !runtimeManifest) return;
    await renderCurrentWith(controller, runtimeManifest);
  }, [renderCurrentWith]);

  const simulateGeneration = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) throw new Error("请先启动动态预览");
    setGenerationBusy(true);
    try {
      await controller.request("generation:simulate", {
        templateEnabled: latestRef.current.templateEnabled,
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setGenerationBusy(false);
    }
  }, []);

  const attach = useCallback((container: HTMLElement, presentation: PreviewFramePresentation) => {
    mountRef.current = container;
    presentationRef.current = presentation;
    controllerRef.current?.attach(container, presentation);
  }, []);

  const detach = useCallback((container: HTMLElement) => {
    if (mountRef.current === container) mountRef.current = undefined;
    controllerRef.current?.park(container);
  }, []);

  const setPresentation = useCallback((presentation: PreviewFramePresentation) => {
    presentationRef.current = presentation;
    controllerRef.current?.setPresentation(presentation);
  }, []);

  const updateContext = useCallback((update: Partial<PreviewContextState>) => {
    setContextRevision((current) => current + 1);
    setContext((current) => {
      const next = { ...current, ...update };
      void controllerRef.current?.request("state:update", update).catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : String(error));
      });
      return next;
    });
  }, []);

  const updateSampleText = useCallback((value: string) => {
    setContextRevision((current) => current + 1);
    setContext((current) => {
      const messages = current.messages.length > 0 ? [...current.messages] : defaultContext().messages;
      const id = Math.min(Math.max(current.mesId, 0), messages.length - 1);
      messages[id] = { ...messages[id]!, message: value };
      const next = { ...current, mesId: id, messages };
      void controllerRef.current?.request("state:update", { messages, mesId: id }).catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : String(error));
      });
      return next;
    });
  }, []);

  const setMockGeneration = useCallback((value: string | undefined) => {
    setContextRevision((current) => current + 1);
    setContext((current) => {
      const next = { ...current, ...(value === undefined ? {} : { mockGeneration: value }) };
      if (value === undefined) delete next.mockGeneration;
      void controllerRef.current?.request("state:update", { mockGeneration: value ?? null }).catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : String(error));
      });
      return next;
    });
  }, []);

  const resetContext = useCallback(() => {
    const next = defaultContext();
    setContextRevision((current) => current + 1);
    setContext(next);
    void controllerRef.current?.request("state:update", { ...next, mockGeneration: null }).catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);

  const setRegexMode = useCallback((mode: "current" | "project") => setRegexModeState(mode), []);
  const setIncludeDisabledRegex = useCallback((enabled: boolean) => setIncludeDisabledRegexState(enabled), []);
  const setTemplateEnabled = useCallback((enabled: boolean) => {
    setTemplateEnabledState(enabled);
    setContextRevision((current) => current + 1);
    void controllerRef.current?.request("state:update", { templateEnabled: enabled }).catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);
  const setTemplatePhase = useCallback((phase: PreviewTemplatePhase) => {
    setTemplatePhaseState(phase);
    setContextRevision((current) => current + 1);
  }, []);
  const clearLogs = useCallback(() => setLogs([]), []);

  useEffect(() => {
    const enabled = project?.preview.javascriptEnabled === true;
    if (!enabled && controllerRef.current) void stop(true);
    else if (!enabled) {
      statusRef.current = "disabled";
      setStatus("disabled");
    } else if (statusRef.current === "disabled") {
      statusRef.current = "stopped";
      setStatus("stopped");
    }
  }, [project?.preview.javascriptEnabled, stop]);

  useEffect(() => {
    void stop(true);
  }, [project?.id, previewOrigin, stop]);

  useEffect(() => {
    const projectId = project?.id;
    if (!projectId || project.preview.javascriptEnabled !== true) return;
    let cancelled = false;
    void api.getPreviewRuntimeManifest(projectId).then((nextManifest) => {
      if (cancelled || latestRef.current.project?.id !== projectId || controllerRef.current) return;
      manifestRef.current = nextManifest;
      setManifest(nextManifest);
    }).catch((error) => {
      if (!cancelled) setStatusMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [api, project?.id, project?.preview.javascriptEnabled]);

  useEffect(() => () => {
    sessionRef.current += 1;
    void controllerRef.current?.dispose();
    controllerRef.current = undefined;
  }, []);

  useEffect(() => {
    if (!controllerRef.current || (statusRef.current !== "running" && statusRef.current !== "dirty")) return;
    if (activeFile?.path.startsWith("scripts/") && activeFile.path.endsWith("/content.js")) {
      const expected = manifestRef.current?.scripts.find((script) => script.path === activeFile.path);
      if (saveState !== "saved" || (activeFile.revision && expected && activeFile.revision !== expected.contentHash)) {
        statusRef.current = "dirty";
        setStatus("dirty");
        setStatusMessage("项目脚本已修改，需要重启后才会执行新源码。");
      }
      return;
    }
    const currentStructureRevision = structure?.revision;
    if (
      startedStructureRevisionRef.current
      && currentStructureRevision
      && currentStructureRevision !== startedStructureRevisionRef.current
      && structure?.scripts.length
    ) {
      statusRef.current = "dirty";
      setStatus("dirty");
      setStatusMessage("脚本启用状态或项目结构可能已变化，需要重启。");
    }
    const previewable = Boolean(activeFile && (
      isHtmlPath(activeFile.path)
      || isPromptContentPath(activeFile.path)
      || parseRegexPath(activeFile.path)
    ));
    if (!previewable) return;
    const timer = window.setTimeout(() => {
      void refreshMessage().catch((error) => setStatusMessage(error instanceof Error ? error.message : String(error)));
    }, HTML_REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeFile?.path, activeFile?.revision, content, contextRevision, refreshMessage, saveState, structure?.revision, structure?.scripts.length]);

  useEffect(() => {
    if (activeFile && parseRegexPath(activeFile.path)) regexRuleCacheRef.current.clear();
  }, [activeFile?.revision]);

  return {
    status,
    ...(statusMessage ? { statusMessage } : {}),
    ...(manifest ? { manifest } : {}),
    scripts,
    logs,
    capabilities,
    context,
    regexMode,
    includeDisabledRegex,
    ...(regexResult ? { regexResult } : {}),
    regexBusy,
    templateEnabled,
    templatePhase,
    ...(templateState ? { templateState } : {}),
    ...(generationState ? { generationState } : {}),
    generationBusy,
    largeScriptWarning: (manifest?.totalEnabledScriptBytes ?? 0) > 2 * 1024 * 1024,
    start,
    stop,
    restart,
    refreshMessage,
    simulateGeneration,
    attach,
    detach,
    setPresentation,
    clearLogs,
    clearSiteStorage,
    updateContext,
    updateSampleText,
    setMockGeneration,
    resetContext,
    setRegexMode,
    setIncludeDisabledRegex,
    setTemplateEnabled,
    setTemplatePhase,
  };
}
