import {
  ArrowDown,
  ArrowUp,
  Braces,
  ChevronRight,
  Code2,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Regex,
  Search,
  Settings2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";

import type { JsonValue } from "../../lib/project-api";
import type { ProjectResourceEntry } from "../../lib/project-resource-catalog";
import {
  movePrimaryPrompt,
  movePrimaryPromptByDelta,
  setPrimaryPromptEnabled,
} from "../../lib/prompt-order";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

interface WorkspaceFileExplorerProps {
  projectName: string;
  projectVersion?: string;
  files: ProjectResourceEntry[];
  activePath?: string;
  onSelect: (path: string) => void;
  onOpenProjects: () => void;
  onOpenSettings?: () => void;
  promptOrder?: JsonValue[];
  promptOrderBusy?: boolean;
  promptOrderPending?: ReadonlySet<string>;
  onPromptOrderChange?: (promptOrder: JsonValue[], identifier: string) => void;
  className?: string;
}

interface ExplorerNode {
  entry: ProjectResourceEntry;
  label: string;
  children: ExplorerNode[];
  fileCount: number;
}

interface PromptDropTarget {
  identifier: string;
  placement: "before" | "after";
}

const initiallyExpanded = new Set([
  "core",
  "core/prompts",
  "spreset",
  "regex",
  "regex/regex",
  "tavern-helper",
  "tavern-helper/scripts",
  "project",
  "project/config",
]);

export const WorkspaceFileExplorer = memo(function WorkspaceFileExplorer({
  projectName,
  projectVersion,
  files,
  activePath,
  onSelect,
  onOpenProjects,
  onOpenSettings,
  promptOrder = [],
  promptOrderBusy,
  promptOrderPending,
  onPromptOrderChange,
  className,
}: WorkspaceFileExplorerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded));
  const [draggedPrompt, setDraggedPrompt] = useState<string>();
  const [promptDropTarget, setPromptDropTarget] = useState<PromptDropTarget>();
  const normalizedQuery = query.trim().toLowerCase();
  const tree = useMemo(() => {
    const fullTree = buildTree(files);
    return normalizedQuery ? filterTree(fullTree, normalizedQuery) : fullTree;
  }, [files, normalizedQuery]);
  const activeTreePath = useMemo(
    () => files.find((entry) => entry.kind === "file" && entry.sourcePath === activePath)?.treePath,
    [activePath, files],
  );

  useEffect(() => {
    if (!activeTreePath) return;
    const segments = activeTreePath.split("/");
    setExpanded((current) => {
      let changed = false;
      const next = new Set(current);
      for (let index = 1; index < segments.length; index += 1) {
        const ancestor = segments.slice(0, index).join("/");
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [activeTreePath]);

  const toggleDirectory = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const changePromptEnabled = useCallback((identifier: string, enabled: boolean) => {
    onPromptOrderChange?.(setPrimaryPromptEnabled(promptOrder, identifier, enabled), identifier);
  }, [onPromptOrderChange, promptOrder]);

  const movePromptByDelta = useCallback((identifier: string, delta: -1 | 1) => {
    onPromptOrderChange?.(movePrimaryPromptByDelta(promptOrder, identifier, delta), identifier);
  }, [onPromptOrderChange, promptOrder]);

  const finishPromptDrop = useCallback((target: PromptDropTarget) => {
    if (!draggedPrompt || draggedPrompt === target.identifier) return;
    onPromptOrderChange?.(movePrimaryPrompt(
      promptOrder,
      draggedPrompt,
      target.identifier,
      target.placement,
    ), draggedPrompt);
    setDraggedPrompt(undefined);
    setPromptDropTarget(undefined);
  }, [draggedPrompt, onPromptOrderChange, promptOrder]);

  const endPromptDrag = useCallback(() => {
    setDraggedPrompt(undefined);
    setPromptDropTarget(undefined);
  }, []);
  const updatePromptDropTarget = useCallback((target: PromptDropTarget) => {
    setPromptDropTarget((current) => current?.identifier === target.identifier
      && current.placement === target.placement
      ? current
      : target);
  }, []);

  return (
    <aside
      className={cn(
        "flex h-full w-full shrink-0 flex-col border-r border-border bg-sidebar",
        className,
      )}
    >
      <div className="border-b border-border p-3">
        <button
          type="button"
          onClick={onOpenProjects}
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left shadow-xs outline-none transition-colors hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Braces className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{projectName}</span>
              {projectVersion ? <Badge variant="blue">{projectVersion}</Badge> : null}
            </span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              点击切换或导入工程
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工程文件或条目…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tree.map((node) => (
          <TreeNodeRow
            key={node.entry.resourceId}
            node={node}
            depth={0}
            activePath={activePath}
            expanded={expanded}
            forceExpanded={Boolean(normalizedQuery)}
            onToggle={toggleDirectory}
            onSelect={onSelect}
            promptOrderBusy={promptOrderBusy}
            promptOrderPending={promptOrderPending}
            draggedPrompt={draggedPrompt}
            promptDropTarget={promptDropTarget}
            onPromptEnabledChange={changePromptEnabled}
            onPromptMove={movePromptByDelta}
            onPromptDragStart={setDraggedPrompt}
            onPromptDragOver={updatePromptDropTarget}
            onPromptDrop={finishPromptDrop}
            onPromptDragEnd={endPromptDrag}
          />
        ))}

        {tree.length === 0 ? (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            没有符合条件的工程文件
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{files.filter((file) => file.kind === "file").length} 个文件</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onOpenSettings}>
            <Settings2 className="size-3" />
            工程设置
          </Button>
        </div>
      </div>
    </aside>
  );
});

function TreeNodeRow({
  node,
  depth,
  activePath,
  expanded,
  forceExpanded,
  onToggle,
  onSelect,
  promptOrderBusy,
  promptOrderPending,
  draggedPrompt,
  promptDropTarget,
  onPromptEnabledChange,
  onPromptMove,
  onPromptDragStart,
  onPromptDragOver,
  onPromptDrop,
  onPromptDragEnd,
}: {
  node: ExplorerNode;
  depth: number;
  activePath?: string;
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  promptOrderBusy?: boolean;
  promptOrderPending?: ReadonlySet<string>;
  draggedPrompt?: string;
  promptDropTarget?: PromptDropTarget;
  onPromptEnabledChange: (identifier: string, enabled: boolean) => void;
  onPromptMove: (identifier: string, delta: -1 | 1) => void;
  onPromptDragStart: (identifier: string) => void;
  onPromptDragOver: (target: PromptDropTarget) => void;
  onPromptDrop: (target: PromptDropTarget) => void;
  onPromptDragEnd: () => void;
}) {
  if (node.entry.kind !== "directory") {
    const sourcePath = node.entry.sourcePath;
    return (
      <FileRow
        file={node.entry}
        label={node.label}
        depth={depth}
        active={node.entry.kind === "file" && activePath === sourcePath}
        onClick={() => {
          if (sourcePath) onSelect(sourcePath);
        }}
      />
    );
  }

  const isExpanded = forceExpanded || expanded.has(node.entry.treePath);
  const rootGroup = depth === 0;
  const prompt = node.entry.promptOrder;
  const promptEnabled = Boolean(prompt?.enabled && prompt.referenced);
  const canEditPromptOrder = Boolean(prompt?.editable && !promptOrderBusy);
  const promptOrderIsPending = Boolean(prompt && promptOrderPending?.has(prompt.identifier));
  const canMovePrompt = Boolean(canEditPromptOrder && prompt?.referenced);
  const isDraggedPrompt = prompt?.identifier === draggedPrompt;
  const activeDropTarget = prompt?.identifier === promptDropTarget?.identifier
    ? promptDropTarget
    : undefined;

  const handlePromptDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!prompt || !canMovePrompt || !draggedPrompt || draggedPrompt === prompt.identifier) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    onPromptDragOver({
      identifier: prompt.identifier,
      placement: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  };

  return (
    <section className={cn(
      rootGroup ? "mb-2" : "my-0.5",
      prompt && "group/prompt [content-visibility:auto] [contain-intrinsic-size:auto_32px]",
    )}>
      <div
        className={cn(
          "relative flex w-full min-w-0 items-center rounded-md text-foreground hover:bg-muted/70",
          rootGroup && "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
          !rootGroup && "text-xs font-medium",
          prompt && !prompt.enabled && "text-muted-foreground",
          isDraggedPrompt && "opacity-45",
        )}
        onDragOver={handlePromptDragOver}
        onDrop={(event) => {
          if (!prompt || !canMovePrompt || !draggedPrompt || draggedPrompt === prompt.identifier) return;
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          onPromptDrop({
            identifier: prompt.identifier,
            placement: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
          });
        }}
      >
        {activeDropTarget ? (
          <span
            className={cn(
              "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary",
              activeDropTarget.placement === "before" ? "top-0" : "bottom-0",
            )}
          />
        ) : null}
        <button
          type="button"
          onClick={() => onToggle(node.entry.treePath)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          aria-expanded={isExpanded}
          data-tree-path={node.entry.treePath}
          data-plugin-id={rootGroup ? node.entry.pluginId : undefined}
        >
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
          {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <Folder className="size-3.5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
          {!prompt ? <span className="font-mono text-[9px] font-normal text-muted-foreground">{node.fileCount}</span> : null}
        </button>
        {prompt ? (
          <div className="flex shrink-0 items-center gap-0.5 pr-1">
            <span
              draggable={canMovePrompt}
              className={cn(
                "flex size-6 items-center justify-center rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                canMovePrompt ? "cursor-grab hover:bg-surface hover:text-foreground active:cursor-grabbing" : "cursor-not-allowed opacity-30",
              )}
              title={prompt.referenced ? "拖动调整运行顺序" : "启用后可调整顺序"}
              aria-hidden="true"
              onDragStart={(event) => {
                if (!canMovePrompt) return;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", prompt.identifier);
                onPromptDragStart(prompt.identifier);
              }}
              onDragEnd={onPromptDragEnd}
            >
              <GripVertical className="size-3.5" />
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              disabled={!canMovePrompt || prompt.position === 0}
              onClick={() => onPromptMove(prompt.identifier, -1)}
              aria-label={`上移 ${node.label}`}
              title="在 Prompt Order 中上移"
            >
              <ArrowUp className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              disabled={!canMovePrompt || prompt.last}
              onClick={() => onPromptMove(prompt.identifier, 1)}
              aria-label={`下移 ${node.label}`}
              title="在 Prompt Order 中下移"
            >
              <ArrowDown className="size-3" />
            </Button>
            <Switch
              checked={promptEnabled}
              disabled={!canEditPromptOrder}
              className={cn(
                "ml-0.5 h-4 w-8 border shadow-inner disabled:opacity-70 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-4",
                promptEnabled
                  ? "border-primary/40 bg-primary-soft data-[state=checked]:bg-primary-soft [&>span]:bg-primary"
                  : "border-border bg-border data-[state=unchecked]:bg-border [&>span]:bg-white",
                promptOrderIsPending && "ring-1 ring-primary/35",
              )}
              onCheckedChange={(enabled) => onPromptEnabledChange(prompt.identifier, enabled)}
              aria-label={`${promptEnabled ? "禁用" : "启用"} ${node.label}`}
              aria-busy={promptOrderIsPending}
              title={promptOrderIsPending
                ? "正在保存 Prompt Order…"
                : prompt.referenced
                  ? `${prompt.enabled ? "已启用" : "已禁用"} · Character ${prompt.characterId}`
                  : "未加入 Prompt Order；开启后追加到末尾"}
            />
          </div>
        ) : null}
      </div>
      {isExpanded ? (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.entry.resourceId}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expanded={expanded}
              forceExpanded={forceExpanded}
              onToggle={onToggle}
              onSelect={onSelect}
              promptOrderBusy={promptOrderBusy}
              promptOrderPending={promptOrderPending}
              draggedPrompt={draggedPrompt}
              promptDropTarget={promptDropTarget}
              onPromptEnabledChange={onPromptEnabledChange}
              onPromptMove={onPromptMove}
              onPromptDragStart={onPromptDragStart}
              onPromptDragOver={onPromptDragOver}
              onPromptDrop={onPromptDrop}
              onPromptDragEnd={onPromptDragEnd}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FileRow({
  file,
  label,
  depth,
  active,
  onClick,
}: {
  file: ProjectResourceEntry;
  label: string;
  depth: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = fileIcon(file.sourcePath ?? file.treePath);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
        active
          ? "bg-primary-soft text-foreground"
          : "text-foreground hover:bg-muted/80",
      )}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
      data-source-path={file.sourcePath}
      data-tree-path={file.treePath}
    >
      <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      {file.kind === "reference" ? <Badge variant="blue">共享</Badge> : null}
      {file.role === "source-json" ? <Badge variant="blue">完整</Badge> : null}
      {file.size > 1_000_000 ? <Badge variant="amber">大文件</Badge> : null}
    </button>
  );
}

function buildTree(files: ProjectResourceEntry[]): ExplorerNode[] {
  const nodes = new Map<string, ExplorerNode>();
  for (const entry of files) {
    nodes.set(entry.treePath, {
      entry,
      label: entry.displayName,
      children: [],
      fileCount: entry.kind === "directory" ? 0 : 1,
    });
  }

  const roots: ExplorerNode[] = [];
  for (const node of nodes.values()) {
    const separator = node.entry.treePath.lastIndexOf("/");
    const parentPath = separator < 0 ? "" : node.entry.treePath.slice(0, separator);
    const parent = parentPath ? nodes.get(parentPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const finalize = (node: ExplorerNode): number => {
    node.children.sort(compareNodes);
    node.fileCount = node.entry.kind === "directory"
      ? node.children.reduce((sum, child) => sum + finalize(child), 0)
      : 1;
    return node.fileCount;
  };
  roots.sort(compareNodes);
  roots.forEach(finalize);
  return roots;
}

function filterTree(nodes: ExplorerNode[], query: string): ExplorerNode[] {
  const output: ExplorerNode[] = [];
  for (const node of nodes) {
    const selfMatches = `${node.label} ${node.entry.treePath} ${node.entry.sourcePath ?? ""}`
      .toLowerCase()
      .includes(query);
    const children = selfMatches ? node.children : filterTree(node.children, query);
    if (selfMatches || children.length > 0) output.push({ ...node, children });
  }
  return output;
}

function compareNodes(left: ExplorerNode, right: ExplorerNode) {
  const leftKindRank = left.entry.kind === "directory" ? 0 : 1;
  const rightKindRank = right.entry.kind === "directory" ? 0 : 1;
  if (leftKindRank !== rightKindRank) return leftKindRank - rightKindRank;
  const leftOrder = left.entry.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.entry.order ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const leftFileRank = fileRank(left.label);
  const rightFileRank = fileRank(right.label);
  if (leftFileRank !== rightFileRank) return leftFileRank - rightFileRank;
  return left.label.localeCompare(right.label, "zh-CN");
}

function fileRank(name: string) {
  const ranks: Record<string, number> = {
    "meta.json": 0,
    "content.md": 1,
    "content.js": 1,
    "find.txt": 1,
    "replace.html": 2,
    "index.json": 90,
    "prompt-order.json": 91,
  };
  return ranks[name] ?? 50;
}

function fileIcon(path: string) {
  if (path.endsWith(".js") || path.endsWith(".ts")) return Code2;
  if (path.endsWith(".json")) return FileJson2;
  if (path.endsWith(".html") || path.endsWith(".css")) return FileCode2;
  if (path.includes("regex/") || path.endsWith("find.txt")) return Regex;
  return FileText;
}
