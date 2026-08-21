import {
  AlertTriangle,
  Check,
  CloudOff,
  Code2,
  FileCode2,
  FileJson2,
  FileText,
  LoaderCircle,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ProjectStructure, StructureMutation } from "../../lib/project-api";
import { AdaptiveCodeEditor } from "../editor";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ProjectConfigForm, RequestConfigForm } from "./config-form-editors";
import { PromptOrderEditor } from "./prompt-order-editor";

export type SaveState = "saved" | "saving" | "dirty" | "error";

interface WorkspaceEditorPaneProps {
  viewStateKey: string;
  path: string;
  content: string;
  size: number;
  lineCount: number;
  revision?: string;
  saveState: SaveState;
  saveMode?: "auto" | "explicit";
  error?: string;
  onChange: (content: string) => void;
  onFlush: () => void;
  onApply?: () => void;
  structure?: ProjectStructure | null;
  structureBusy?: boolean;
  onMutateStructure?: (mutation: StructureMutation) => void;
}

export function WorkspaceEditorPane({
  viewStateKey,
  path,
  content,
  size,
  lineCount,
  revision,
  saveState,
  saveMode = "auto",
  error,
  onChange,
  onFlush,
  onApply,
  structure,
  structureBusy,
  onMutateStructure,
}: WorkspaceEditorPaneProps) {
  const filename = path.split("/").at(-1) ?? path;
  const language = languageFromPath(path);
  const largeFile = Math.max(size, content.length) > 1_000_000;
  const readOnly = path.startsWith("output/") || path.startsWith("snapshots/");
  const FileIcon = iconFromLanguage(language);
  const promptOrderFile = path === "prompts/prompt-order.json";
  const configFormKind = path === "project.json"
    ? "project"
    : path === "preset.base.json" || path === "preset.json"
      ? "request"
      : null;
  const displayPath = useMemo(() => formatEditorPath(path, structure), [path, structure]);
  const [promptOrderMode, setPromptOrderMode] = useState<"source" | "structured">("source");
  const [configMode, setConfigMode] = useState<"form" | "json">("form");
  useEffect(() => setPromptOrderMode("source"), [path]);
  useEffect(() => setConfigMode("form"), [path]);
  const sourceEditorVisible = !configFormKind || configMode === "json";

  return (
    <main
      className="flex min-w-0 flex-1 flex-col bg-editor"
      onKeyDownCapture={(event) => {
        if (
          saveMode === "explicit" &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          onApply?.();
        }
      }}
    >
      <div className="flex h-10 shrink-0 items-end border-b border-border bg-surface px-2">
        <div className="flex h-9 min-w-0 max-w-[80%] items-center gap-2 border-x border-t border-border bg-editor px-3 text-xs">
          <FileIcon className="size-3.5 text-primary" />
          <span className="truncate font-medium">{filename}</span>
          {saveState !== "saved" && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
        </div>
      </div>

      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={displayPath}>
            {displayPath}
          </p>
        </div>
        <Badge variant="blue">{sourceEditorVisible ? editorLabel(language) : "Form"}</Badge>
        {largeFile && sourceEditorVisible && <Badge variant="amber">大文件模式</Badge>}
        {readOnly && <Badge>只读</Badge>}
        {saveMode === "explicit" ? (
          <Button
            size="sm"
            disabled={saveState === "saved" || saveState === "saving"}
            onClick={onApply}
          >
            {saveState === "saving" ? <LoaderCircle className="animate-spin" /> : <Save />}
            应用并重新拆分
          </Button>
        ) : null}
        {promptOrderFile && structure && onMutateStructure ? (
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
            <Button variant={promptOrderMode === "source" ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setPromptOrderMode("source")}>源码</Button>
            <Button variant={promptOrderMode === "structured" ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setPromptOrderMode("structured")}>结构化</Button>
          </div>
        ) : null}
        {configFormKind ? (
          <div className="flex rounded-lg border border-border bg-muted/40 p-0.5" aria-label="编辑模式">
            <Button variant={configMode === "form" ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setConfigMode("form")}>表单</Button>
            <Button variant={configMode === "json" ? "secondary" : "ghost"} size="sm" className="h-7" onClick={() => setConfigMode("json")}>JSON</Button>
          </div>
        ) : null}
      </div>

      {saveMode === "explicit" ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-primary/15 bg-primary-soft/45 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 text-primary" />
          完整 JSON 只会在点击“应用并重新拆分”或按 Ctrl/Cmd+S 后写入工程。
        </div>
      ) : null}

      {largeFile && sourceEditorVisible && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/20 bg-warning-soft/70 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-3.5" />
          已关闭 minimap、部分语义检查和自动格式化，以保持大文件输入流畅。
        </div>
      )}

      {saveState === "error" && (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/20 bg-destructive-soft px-3 py-2 text-xs text-destructive">
          <CloudOff className="size-3.5" />
          {error ?? "保存失败，内容仍保留在当前页面内存中。"}
        </div>
      )}

      <div
        className="flex min-h-0 flex-1"
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            nextTarget instanceof Node &&
            event.currentTarget.contains(nextTarget)
          ) {
            return;
          }
          if (saveMode === "auto") queueMicrotask(onFlush);
        }}
      >
        {promptOrderFile && promptOrderMode === "structured" && structure && onMutateStructure ? (
          <PromptOrderEditor
            structure={structure}
            busy={structureBusy}
            onSave={(promptOrder) => onMutateStructure({ op: "set-prompt-order", promptOrder })}
          />
        ) : configFormKind === "request" && configMode === "form" ? (
          <RequestConfigForm content={content} onChange={onChange} />
        ) : configFormKind === "project" && configMode === "form" ? (
          <ProjectConfigForm content={content} onChange={onChange} />
        ) : (
          <AdaptiveCodeEditor
            key={path}
            value={content}
            onChange={onChange}
            language={language}
            readOnly={readOnly}
            largeFile={largeFile}
            viewStateKey={viewStateKey}
            ariaLabel={`${filename} 源码编辑器`}
          />
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[10px] text-muted-foreground">
        <SaveIndicator state={saveState} mode={saveMode} />
        <span>UTF-8</span>
        <span>LF</span>
        <span className="hidden sm:inline">
          {lineCount.toLocaleString()} 行 · {content.length.toLocaleString()} 字符
        </span>
        {revision && (
          <span className="ml-auto hidden font-mono text-[9px] lg:inline">
            rev {revision.slice(0, 8)}
          </span>
        )}
        <span className={revision ? "" : "ml-auto"}>仅保存工程</span>
      </div>
    </main>
  );
}

function formatEditorPath(path: string, structure?: ProjectStructure | null) {
  if (!structure) return path;
  const match = /^(prompts|regex|scripts)\/([^/]+)\/(.+)$/.exec(path);
  if (!match) return path;

  const [, group, uid, filename] = match;
  const item = group === "prompts"
    ? structure.prompts.find((candidate) => candidate.uid === uid)
    : group === "regex"
      ? structure.regex.find((candidate) => candidate.uid === uid)
      : structure.scripts.find((candidate) => candidate.uid === uid);
  if (!item) return path;

  const itemName = item.kind === "prompt"
    ? item.name || item.identifier || uid
    : item.name || item.id || uid;
  const groupName = group === "prompts" ? "Prompts" : group === "regex" ? "Regex" : "Scripts";
  return `${groupName}/${itemName}/${filename}(${path})`;
}

function SaveIndicator({ state, mode }: { state: SaveState; mode: "auto" | "explicit" }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-primary">
        <LoaderCircle className="size-3 animate-spin" />
        正在保存…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1 text-destructive">
        <CloudOff className="size-3" />
        保存失败
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span className="flex items-center gap-1 text-warning">
        <Save className="size-3" />
        {mode === "explicit" ? "完整 JSON 待应用" : "等待自动保存"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-success">
      <Check className="size-3" />
      已保存
    </span>
  );
}

function languageFromPath(path: string) {
  if (path.startsWith("prompts/") && path.endsWith("/content.md")) {
    return "prompt";
  }
  if (path.startsWith("regex/") && path.endsWith("/find.txt")) {
    return "regex";
  }
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "json") return "json";
  if (extension === "js" || extension === "mjs" || extension === "cjs") return "javascript";
  if (extension === "ts" || extension === "tsx") return "typescript";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html") return "html";
  if (extension === "css") return "css";
  return "plaintext";
}

function iconFromLanguage(language: string) {
  if (language === "json") return FileJson2;
  if (
    language === "javascript" ||
    language === "typescript" ||
    language === "regex"
  ) {
    return Code2;
  }
  if (language === "html" || language === "css") return FileCode2;
  return FileText;
}

function editorLabel(language: string) {
  if (language === "plaintext") return "Text";
  return language.charAt(0).toUpperCase() + language.slice(1);
}
