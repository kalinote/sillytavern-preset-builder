import {
  CheckCircle2,
  Code2,
  Eye,
  FileText,
  Focus,
  Globe2,
  Hand,
  Info,
  ListChecks,
  Bug,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  Play,
  RotateCcw,
  ShieldOff,
  Square,
  Smartphone,
  Tablet,
  ZoomIn,
  ZoomOut,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { ProjectDiagnostic, ProjectStructure, RegexMirrorBinding, StructureMutation } from "../../lib/project-api";
import type { ProjectPreviewRuntime } from "../../preview/use-project-preview-runtime";
import type { SaveState } from "./workspace-editor-pane";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ItemPropertiesPanel } from "./item-properties-panel";
import { WorkspaceDiagnostics } from "./workspace-diagnostics";

interface WorkspaceInspectorProps {
  path: string;
  content: string;
  size: number;
  lineCount: number;
  revision?: string | null;
  saveState: SaveState;
  saveMode: "auto" | "explicit";
  backendOnline: boolean;
  className?: string;
  initialTab?: "file" | "item" | "diagnostics" | "preview";
  structure?: ProjectStructure | null;
  structureBusy?: boolean;
  diagnostics?: ProjectDiagnostic[];
  diagnosticsStale?: boolean;
  validationBusy?: boolean;
  onMutateStructure?: (mutation: StructureMutation) => void;
  onValidate?: () => void;
  onOpenPath?: (path: string) => void;
  javascriptEnabled?: boolean;
  javascriptSettingsBusy?: boolean;
  previewOrigin?: string;
  previewRuntime?: ProjectPreviewRuntime;
  regexMirrorBinding?: RegexMirrorBinding;
  onJavascriptEnabledChange?: (enabled: boolean) => void;
}

export function WorkspaceInspector({
  path,
  content,
  size,
  lineCount,
  revision,
  saveState,
  saveMode,
  backendOnline,
  className,
  initialTab = "file",
  structure,
  structureBusy,
  diagnostics = [],
  diagnosticsStale,
  validationBusy,
  onMutateStructure,
  onValidate,
  onOpenPath,
  javascriptEnabled = false,
  javascriptSettingsBusy,
  previewOrigin,
  previewRuntime,
  regexMirrorBinding,
  onJavascriptEnabledChange,
}: WorkspaceInspectorProps) {
  const hasItem = Boolean(structure && /^(prompts|regex|scripts)\/[^/]+\//.test(path));
  return (
    <aside
      className={cn(
        "flex h-full w-full shrink-0 flex-col border-l border-border bg-surface",
        className,
      )}
    >
      <Tabs defaultValue={initialTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="file" className="whitespace-nowrap px-2">
              <FileText className="size-3.5" />
              文件
            </TabsTrigger>
            <TabsTrigger value="item" disabled={!hasItem} className="whitespace-nowrap px-2">
              <ListChecks className="size-3.5" />
              条目
            </TabsTrigger>
            <TabsTrigger value="diagnostics" className="whitespace-nowrap px-2">
              <Bug className="size-3.5" />
              诊断
            </TabsTrigger>
            <TabsTrigger value="preview" className="whitespace-nowrap px-2">
              <Eye className="size-3.5" />
              预览
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="file" className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-border">
            <InspectorSection title="工程文件">
              <Fact label="路径" value={path} mono />
              <Fact label="大小" value={formatBytes(Math.max(size, content.length))} />
              <Fact label="行数" value={lineCount.toLocaleString()} />
              <Fact label="Revision" value={revision?.slice(0, 12) ?? "尚未保存"} mono />
            </InspectorSection>

            <InspectorSection title="持久化状态">
              <div className="flex items-center justify-between rounded-xl border border-border bg-muted/35 p-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg bg-surface shadow-xs",
                      saveState === "error" ? "text-destructive" : "text-success",
                    )}
                  >
                    {saveState === "error" ? (
                      <RefreshCw className="size-4" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                  </span>
                  <div>
                    <p className="text-xs font-medium">{saveLabel(saveState, saveMode)}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {saveMode === "explicit"
                        ? "显式应用 · Ctrl/Cmd+S 重新拆分"
                        : "850ms 防抖 · 切换与失焦强制写盘"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Node 工程服务</span>
                <Badge variant={backendOnline ? "green" : "red"}>
                  {backendOnline ? "在线" : "离线"}
                </Badge>
              </div>
            </InspectorSection>

            <InspectorSection title="边界说明">
              <div className="flex items-start gap-2 rounded-xl border border-primary/15 bg-primary-soft/45 p-3">
                <Info className="mt-0.5 size-4 shrink-0 text-primary" />
                <p className="text-[11px] leading-5 text-muted-foreground">
                  {saveMode === "explicit"
                    ? "完整 JSON 草稿只保留在浏览器中；应用后会校验并重新拆分当前工程。"
                    : "自动保存只更新拆分工程文件；不会导出 JSON、推送或修改 SillyTavern。"}
                </p>
              </div>
            </InspectorSection>
          </div>
        </TabsContent>

        <TabsContent value="item" className="min-h-0 flex-1 overflow-y-auto">
          {structure && onMutateStructure ? (
            <ItemPropertiesPanel path={path} structure={structure} busy={structureBusy} onApply={onMutateStructure} />
          ) : null}
        </TabsContent>

        <TabsContent value="diagnostics" className="min-h-0 flex-1 overflow-y-auto">
          <WorkspaceDiagnostics
            diagnostics={diagnostics}
            stale={diagnosticsStale}
            busy={validationBusy}
            onValidate={onValidate}
            onOpenPath={onOpenPath}
          />
        </TabsContent>

        <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto p-3">
          <StaticFilePreview
            path={path}
            content={content}
            javascriptEnabled={javascriptEnabled}
            javascriptSettingsBusy={javascriptSettingsBusy}
            previewOrigin={previewOrigin}
            previewRuntime={previewRuntime}
            regexMirrorBinding={regexMirrorBinding}
            onJavascriptEnabledChange={onJavascriptEnabledChange}
            onOpenPath={onOpenPath}
          />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

const PREVIEW_DEBOUNCE_MS = 320;
const MIN_PREVIEW_SCALE = 0.2;
const MAX_PREVIEW_SCALE = 2;
const PREVIEW_SCALE_STEP = 0.1;
const PREVIEW_STAGE_PADDING = 24;

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
  "style-src 'unsafe-inline' http: https: data: blob:",
  "img-src http: https: data: blob:",
  "font-src http: https: data: blob:",
].join("; ");

interface PreviewDevice {
  id: "desktop" | "tablet" | "mobile";
  label: string;
  width: number;
  height: number;
  icon: typeof Monitor;
}

interface PreviewZoomAnchor {
  clientX: number;
  clientY: number;
  canvasX: number;
  canvasY: number;
}

interface PreviewPointerPosition {
  x: number;
  y: number;
}

const PREVIEW_DEVICES: readonly PreviewDevice[] = [
  { id: "desktop", label: "桌面", width: 1280, height: 720, icon: Monitor },
  { id: "tablet", label: "平板", width: 768, height: 1024, icon: Tablet },
  { id: "mobile", label: "手机", width: 390, height: 844, icon: Smartphone },
];

function StaticFilePreview({
  path,
  content,
  javascriptEnabled,
  javascriptSettingsBusy,
  previewOrigin,
  previewRuntime,
  regexMirrorBinding,
  onJavascriptEnabledChange,
  onOpenPath,
}: {
  path: string;
  content: string;
  javascriptEnabled: boolean;
  javascriptSettingsBusy?: boolean;
  previewOrigin?: string;
  previewRuntime?: ProjectPreviewRuntime;
  regexMirrorBinding?: RegexMirrorBinding;
  onJavascriptEnabledChange?: (enabled: boolean) => void;
  onOpenPath?: (path: string) => void;
}) {
  const [deviceId, setDeviceId] = useState<PreviewDevice["id"]>("desktop");
  const [fitToContainer, setFitToContainer] = useState(true);
  const [manualScale, setManualScale] = useState(0.75);
  const [panMode, setPanMode] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [logLevel, setLogLevel] = useState<"all" | "debug" | "info" | "warn" | "error">("all");
  const [variablesDraft, setVariablesDraft] = useState("{}");
  const [contextError, setContextError] = useState<string>();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const runtimeMountRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(manualScale);
  const zoomAnchorRef = useRef<PreviewZoomAnchor | null>(null);
  const recenterCanvasRef = useRef(true);
  const activePointersRef = useRef(new Map<number, PreviewPointerPosition>());
  const panStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null);
  const stageWidth = useObservedWidth(stageRef);
  const previewContent = useDebouncedValue(content, PREVIEW_DEBOUNCE_MS);
  const extension = path.split(".").at(-1)?.toLowerCase();
  const regexPath = /^regex\/([^/]+)\/(find\.txt|replace\.html|meta\.json)$/.exec(path);
  const isPromptTemplateSource = /^prompts\/[^/]+\/content\.md$/i.test(path);
  const canRenderStatic = extension === "html" || extension === "css";
  const isPreviewPending = content !== previewContent;
  const dynamicSource = useMemo(() => unwrapCodeFence(previewContent), [previewContent]);
  const dynamicSourceTooLarge = useMemo(
    () => extension === "html" && new Blob([dynamicSource]).size > 8 * 1024 * 1024,
    [dynamicSource, extension],
  );
  const runtimeConfiguration = useMemo(() => {
    if (!previewOrigin) return { error: "服务端尚未配置独立 Preview Host。" };
    try {
      const origin = new URL(previewOrigin).origin;
      if (typeof window !== "undefined" && origin === window.location.origin) {
        return { error: "Preview Host 与 Studio 同源，已拒绝执行用户脚本。" };
      }
      return { origin };
    } catch {
      return { error: "Preview Host 地址无效。" };
    }
  }, [previewOrigin]);
  const runtimeStatus = previewRuntime?.status ?? (javascriptEnabled ? "stopped" : "disabled");
  const runtimeActive = runtimeStatus === "booting"
    || runtimeStatus === "loading-scripts"
    || runtimeStatus === "running"
    || runtimeStatus === "dirty";
  const selectedDevice =
    PREVIEW_DEVICES.find((device) => device.id === deviceId) ?? PREVIEW_DEVICES[0];
  const fitScale = stageWidth
    ? clamp(
      (stageWidth - PREVIEW_STAGE_PADDING * 2) / selectedDevice.width,
      MIN_PREVIEW_SCALE,
      1,
    )
    : MIN_PREVIEW_SCALE;
  const renderedScale = fitToContainer ? fitScale : manualScale;
  const srcDoc = useMemo(() => {
    if (!canRenderStatic) return "";
    const source = unwrapCodeFence(previewContent);
    return extension === "css" ? buildCssPreviewDocument(source) : buildHtmlPreviewDocument(source);
  }, [canRenderStatic, extension, previewContent]);
  const filteredLogs = useMemo(
    () => (previewRuntime?.logs ?? []).filter((entry) => logLevel === "all" || entry.level === logLevel),
    [logLevel, previewRuntime?.logs],
  );
  const pipelineBusy = previewRuntime?.regexBusy === true
    || previewRuntime?.templateState?.status === "evaluating"
    || previewRuntime?.generationBusy === true;

  useEffect(() => {
    setVariablesDraft(JSON.stringify(previewRuntime?.context.variables ?? {}, null, 2));
  }, [previewRuntime?.context.variables]);

  useEffect(() => {
    if (!canvasExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      recenterCanvasRef.current = true;
      setCanvasExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [canvasExpanded]);

  useLayoutEffect(() => {
    scaleRef.current = renderedScale;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const anchor = zoomAnchorRef.current;
    if (anchor) {
      const canvasRect = canvas.getBoundingClientRect();
      stage.scrollLeft += canvasRect.left + anchor.canvasX * renderedScale - anchor.clientX;
      stage.scrollTop += canvasRect.top + anchor.canvasY * renderedScale - anchor.clientY;
      zoomAnchorRef.current = null;
      return;
    }

    if (fitToContainer || recenterCanvasRef.current) {
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
      recenterCanvasRef.current = false;
    }
  }, [canvasExpanded, deviceId, fitToContainer, renderedScale, stageWidth]);

  useEffect(() => {
    const mount = runtimeMountRef.current;
    if (!mount || !runtimeActive || !previewRuntime) return;
    previewRuntime.attach(mount, {
      width: selectedDevice.width,
      height: selectedDevice.height,
      scale: renderedScale,
    });
    return () => previewRuntime.detach(mount);
  }, [previewRuntime?.attach, previewRuntime?.detach, runtimeActive]);

  useEffect(() => {
    previewRuntime?.setPresentation({
      width: selectedDevice.width,
      height: selectedDevice.height,
      scale: renderedScale,
    });
  }, [previewRuntime?.setPresentation, renderedScale, selectedDevice.height, selectedDevice.width]);

  function startRuntime() {
    if (!javascriptEnabled || !runtimeConfiguration.origin || !previewRuntime) return;
    void previewRuntime.start().catch(() => undefined);
  }

  function stopRuntime() {
    void previewRuntime?.stop(false);
  }

  function restartRuntime() {
    void previewRuntime?.restart().catch(() => undefined);
  }

  function clearPreviewStorage() {
    if (
      !previewRuntime
      || !window.confirm("确定清空 Preview Origin 的 localStorage、sessionStorage、IndexedDB 和 Cache Storage 吗？运行中的预览会先停止，并在清理后重新启动。")
    ) return;
    setStorageBusy(true);
    void previewRuntime.clearSiteStorage()
      .catch(() => undefined)
      .finally(() => setStorageBusy(false));
  }

  function zoomCanvasAt(nextScale: number, clientX: number, clientY: number) {
    const clampedScale = clamp(nextScale, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE);
    const canvas = canvasRef.current;
    const currentScale = scaleRef.current;
    if (Math.abs(clampedScale - currentScale) < 0.001) return;

    if (canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      zoomAnchorRef.current = {
        clientX,
        clientY,
        canvasX: (clientX - canvasRect.left) / currentScale,
        canvasY: (clientY - canvasRect.top) / currentScale,
      };
    }
    scaleRef.current = clampedScale;
    setManualScale(clampedScale);
    setFitToContainer(false);
  }

  function adjustScale(delta: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    zoomCanvasAt(
      scaleRef.current + delta,
      stageRect.left + stageRect.width / 2,
      stageRect.top + stageRect.height / 2,
    );
  }

  function fitCanvasToContainer() {
    zoomAnchorRef.current = null;
    recenterCanvasRef.current = true;
    setFitToContainer(true);
  }

  function toggleCanvasExpanded() {
    recenterCanvasRef.current = true;
    setCanvasExpanded((current) => !current);
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
    const nextScale = scaleRef.current * Math.exp(-event.deltaY * deltaMultiplier * 0.0015);
    zoomCanvasAt(nextScale, event.clientX, event.clientY);
  }

  function handlePanPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointersRef.current.size === 1) {
      panStartRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      setIsPanning(true);
      return;
    }

    if (activePointersRef.current.size === 2) {
      const [first, second] = Array.from(activePointersRef.current.values());
      pinchStartRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        scale: scaleRef.current,
      };
      panStartRef.current = null;
    }
  }

  function handlePanPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePointersRef.current.has(event.pointerId)) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointersRef.current.size >= 2) {
      const [first, second] = Array.from(activePointersRef.current.values());
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const pinchStart = pinchStartRef.current;
      if (!pinchStart || pinchStart.distance === 0) return;
      zoomCanvasAt(
        pinchStart.scale * (distance / pinchStart.distance),
        (first.x + second.x) / 2,
        (first.y + second.y) / 2,
      );
      return;
    }

    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== event.pointerId) return;
    stage.scrollLeft = panStart.scrollLeft - (event.clientX - panStart.clientX);
    stage.scrollTop = panStart.scrollTop - (event.clientY - panStart.clientY);
  }

  function finishPanPointer(event: ReactPointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(event.pointerId);
    pinchStartRef.current = null;
    const stage = stageRef.current;
    const [remaining] = Array.from(activePointersRef.current.entries());
    if (stage && remaining) {
      const [pointerId, position] = remaining;
      panStartRef.current = {
        pointerId,
        clientX: position.x,
        clientY: position.y,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      return;
    }
    panStartRef.current = null;
    setIsPanning(false);
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            {runtimeActive ? "隔离动态画布" : "隔离静态画布"}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {runtimeActive
              ? isPromptTemplateSource ? "Prompt Template 文本与项目 JavaScript" : "HTML 与用户 JavaScript"
              : "HTML/CSS 与无脚本原生控件"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {isPreviewPending ? <Badge variant="blue">等待刷新</Badge> : null}
          <Badge variant={runtimeStatus === "failed" ? "red" : runtimeStatus === "running" ? "green" : runtimeStatus === "dirty" ? "amber" : "blue"}>
            {runtimeStatus === "disabled" ? "脚本禁用"
              : runtimeStatus === "stopped" ? "允许脚本 · 未启动"
                : runtimeStatus === "booting" ? "正在连接 Preview Host"
                  : runtimeStatus === "loading-scripts" ? `正在启动项目脚本 ${previewRuntime?.scripts.filter((script) => script.status === "running" || script.status === "error").length ?? 0}/${previewRuntime?.scripts.length ?? 0}`
                    : runtimeStatus === "running" ? "脚本运行中"
                      : runtimeStatus === "dirty" ? "脚本已修改 · 需要重启"
                        : "运行失败"}
          </Badge>
        </div>
      </div>

      {regexMirrorBinding ? (
        <div
          className={cn(
            "mt-3 rounded-xl border p-2.5 text-[11px]",
            regexMirrorBinding.consistent
              ? "border-primary/20 bg-primary-soft/35"
              : "border-amber-300/70 bg-amber-50/70 text-amber-950",
          )}
          data-testid="regex-mirror-status"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">正则来源</span>
            <code className="rounded bg-surface/75 px-1.5 py-0.5 text-[10px]">
              {regexMirrorBinding.authority}
            </code>
            <Badge variant={regexMirrorBinding.consistent ? "green" : "amber"}>
              {regexMirrorBinding.consistent ? "镜像一致" : "镜像存在差异"}
            </Badge>
          </div>
          <p className="mt-1 leading-4 opacity-80">
            {regexMirrorBinding.consistent
              ? `编辑会同步回写 ${regexMirrorBinding.targets.length} 个已关联来源。`
              : "当前编辑只回写上述主来源；其他插件镜像保留原值。"}
          </p>
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-border bg-muted/25 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <Switch
              checked={javascriptEnabled}
              disabled={javascriptSettingsBusy || !onJavascriptEnabledChange}
              onCheckedChange={(checked) => {
                if (!checked) stopRuntime();
                onJavascriptEnabledChange?.(checked);
              }}
              aria-label="允许动态 JavaScript 预览"
            />
            <span className="text-[11px] font-medium">允许 JavaScript</span>
          </div>
          {!runtimeActive ? (
            <Button
              type="button"
              size="sm"
              disabled={!javascriptEnabled || !runtimeConfiguration.origin || !previewRuntime}
              onClick={startRuntime}
            >
              <Play />
              启动
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={restartRuntime}>
                <RotateCcw />
                重启
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={stopRuntime}>
                <Square />
                停止
              </Button>
            </>
          )}
          <Button
            type="button"
            variant={showLogs ? "subtle" : "ghost"}
            size="sm"
            onClick={() => setShowLogs((current) => !current)}
          >
            <Terminal />
            日志{previewRuntime && previewRuntime.logs.length > 0 ? ` ${previewRuntime.logs.length}` : ""}
          </Button>
          <Button
            type="button"
            variant={showContext ? "subtle" : "ghost"}
            size="sm"
            onClick={() => setShowContext((current) => !current)}
          >
            <FileText />
            上下文
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!javascriptEnabled || !runtimeConfiguration.origin || !previewRuntime || storageBusy}
            onClick={clearPreviewStorage}
            title="清空 Preview Origin 站点存储"
          >
            <Trash2 />
            {storageBusy ? "清理中" : "清空存储"}
          </Button>
        </div>
        {javascriptEnabled && runtimeConfiguration.error ? (
          <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-destructive">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />{runtimeConfiguration.error}
          </p>
        ) : null}
        {dynamicSourceTooLarge ? (
          <p className="mt-2 text-[10px] text-destructive">当前 HTML 超过第一版 8 MiB 运行上限。</p>
        ) : null}
        {previewRuntime?.largeScriptWarning ? (
          <p className="mt-2 text-[10px] text-amber-700">启用脚本总量超过 2 MiB；只会在启动或重启时重新加载。</p>
        ) : null}
        {previewRuntime?.statusMessage ? <p className="mt-2 text-[10px] text-destructive">{previewRuntime.statusMessage}</p> : null}
      </div>

      {showContext && previewRuntime ? (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/20 p-3 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-muted-foreground">用户名称</span><input className="h-8 w-full rounded-md border border-border bg-surface px-2" value={previewRuntime.context.user} onChange={(event) => previewRuntime.updateContext({ user: event.target.value })} /></label>
            <label className="space-y-1"><span className="text-muted-foreground">角色名称</span><input className="h-8 w-full rounded-md border border-border bg-surface px-2" value={previewRuntime.context.char} onChange={(event) => previewRuntime.updateContext({ char: event.target.value })} /></label>
          </div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">当前消息角色</span>
            <select className="h-8 w-full rounded-md border border-border bg-surface px-2" value={previewRuntime.context.role} onChange={(event) => previewRuntime.updateContext({ role: event.target.value as "system" | "user" | "assistant" })}>
              <option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">正则样本文本 / 当前消息</span>
            <textarea className="min-h-28 w-full resize-y rounded-md border border-border bg-surface p-2 font-mono text-[10px]" value={previewRuntime.context.messages[previewRuntime.context.mesId]?.message ?? ""} onChange={(event) => previewRuntime.updateSampleText(event.target.value)} placeholder="输入包含正则目标标签的样本文本" />
          </label>
          {regexPath ? (
            <div className="grid gap-2 rounded-lg border border-border bg-surface p-2 sm:grid-cols-2">
              <label className="space-y-1"><span className="text-muted-foreground">执行范围</span><select className="h-8 w-full rounded-md border border-border bg-surface px-2" value={previewRuntime.regexMode} onChange={(event) => previewRuntime.setRegexMode(event.target.value as "current" | "project")}><option value="current">仅当前规则</option><option value="project">按项目顺序</option></select></label>
              <label className="flex items-center gap-2 self-end pb-1"><Switch checked={previewRuntime.includeDisabledRegex} onCheckedChange={previewRuntime.setIncludeDisabledRegex} /><span>允许临时执行当前禁用规则</span></label>
            </div>
          ) : null}
          <div className="grid gap-2 rounded-lg border border-border bg-surface p-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 self-center">
              <Switch checked={previewRuntime.templateEnabled} onCheckedChange={previewRuntime.setTemplateEnabled} />
              <span>执行 Prompt Template / EJS</span>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground">模板场景</span>
              <select className="h-8 w-full rounded-md border border-border bg-surface px-2" value={previewRuntime.templatePhase} onChange={(event) => previewRuntime.setTemplatePhase(event.target.value as "render" | "generate")}>
                <option value="render">显示阶段（render）</option>
                <option value="generate">发送阶段（generate）</option>
              </select>
            </label>
            <p className="sm:col-span-2 text-[10px] text-muted-foreground">先执行当前选择的 Tavern 正则，再在独立的一次性 frame 中求值 EJS，最后创建消息 frame。</p>
          </div>
          <label className="block space-y-1">
            <span className="text-muted-foreground">模拟变量 JSON</span>
            <textarea className="min-h-24 w-full resize-y rounded-md border border-border bg-surface p-2 font-mono text-[10px]" value={variablesDraft} onChange={(event) => setVariablesDraft(event.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-muted-foreground">模拟生成结果（留空时 generate 为不支持能力）</span>
            <textarea
              className="min-h-20 w-full resize-y rounded-md border border-border bg-surface p-2 font-mono text-[10px]"
              value={previewRuntime.context.mockGeneration ?? ""}
              onChange={(event) => previewRuntime.setMockGeneration(event.target.value || undefined)}
              placeholder="为 generate / generateRaw 配置固定返回文本"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => {
              try {
                const parsed = JSON.parse(variablesDraft) as unknown;
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("变量必须是对象");
                previewRuntime.updateContext({ variables: parsed as typeof previewRuntime.context.variables });
                setContextError(undefined);
              } catch (error) {
                setContextError(error instanceof Error ? error.message : String(error));
              }
            }}>应用变量</Button>
            <Button type="button" size="sm" variant="secondary" onClick={previewRuntime.resetContext}>清空内存状态</Button>
            <Button type="button" size="sm" onClick={() => void previewRuntime.refreshMessage().catch(() => undefined)} disabled={!runtimeActive || pipelineBusy}>刷新消息预览</Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void previewRuntime.simulateGeneration().catch(() => undefined)}
              disabled={!runtimeActive || pipelineBusy}
            >
              <Play />
              模拟生成管线
            </Button>
            {pipelineBusy ? <span className="text-muted-foreground">正在执行预览管线…</span> : null}
          </div>
          {contextError ? <p className="text-destructive">{contextError}</p> : null}
          {previewRuntime.generationState ? (
            <div className="space-y-2 border-t border-border pt-2" data-testid="preview-generation-result">
              <p className={cn("font-medium", previewRuntime.generationState.status === "error" && "text-destructive")}>
                {previewRuntime.generationState.status === "running" ? "正在模拟生成管线"
                  : previewRuntime.generationState.status === "complete" ? "生成管线完成"
                    : "生成管线失败"}
              </p>
              <p className="text-muted-foreground">
                dry-run · {previewRuntime.generationState.initialMessages.length} → {previewRuntime.generationState.finalMessages.length} 条消息
                {previewRuntime.generationState.durationMs !== undefined ? ` · ${previewRuntime.generationState.durationMs.toFixed(1)} ms` : ""}
                {previewRuntime.generationState.templateEvaluationCount > 0 ? ` · EJS ${previewRuntime.generationState.templateEvaluationCount} 条` : ""}
              </p>
              <p className="break-all font-mono text-[9px] text-muted-foreground">
                {previewRuntime.generationState.eventSequence.join(" → ") || "等待事件阶段…"}
              </p>
              <p className="text-[10px] leading-4 text-amber-700">
                不会请求模型或写回聊天；事件监听器会真实执行，并包含发送前的 CHAT_COMPLETION_SETTINGS_READY 预演。
              </p>
              {previewRuntime.generationState.message ? <p className="text-destructive">{previewRuntime.generationState.message}</p> : null}
              {previewRuntime.generationState.truncated ? <p className="text-amber-700">结果快照过大或包含循环引用，面板中的副本已截断；脚本执行时使用的对象未截断。</p> : null}
              {previewRuntime.generationState.finalMessages.map((message, index) => {
                const output = generationContentText(message.content);
                return (
                  <details key={`${index}:${message.role}:${message.name ?? ""}`} className="rounded-md border border-border bg-surface p-2">
                    <summary className="cursor-pointer font-medium">{index + 1}. {message.role}{message.name ? ` · ${message.name}` : ""} · {output.length.toLocaleString()} 字符</summary>
                    <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[9px] text-muted-foreground">{output.slice(0, 8000)}{output.length > 8000 ? "\n… [仅显示前 8000 字符]" : ""}</pre>
                  </details>
                );
              })}
              <details className="rounded-md border border-border bg-surface p-2">
                <summary className="cursor-pointer font-medium">发送设置快照</summary>
                <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all text-[9px] text-muted-foreground">{JSON.stringify(previewRuntime.generationState.settings, null, 2).slice(0, 12000)}</pre>
              </details>
            </div>
          ) : null}
          {previewRuntime.templateState ? (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="font-medium">
                Prompt Template / EJS · {previewRuntime.templateState.status === "none" ? "未检测到模板"
                  : previewRuntime.templateState.status === "disabled" ? "检测到但未求值"
                    : previewRuntime.templateState.status === "evaluating" ? "正在求值"
                      : previewRuntime.templateState.status === "rendered" ? "求值完成"
                        : "求值失败"}
              </p>
              <p className="text-muted-foreground">场景：{previewRuntime.templateState.phase} · {previewRuntime.templateState.path}</p>
              {previewRuntime.templateState.durationMs !== undefined ? <p className="text-muted-foreground">耗时 {previewRuntime.templateState.durationMs.toFixed(1)} ms · {previewRuntime.templateState.inputBytes ?? 0} → {previewRuntime.templateState.outputBytes ?? 0} bytes</p> : null}
              {previewRuntime.templateState.message ? <p className={previewRuntime.templateState.status === "error" ? "text-destructive" : "text-amber-700"}>{previewRuntime.templateState.message}{previewRuntime.templateState.line ? `（第 ${previewRuntime.templateState.line} 行）` : ""}</p> : null}
            </div>
          ) : null}
          {previewRuntime.regexResult ? (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="font-medium">正则结果 · {previewRuntime.regexResult.totalMatches} 次命中 · {previewRuntime.regexResult.stages.length} 个阶段</p>
              {previewRuntime.regexResult.diagnostics.map((diagnostic) => <p key={`${diagnostic.ruleUid}:${diagnostic.message}`} className={diagnostic.severity === "error" ? "text-destructive" : "text-amber-700"}>{diagnostic.ruleName}：{diagnostic.message}</p>)}
              {previewRuntime.regexResult.stages.map((stage) => (
                <details key={stage.uid} className="rounded-md border border-border bg-surface p-2">
                  <summary className="cursor-pointer font-medium">{stage.index + 1}. {stage.name} · {stage.matches} 次 · {stage.durationMs.toFixed(1)} ms</summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[9px] text-muted-foreground">{stage.output.slice(0, 4000)}{stage.output.length > 4000 ? "\n… [仅显示前 4000 字符]" : ""}</pre>
                </details>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {canvasExpanded ? (
        <div className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" aria-hidden="true" />
      ) : null}

      {canRenderStatic || runtimeActive ? (
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs",
            canvasExpanded
              ? "fixed inset-3 z-50 min-h-0 shadow-2xl sm:inset-5"
              : "mt-3 min-h-[480px] flex-1",
          )}
          data-testid="preview-canvas-panel"
          data-expanded={canvasExpanded ? "true" : "false"}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white/95 p-2">
            <div
              className="flex min-w-0 flex-1 items-center rounded-lg border border-border bg-muted/35 p-0.5"
              aria-label="预览画布尺寸"
            >
              {PREVIEW_DEVICES.map((device) => {
                const DeviceIcon = device.icon;
                const selected = device.id === selectedDevice.id;
                return (
                  <button
                    key={device.id}
                    type="button"
                    aria-pressed={selected}
                    title={`${device.label} ${device.width} × ${device.height}`}
                    onClick={() => {
                      recenterCanvasRef.current = true;
                      setDeviceId(device.id);
                    }}
                    className={cn(
                      "flex h-9 min-w-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                      selected
                        ? "bg-surface text-primary shadow-xs"
                        : "text-muted-foreground hover:bg-surface/70 hover:text-foreground",
                    )}
                  >
                    <DeviceIcon className="size-3.5" />
                    <span className="hidden min-[390px]:inline">{device.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/35 p-0.5">
              <Button
                type="button"
                variant={panMode ? "subtle" : "ghost"}
                size="icon-sm"
                title={panMode ? "关闭画布导航，恢复预览交互" : "拖动画布；支持滚轮和双指缩放"}
                aria-label="拖动画布"
                aria-pressed={panMode}
                onClick={() => setPanMode((current) => !current)}
              >
                <Hand />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="缩小画布"
                aria-label="缩小画布"
                onClick={() => adjustScale(-PREVIEW_SCALE_STEP)}
                disabled={!fitToContainer && manualScale <= MIN_PREVIEW_SCALE}
              >
                <ZoomOut />
              </Button>
              <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">
                {Math.round(renderedScale * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="放大画布"
                aria-label="放大画布"
                onClick={() => adjustScale(PREVIEW_SCALE_STEP)}
                disabled={!fitToContainer && manualScale >= MAX_PREVIEW_SCALE}
              >
                <ZoomIn />
              </Button>
              <Button
                type="button"
                variant={fitToContainer ? "subtle" : "ghost"}
                size="icon-sm"
                title="适合容器"
                aria-label="适合容器"
                aria-pressed={fitToContainer}
                onClick={fitCanvasToContainer}
              >
                <Focus />
              </Button>
              <Button
                type="button"
                variant={canvasExpanded ? "subtle" : "ghost"}
                size="icon-sm"
                title={canvasExpanded ? "退出大画布（Esc）" : "展开大画布"}
                aria-label={canvasExpanded ? "退出大画布" : "展开大画布"}
                aria-pressed={canvasExpanded}
                onClick={toggleCanvasExpanded}
              >
                {canvasExpanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-b border-border bg-primary-soft/30 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="truncate">{selectedDevice.label}画布</span>
            <span className="shrink-0 font-mono">
              {selectedDevice.width} × {selectedDevice.height}
            </span>
          </div>

          <div
            className="relative min-h-[380px] flex-1 overflow-hidden"
            onWheel={handleCanvasWheel}
          >
            <div
              ref={stageRef}
              className="h-full w-full overflow-auto bg-preview-grid"
              data-testid="preview-stage"
              aria-label="预览画布视口"
            >
              <div
                className="grid min-h-full min-w-full place-items-center p-3"
                style={{
                  width: `max(100%, ${selectedDevice.width * renderedScale + PREVIEW_STAGE_PADDING * 2}px)`,
                  height: `max(100%, ${selectedDevice.height * renderedScale + PREVIEW_STAGE_PADDING * 2}px)`,
                }}
              >
                <div
                  ref={canvasRef}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                  data-testid="preview-canvas"
                  style={{
                    width: selectedDevice.width * renderedScale,
                    height: selectedDevice.height * renderedScale,
                  }}
                >
                  {runtimeActive ? (
                    <div ref={runtimeMountRef} className="h-full w-full bg-white" />
                  ) : (
                    <iframe
                      title={`${path} 静态预览`}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={srcDoc}
                      className="block border-0 bg-white"
                      style={{
                        width: selectedDevice.width,
                        height: selectedDevice.height,
                        transform: `scale(${renderedScale})`,
                        transformOrigin: "top left",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {panMode ? (
              <div
                className={cn(
                  "absolute inset-0 z-20 touch-none select-none",
                  isPanning ? "cursor-grabbing" : "cursor-grab",
                )}
                data-testid="preview-pan-overlay"
                aria-label="画布导航层"
                onPointerDown={handlePanPointerDown}
                onPointerMove={handlePanPointerMove}
                onPointerUp={finishPanPointer}
                onPointerCancel={finishPanPointer}
                onDoubleClick={fitCanvasToContainer}
              >
                <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-slate-200/80 bg-white/90 px-3 py-1 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur">
                  拖动平移 · 滚轮或双指缩放 · 双击适配
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex min-h-[300px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/25 p-6 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-surface text-muted-foreground shadow-xs">
            <Code2 className="size-5" />
          </span>
          <p className="mt-4 text-sm font-medium">该文件没有直接视觉输出</p>
          <p className="mt-2 max-w-56 text-xs leading-5 text-muted-foreground">
            打开 Regex replacement 的 HTML 文件或 CSS 文件即可实时预览。
          </p>
        </div>
      )}

      {showLogs ? (
        <div className="mt-3 max-h-56 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2 font-mono text-[10px] text-slate-200">
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <span>动态预览日志与兼容状态</span>
            <div className="flex items-center gap-2"><select className="rounded bg-slate-900 px-1 py-0.5 text-slate-300" value={logLevel} onChange={(event) => setLogLevel(event.target.value as typeof logLevel)}><option value="all">全部</option><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select><button type="button" className="text-slate-400 hover:text-white" onClick={() => void navigator.clipboard?.writeText(filteredLogs.map((entry) => `[${entry.level}] ${entry.frame.name ?? entry.frame.kind}: ${entry.message}`).join("\n"))}>复制</button><button type="button" className="text-slate-400 hover:text-white" onClick={previewRuntime?.clearLogs}>清空</button></div>
          </div>
          {previewRuntime && previewRuntime.scripts.length > 0 ? <div className="mb-2 space-y-1 border-b border-slate-800 pb-2">{previewRuntime.scripts.map((script) => <button type="button" key={script.id} onClick={() => onOpenPath?.(script.path)} className="flex w-full items-center justify-between gap-2 text-left text-slate-400 hover:text-white"><span className="truncate">{script.index + 1}. {script.name}</span><span className={script.status === "error" ? "text-red-300" : script.status === "running" ? "text-emerald-300" : "text-sky-300"}>{scriptProgressLabel(script)}</span></button>)}</div> : null}
          {filteredLogs.length === 0 ? <p className="text-slate-500">暂无符合筛选条件的 console 或运行错误。</p> : null}
          {filteredLogs.map((entry) => (
            <div key={entry.id} className={cn("grid grid-cols-[auto_1fr] gap-2 py-0.5", entry.level === "error" && "text-red-300", entry.level === "warn" && "text-amber-300")}>
              <span className="text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span className="break-all">[{entry.level}] [{entry.frame.name ?? entry.frame.kind}] {entry.message}{entry.filename ? ` · ${entry.filename}${entry.line ? `:${entry.line}` : ""}` : ""}{entry.truncated ? " · 已截断" : ""}</span>
            </div>
          ))}
          {previewRuntime && previewRuntime.capabilities.length > 0 ? <div className="mt-2 border-t border-slate-800 pt-2"><p className="mb-1 text-slate-400">Capability 使用</p>{previewRuntime.capabilities.map((usage) => <div key={`${usage.capability}:${usage.frame.id ?? usage.frame.kind}`} className={usage.supported ? "text-slate-400" : "text-amber-300"}>{usage.capability} · {usage.strategy} · {usage.count} 次 · {usage.frame.name ?? usage.frame.kind}</div>)}</div> : null}
        </div>
      ) : null}

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/35 p-3">
        <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10px] leading-4 text-muted-foreground">
          {runtimeActive
            ? "启用的项目 content.js 与消息 HTML 在独立 Preview Origin 中执行，可联网、写入该预览源存储并产生外部副作用；停止不会撤销已经发生的外部操作。"
            : "静态模式使用空 sandbox 与严格 CSP，会移除 script、inline handler 和 javascript: URL，不执行用户代码。"}
        </p>
      </div>
      <div className="mt-2 flex items-start gap-2 rounded-lg border border-primary/15 bg-primary-soft/35 p-3">
        <Globe2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <p className="text-[10px] leading-4 text-muted-foreground">
          外部图片、字体和样式表可以展示，因此可能向资源来源发起网络请求；预览使用 no-referrer，不发送当前工具页面的来源信息。
        </p>
      </div>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

function useObservedWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = (nextWidth: number) => {
      const roundedWidth = Math.round(nextWidth);
      setWidth((currentWidth) =>
        currentWidth === roundedWidth ? currentWidth : roundedWidth,
      );
    };

    updateWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function buildHtmlPreviewDocument(source: string) {
  if (typeof DOMParser === "undefined") {
    return `<!doctype html><html><head>${previewSecurityHead()}</head><body>${source}</body></html>`;
  }

  const document = new DOMParser().parseFromString(source, "text/html");
  document.querySelectorAll("script").forEach((element) => element.remove());
  document.querySelectorAll("meta[http-equiv]").forEach((element) => {
    if (element.getAttribute("http-equiv")?.toLowerCase() === "refresh") element.remove();
  });
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (
        SCRIPT_URL_ATTRIBUTES.has(attributeName) &&
        JAVASCRIPT_URL_PATTERN.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
  document.head.insertAdjacentHTML("afterbegin", previewSecurityHead());
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function buildCssPreviewDocument(source: string) {
  const safeCss = source.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head>${previewSecurityHead()}<style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; padding: 32px; background: #f4f8ff; color: #172033; }
    .preview-card { max-width: 680px; margin: 0 auto; padding: 32px; border: 1px solid #dbe7f7; border-radius: 20px; background: white; box-shadow: 0 18px 45px rgb(38 93 166 / 12%); }
    .eyebrow { margin: 0 0 8px; color: #2878d4; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(24px, 5vw, 40px); line-height: 1.15; }
    .preview-copy { margin: 16px 0 24px; color: #60708a; line-height: 1.7; }
    .preview-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    button { min-height: 40px; padding: 0 16px; border: 1px solid #cbd9ed; border-radius: 10px; background: white; color: #25344e; font: inherit; }
    button.primary { border-color: #2878d4; background: #2878d4; color: white; }
    details { margin-top: 24px; padding: 14px 16px; border-radius: 12px; background: #f0f6ff; }
    summary { cursor: pointer; font-weight: 650; }
    ${safeCss}
  </style></head><body><main class="preview-card"><p class="eyebrow">Preset Studio</p><h1>CSS 设计预览</h1><p class="preview-copy">这是隔离静态画布中的示例排版、按钮与无脚本原生控件。你的 CSS 会覆盖基础样式。</p><div class="preview-actions"><button class="primary" type="button">主要按钮</button><button type="button">次要按钮</button></div><details><summary>展开原生 details</summary><p>此交互由浏览器原生提供，不执行 JavaScript。</p></details></main></body></html>`;
}

function previewSecurityHead() {
  return `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">`;
}

const SCRIPT_URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction", "xlink:href"]);
const JAVASCRIPT_URL_PATTERN = /^\s*javascript\s*:/i;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function unwrapCodeFence(content: string) {
  const match = content.match(/^\s*```(?:html|css)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  return match?.[1] ?? content;
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 break-all text-right font-medium", mono && "font-mono text-[10px]")}>{value}</span>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function scriptProgressLabel(script: ProjectPreviewRuntime["scripts"][number]) {
  if (
    script.status === "loading"
    && typeof script.transferredBytes === "number"
    && typeof script.byteLength === "number"
    && script.byteLength > 0
    && script.transferredBytes < script.byteLength
  ) return `传输 ${Math.floor((script.transferredBytes / script.byteLength) * 100)}%`;
  return script.status;
}

function generationContentText(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
}

function saveLabel(state: SaveState, saveMode: "auto" | "explicit") {
  if (state === "saving") return "正在写入工程";
  if (state === "dirty") {
    return saveMode === "explicit" ? "完整 JSON 等待应用" : "等待自动保存";
  }
  if (state === "error") return "保存失败";
  return "工程文件已保存";
}
