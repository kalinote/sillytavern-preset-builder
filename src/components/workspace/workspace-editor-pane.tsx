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

import { AdaptiveCodeEditor } from "../editor";
import { Badge } from "../ui/badge";

export type SaveState = "saved" | "saving" | "dirty" | "error";

interface WorkspaceEditorPaneProps {
  viewStateKey: string;
  path: string;
  content: string;
  size: number;
  lineCount: number;
  revision?: string;
  saveState: SaveState;
  error?: string;
  onChange: (content: string) => void;
  onFlush: () => void;
}

export function WorkspaceEditorPane({
  viewStateKey,
  path,
  content,
  size,
  lineCount,
  revision,
  saveState,
  error,
  onChange,
  onFlush,
}: WorkspaceEditorPaneProps) {
  const filename = path.split("/").at(-1) ?? path;
  const language = languageFromPath(path);
  const largeFile = Math.max(size, content.length) > 1_000_000;
  const readOnly = path.startsWith("output/") || path.startsWith("snapshots/");
  const FileIcon = iconFromLanguage(language);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-editor">
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
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {path}
          </p>
        </div>
        <Badge variant="blue">{editorLabel(language)}</Badge>
        {largeFile && <Badge variant="amber">大文件模式</Badge>}
        {readOnly && <Badge>只读</Badge>}
      </div>

      {largeFile && (
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
        className="min-h-0 flex-1"
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            nextTarget instanceof Node &&
            event.currentTarget.contains(nextTarget)
          ) {
            return;
          }
          onFlush();
        }}
      >
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
      </div>

      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[10px] text-muted-foreground">
        <SaveIndicator state={saveState} />
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

function SaveIndicator({ state }: { state: SaveState }) {
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
        等待自动保存
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
