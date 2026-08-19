import {
  Braces,
  ChevronRight,
  Code2,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Regex,
  Search,
  Settings2,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import type { ProjectResourceEntry } from "../../lib/project-resource-catalog";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface WorkspaceFileExplorerProps {
  projectName: string;
  projectVersion?: string;
  files: ProjectResourceEntry[];
  activePath?: string;
  onSelect: (path: string) => void;
  onOpenProjects: () => void;
  onOpenSettings?: () => void;
  className?: string;
}

interface ExplorerNode {
  entry: ProjectResourceEntry;
  label: string;
  children: ExplorerNode[];
  fileCount: number;
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
  className,
}: WorkspaceFileExplorerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded));
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

  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

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
}: {
  node: ExplorerNode;
  depth: number;
  activePath?: string;
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
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
  return (
    <section className={rootGroup ? "mb-2" : "my-0.5"}>
      <button
        type="button"
        onClick={() => onToggle(node.entry.treePath)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30",
          rootGroup && "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
          !rootGroup && "text-xs font-medium",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        aria-expanded={isExpanded}
        data-tree-path={node.entry.treePath}
        data-plugin-id={rootGroup ? node.entry.pluginId : undefined}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
        {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <Folder className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        <span className="font-mono text-[9px] font-normal text-muted-foreground">{node.fileCount}</span>
      </button>
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
