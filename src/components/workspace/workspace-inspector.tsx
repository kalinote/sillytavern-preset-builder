import {
  CheckCircle2,
  Code2,
  Eye,
  FileText,
  Globe2,
  Info,
  Maximize2,
  Monitor,
  RefreshCw,
  ShieldOff,
  Smartphone,
  Tablet,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { SaveState } from "./workspace-editor-pane";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface WorkspaceInspectorProps {
  path: string;
  content: string;
  size: number;
  lineCount: number;
  revision?: string | null;
  saveState: SaveState;
  backendOnline: boolean;
  className?: string;
  initialTab?: "file" | "preview";
}

export function WorkspaceInspector({
  path,
  content,
  size,
  lineCount,
  revision,
  saveState,
  backendOnline,
  className,
  initialTab = "file",
}: WorkspaceInspectorProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-surface",
        className,
      )}
    >
      <Tabs defaultValue={initialTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">
              <FileText className="size-3.5" />
              文件
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="size-3.5" />
              静态预览
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
                    <p className="text-xs font-medium">{saveLabel(saveState)}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      850ms 防抖 · 切换与失焦强制写盘
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
                  自动保存只更新拆分工程文件；不会导出 JSON、推送或修改 SillyTavern。
                </p>
              </div>
            </InspectorSection>
          </div>
        </TabsContent>

        <TabsContent value="preview" className="min-h-0 flex-1 overflow-y-auto p-3">
          <StaticFilePreview key={path} path={path} content={content} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

const PREVIEW_DEBOUNCE_MS = 320;
const MIN_PREVIEW_SCALE = 0.2;
const MAX_PREVIEW_SCALE = 1.5;
const PREVIEW_SCALE_STEP = 0.1;

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

const PREVIEW_DEVICES: readonly PreviewDevice[] = [
  { id: "desktop", label: "桌面", width: 1280, height: 720, icon: Monitor },
  { id: "tablet", label: "平板", width: 768, height: 1024, icon: Tablet },
  { id: "mobile", label: "手机", width: 390, height: 844, icon: Smartphone },
];

function StaticFilePreview({ path, content }: { path: string; content: string }) {
  const [deviceId, setDeviceId] = useState<PreviewDevice["id"]>("desktop");
  const [fitToContainer, setFitToContainer] = useState(true);
  const [manualScale, setManualScale] = useState(0.75);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageWidth = useObservedWidth(stageRef);
  const previewContent = useDebouncedValue(content, PREVIEW_DEBOUNCE_MS);
  const extension = path.split(".").at(-1)?.toLowerCase();
  const canRender = extension === "html" || extension === "css";
  const isPreviewPending = content !== previewContent;
  const selectedDevice =
    PREVIEW_DEVICES.find((device) => device.id === deviceId) ?? PREVIEW_DEVICES[0];
  const fitScale = stageWidth
    ? clamp((stageWidth - 24) / selectedDevice.width, MIN_PREVIEW_SCALE, 1)
    : MIN_PREVIEW_SCALE;
  const renderedScale = fitToContainer ? fitScale : manualScale;
  const srcDoc = useMemo(() => {
    if (!canRender) return "";
    const source = unwrapCodeFence(previewContent);
    return extension === "css" ? buildCssPreviewDocument(source) : buildHtmlPreviewDocument(source);
  }, [canRender, extension, previewContent]);

  function adjustScale(delta: number) {
    setManualScale(clamp(renderedScale + delta, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE));
    setFitToContainer(false);
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">隔离静态画布</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            HTML/CSS 与无脚本原生控件
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {isPreviewPending ? <Badge variant="blue">等待刷新</Badge> : null}
          <Badge variant="amber">脚本禁用</Badge>
        </div>
      </div>

      {canRender ? (
        <div className="mt-3 flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
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
                    onClick={() => setDeviceId(device.id)}
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
                onClick={() => setFitToContainer((current) => !current)}
              >
                <Maximize2 />
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
            ref={stageRef}
            className="min-h-[344px] flex-1 overflow-auto bg-preview-grid p-3"
          >
            <div
              className="mx-auto overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
              style={{
                width: selectedDevice.width * renderedScale,
                height: selectedDevice.height * renderedScale,
              }}
            >
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
            </div>
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

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/35 p-3">
        <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10px] leading-4 text-muted-foreground">
          空 sandbox 与 CSP 会阻止项目脚本、inline handler、javascript: URL、网络请求 API、子框架、表单提交和顶层导航；项目 JavaScript 仅在手动推送后由真实 ST 测试。
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

function saveLabel(state: SaveState) {
  if (state === "saving") return "正在写入工程";
  if (state === "dirty") return "等待自动保存";
  if (state === "error") return "保存失败";
  return "工程文件已保存";
}
