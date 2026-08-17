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

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface ExplorerFile {
  path: string;
  type: "file" | "directory";
  size: number;
  updatedAt?: string;
  displayName?: string;
  order?: number;
  role?: "source-json";
}

interface WorkspaceFileExplorerProps {
  projectName: string;
  projectVersion?: string;
  files: ExplorerFile[];
  activePath?: string;
  onSelect: (path: string) => void;
  onOpenProjects: () => void;
}

interface ExplorerNode {
  entry: ExplorerFile;
  label: string;
  children: ExplorerNode[];
  fileCount: number;
}

const groupOrder = ["prompts", "regex", "scripts", "snapshots", "output", "recovery"];
const initiallyExpanded = new Set(["prompts", "regex", "scripts"]);

export const WorkspaceFileExplorer = memo(function WorkspaceFileExplorer({
  projectName,
  projectVersion,
  files,
  activePath,
  onSelect,
  onOpenProjects,
}: WorkspaceFileExplorerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded));
  const normalizedQuery = query.trim().toLowerCase();
  const tree = useMemo(() => {
    const fullTree = buildTree(files);
    return normalizedQuery ? filterTree(fullTree, normalizedQuery) : fullTree;
  }, [files, normalizedQuery]);

  useEffect(() => {
    if (!activePath) return;
    const segments = activePath.split("/");
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
  }, [activePath]);

  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-border bg-sidebar md:w-[292px]">
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
            key={node.entry.path}
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
          <span>{files.filter((file) => file.type === "file").length} 个文件</span>
          <Button variant="ghost" size="sm" className="h-6 px-1.5">
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
  if (node.entry.type === "file") {
    return (
      <FileRow
        file={node.entry}
        label={node.label}
        depth={depth}
        active={activePath === node.entry.path}
        onClick={() => onSelect(node.entry.path)}
      />
    );
  }

  const isExpanded = forceExpanded || expanded.has(node.entry.path);
  const rootGroup = depth === 0 && groupOrder.includes(node.entry.path);
  return (
    <section className={rootGroup ? "mb-2" : "my-0.5"}>
      <button
        type="button"
        onClick={() => onToggle(node.entry.path)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
          rootGroup && "text-[10px] font-semibold uppercase tracking-[0.12em]",
          !rootGroup && "text-xs font-medium",
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        aria-expanded={isExpanded}
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
        {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <Folder className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{rootGroup ? groupLabel(node.entry.path) : node.label}</span>
        <span className="font-mono text-[9px] font-normal">{node.fileCount}</span>
      </button>
      {isExpanded ? (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.entry.path}
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
  file: ExplorerFile;
  label: string;
  depth: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = fileIcon(file.path);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
        active
          ? "bg-primary-soft text-foreground"
          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
    >
      <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      {file.role === "source-json" ? <Badge variant="blue">完整</Badge> : null}
      {file.size > 1_000_000 ? <Badge variant="amber">大文件</Badge> : null}
    </button>
  );
}

function buildTree(files: ExplorerFile[]): ExplorerNode[] {
  const nodes = new Map<string, ExplorerNode>();
  for (const entry of files) {
    nodes.set(entry.path, {
      entry,
      label: entry.displayName ?? entry.path.split("/").at(-1) ?? entry.path,
      children: [],
      fileCount: entry.type === "file" ? 1 : 0,
    });
  }

  const roots: ExplorerNode[] = [];
  for (const node of nodes.values()) {
    const separator = node.entry.path.lastIndexOf("/");
    const parentPath = separator < 0 ? "" : node.entry.path.slice(0, separator);
    const parent = parentPath ? nodes.get(parentPath) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const finalize = (node: ExplorerNode): number => {
    node.children.sort(compareNodes);
    node.fileCount = node.entry.type === "file"
      ? 1
      : node.children.reduce((sum, child) => sum + finalize(child), 0);
    return node.fileCount;
  };
  roots.sort(compareNodes);
  roots.forEach(finalize);
  return roots;
}

function filterTree(nodes: ExplorerNode[], query: string): ExplorerNode[] {
  const output: ExplorerNode[] = [];
  for (const node of nodes) {
    const selfMatches = `${node.label} ${node.entry.path}`.toLowerCase().includes(query);
    const children = selfMatches ? node.children : filterTree(node.children, query);
    if (selfMatches || children.length > 0) output.push({ ...node, children });
  }
  return output;
}

function compareNodes(left: ExplorerNode, right: ExplorerNode) {
  const leftRootRank = rootRank(left.entry.path);
  const rightRootRank = rootRank(right.entry.path);
  if (leftRootRank !== rightRootRank) return leftRootRank - rightRootRank;
  if (left.entry.type !== right.entry.type) return left.entry.type === "directory" ? -1 : 1;
  const leftOrder = left.entry.order ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.entry.order ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const leftFileRank = fileRank(left.label);
  const rightFileRank = fileRank(right.label);
  if (leftFileRank !== rightFileRank) return leftFileRank - rightFileRank;
  return left.label.localeCompare(right.label, "zh-CN");
}

function rootRank(path: string) {
  if (path.includes("/")) return 0;
  if (path === "preset.json") return -30;
  if (path === "project.json") return -20;
  if (path === "preset.base.json") return -10;
  const group = groupOrder.indexOf(path);
  return group === -1 ? groupOrder.length + 10 : group;
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

function groupLabel(group: string) {
  const labels: Record<string, string> = {
    prompts: "Prompts",
    regex: "Regex",
    scripts: "Scripts",
    snapshots: "只读快照",
    output: "构建输出",
    recovery: "恢复数据",
  };
  return labels[group] ?? group;
}

function fileIcon(path: string) {
  if (path.endsWith(".js") || path.endsWith(".ts")) return Code2;
  if (path.endsWith(".json")) return FileJson2;
  if (path.endsWith(".html") || path.endsWith(".css")) return FileCode2;
  if (path.includes("regex/") || path.endsWith("find.txt")) return Regex;
  return FileText;
}
