import {
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Columns3,
  FileCode2,
  FileText,
  History,
  MoreHorizontal,
  PanelTop,
  Regex,
  RotateCcw,
  Save,
  Sparkles,
  Variable,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { StudioItem, StudioSection } from "../../data/demo";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";

interface EditorPaneProps {
  item: StudioItem;
  section: StudioSection;
  onDirty: () => void;
}

export function EditorPane({ item, section, onDirty }: EditorPaneProps) {
  const [content, setContent] = useState(item.content);
  const [enabled, setEnabled] = useState(item.enabled ?? true);

  useEffect(() => {
    setContent(item.content);
    setEnabled(item.enabled ?? true);
  }, [item]);

  const lineCount = useMemo(
    () => Math.max(content.split("\n").length, 1),
    [content],
  );

  const updateContent = (value: string) => {
    setContent(value);
    onDirty();
  };

  if (section === "snapshots") {
    return <SnapshotViewer item={item} />;
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-editor">
      <div className="flex h-10 shrink-0 items-end border-b border-border bg-surface px-2">
        <div className="flex h-9 min-w-0 max-w-[70%] items-center gap-2 border-x border-t border-border bg-editor px-3 text-xs">
          {sectionIcon(section)}
          <span className="truncate font-medium">{item.name}</span>
          {item.status === "modified" && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <X className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          className="mb-0.5 ml-1 size-7"
          aria-label="更多打开文件"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span>{sectionPath(section)}</span>
          <ChevronRight className="size-3" />
          <span className="max-w-48 truncate text-foreground">{item.name}</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {section === "prompts" && item.kind !== "marker" && (
            <>
              <select
                className="h-8 rounded-md border border-input bg-surface px-2 text-xs text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/20"
                defaultValue={item.role ?? "system"}
                onChange={onDirty}
                aria-label="Prompt role"
              >
                <option value="system">System</option>
                <option value="user">User</option>
                <option value="assistant">Assistant</option>
              </select>
              <ToolbarSwitch
                label={item.ordered === false ? "未插入" : "已插入"}
                checked={item.ordered !== false}
                onCheckedChange={onDirty}
              />
              <ToolbarSwitch
                label={enabled ? "已启用" : "已禁用"}
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked);
                  onDirty();
                }}
              />
            </>
          )}

          {section === "regex" && (
            <>
              <Badge variant="blue">3 个镜像联动</Badge>
              <ToolbarSwitch
                label={enabled ? "已启用" : "已禁用"}
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked);
                  onDirty();
                }}
              />
            </>
          )}

          {section === "scripts" && (
            <Badge variant={item.meta?.includes("3.29") ? "amber" : "neutral"}>
              {item.meta?.includes("3.29") ? "大文件模式" : "JavaScript"}
            </Badge>
          )}

          <ToolbarButton icon={RotateCcw} label="撤销" />
          <ToolbarButton icon={History} label="历史" />
          <ToolbarButton icon={WandSparkles} label="格式化" onClick={onDirty} />
        </div>
      </div>

      {section === "scripts" && item.meta?.includes("3.29") && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/20 bg-warning-soft/70 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-3.5" />
          已启用大文件优化：语义检查、格式化和 minimap 默认关闭。
          <button className="ml-auto font-medium underline underline-offset-2">
            查看设置
          </button>
        </div>
      )}

      {item.kind === "marker" ? (
        <MarkerWorkspace item={item} />
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 flex overflow-auto">
            <div
              className="select-none border-r border-editor-line bg-editor-gutter px-3 py-4 text-right font-mono text-xs leading-6 text-editor-line-number"
              aria-hidden="true"
            >
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
            <textarea
              value={content}
              onChange={(event) => updateContent(event.target.value)}
              spellCheck={false}
              aria-label={item.name + " 源码编辑器"}
              className="min-h-full min-w-[720px] flex-1 resize-none bg-editor px-4 py-4 font-mono text-[13px] leading-6 text-editor-foreground outline-none selection:bg-primary/20"
            />
          </div>
        </div>
      )}

      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Check className="size-3 text-success" />
          无语法错误
        </span>
        <span>UTF-8</span>
        <span>LF</span>
        <span className="hidden sm:inline">
          {lineCount} 行 · {content.length.toLocaleString()} 字符
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Save className="size-3" />
          仅保存工程
        </span>
      </div>
    </main>
  );
}

function MarkerWorkspace({ item }: { item: StudioItem }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-lg rounded-2xl border border-dashed border-primary/30 bg-primary-soft/35 p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-surface text-primary shadow-sm">
          <Variable className="size-6" />
        </span>
        <h2 className="mt-4 text-base font-semibold">{item.name}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          这是一个 SillyTavern Marker。它不需要 content，真实运行时会在此处填入对应上下文。
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">
          {item.identifier}
        </div>
      </div>
    </div>
  );
}

function SnapshotViewer({ item }: { item: StudioItem }) {
  const rows = item.content.split("\n").map((row) => {
    const [label, ...value] = row.split("：");
    return { label, value: value.join("：") };
  });

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-editor p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={item.status === "warning" ? "amber" : "green"}>
                {item.status === "warning" ? "上下文已变化" : "与 ST 一致"}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {item.identifier}
              </span>
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight">
              {item.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              从真实 SillyTavern 单向拉取的只读快照
            </p>
          </div>
          <Button variant="secondary">
            <Sparkles />
            重新拉取新快照
          </Button>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center gap-2">
              <PanelTop className="size-4 text-primary" />
              <p className="text-sm font-medium">上下文清单</p>
            </div>
          </div>
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid gap-1 px-5 py-3 sm:grid-cols-[140px_1fr]"
              >
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className="text-sm font-medium text-foreground">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary-soft/50 p-4">
          <Columns3 className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-xs leading-5 text-muted-foreground">
            快照不会自动跟随 ST 变化，也不能修改后写回。真实测试始终使用 ST
            当前实际上下文。
          </p>
        </div>
      </div>
    </main>
  );
}

function ToolbarSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-muted-foreground lg:flex">
      {label}
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="scale-90"
      />
    </label>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Braces;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-8"
          onClick={onClick}
        >
          <Icon className="size-3.5" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function sectionIcon(section: StudioSection) {
  if (section === "regex") return <Regex className="size-3.5 text-primary" />;
  if (section === "scripts")
    return <FileCode2 className="size-3.5 text-primary" />;
  return <FileText className="size-3.5 text-primary" />;
}

function sectionPath(section: StudioSection) {
  if (section === "regex") return "regex";
  if (section === "scripts") return "scripts";
  return "prompts";
}
