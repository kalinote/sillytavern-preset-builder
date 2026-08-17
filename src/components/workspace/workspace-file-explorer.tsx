import {
  Braces,
  ChevronRight,
  Code2,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Regex,
  Search,
  Settings2,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import type { ProjectItemKind, ProjectStructure, StructureMutation } from "../../lib/project-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ItemActionsMenu } from "./item-actions-menu";
import { TextInputDialog } from "./text-input-dialog";

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
  structure?: ProjectStructure | null;
  structureBusy?: boolean;
  onMutate?: (mutation: StructureMutation) => void;
  onOpenSettings?: () => void;
  className?: string;
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
  structure,
  structureBusy = false,
  onMutate,
  onOpenSettings,
  className,
}: WorkspaceFileExplorerProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initiallyExpanded));
  const normalizedQuery = query.trim().toLowerCase();
  const [draggedItem, setDraggedItem] = useState<{ kind: ProjectItemKind; uid: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    kind: ProjectItemKind;
    uid: string;
    name: string;
  } | null>(null);
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

  const reorderItem = (kind: ProjectItemKind, uid: string, targetUid: string) => {
    if (!structure || !onMutate || uid === targetUid) return;
    const items = collectionForKind(structure, kind);
    const uids = items.map((item) => item.uid);
    const sourceIndex = uids.indexOf(uid);
    const targetIndex = uids.indexOf(targetUid);
    if (sourceIndex < 0 || targetIndex < 0) return;
    uids.splice(sourceIndex, 1);
    uids.splice(targetIndex, 0, uid);
    onMutate({ op: "reorder", kind, uids });
  };

  return (
    <>
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
            key={node.entry.path}
            node={node}
            depth={0}
            activePath={activePath}
            expanded={expanded}
            forceExpanded={Boolean(normalizedQuery)}
            onToggle={toggleDirectory}
            onSelect={onSelect}
            structure={structure}
            structureBusy={structureBusy}
            searchActive={Boolean(normalizedQuery)}
            onMutate={onMutate}
            draggedItem={draggedItem}
            onDragItem={setDraggedItem}
            onDropItem={reorderItem}
            onRequestRename={setRenameTarget}
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
          <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onOpenSettings}>
            <Settings2 className="size-3" />
            工程设置
          </Button>
        </div>
      </div>
    </aside>
    <TextInputDialog
      open={Boolean(renameTarget)}
      onOpenChange={(open) => {
        if (!open) setRenameTarget(null);
      }}
      title="重命名条目"
      description="只修改显示名称；稳定 UID 和 Prompt Identifier 不会改变。"
      inputLabel="条目名称"
      initialValue={renameTarget?.name ?? ""}
      confirmLabel="保存名称"
      busy={structureBusy}
      onSubmit={(name) => {
        if (!renameTarget || !onMutate) return;
        if (name !== renameTarget.name) {
          const key = renameTarget.kind === "regex" ? "scriptName" : "name";
          onMutate({
            op: "patch",
            kind: renameTarget.kind,
            uid: renameTarget.uid,
            patch: { [key]: name },
          });
        }
        setRenameTarget(null);
      }}
    />
    </>
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
  structure,
  structureBusy,
  searchActive,
  onMutate,
  draggedItem,
  onDragItem,
  onDropItem,
  onRequestRename,
}: {
  node: ExplorerNode;
  depth: number;
  activePath?: string;
  expanded: Set<string>;
  forceExpanded: boolean;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  structure?: ProjectStructure | null;
  structureBusy: boolean;
  searchActive: boolean;
  onMutate?: (mutation: StructureMutation) => void;
  draggedItem: { kind: ProjectItemKind; uid: string } | null;
  onDragItem: (item: { kind: ProjectItemKind; uid: string } | null) => void;
  onDropItem: (kind: ProjectItemKind, uid: string, targetUid: string) => void;
  onRequestRename: (item: { kind: ProjectItemKind; uid: string; name: string }) => void;
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
  const rootKind = rootKindFromPath(node.entry.path);
  const item = structure ? structureItemFromPath(structure, node.entry.path) : null;
  const collection = item && structure ? collectionForKind(structure, item.kind) : [];
  const itemIndex = item ? collection.findIndex((candidate) => candidate.uid === item.uid) : -1;
  const move = (delta: number) => {
    if (!item || itemIndex < 0) return;
    const target = collection[itemIndex + delta];
    if (!target) return;
    onDropItem(item.kind, item.uid, target.uid);
  };
  const rename = () => {
    if (!item) return;
    onRequestRename({ kind: item.kind, uid: item.uid, name: itemDisplayName(item) });
  };
  const remove = () => {
    if (!item || !onMutate) return;
    const references = item.kind === "prompt" && item.identifier
      ? promptReferenceCount(structure?.promptOrder ?? [], item.identifier)
      : 0;
    const confirmed = window.confirm(
      references > 0
        ? `“${itemDisplayName(item)}”被 Prompt Order 引用 ${references} 次。删除条目并移除这些引用？删除前会自动创建快照。`
        : `永久删除“${itemDisplayName(item)}”？删除前会自动创建快照。`,
    );
    if (!confirmed) return;
    onMutate({
      op: "delete",
      kind: item.kind,
      uid: item.uid,
      ...(references > 0 ? { removePromptOrderReferences: true } : {}),
    });
  };
  return (
    <section
      className={cn(rootGroup ? "mb-2" : "my-0.5", draggedItem?.uid === item?.uid && "opacity-50")}
      draggable={Boolean(item && !searchActive && !structureBusy)}
      onDragStart={(event) => {
        if (!item || searchActive || structureBusy) return;
        event.dataTransfer.effectAllowed = "move";
        onDragItem({ kind: item.kind, uid: item.uid });
      }}
      onDragEnd={() => onDragItem(null)}
      onDragOver={(event) => {
        if (item && draggedItem?.kind === item.kind) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!item || !draggedItem || draggedItem.kind !== item.kind) return;
        event.preventDefault();
        onDropItem(item.kind, draggedItem.uid, item.uid);
        onDragItem(null);
      }}
    >
      <div className="group flex items-center">
        <button
          type="button"
          onClick={() => onToggle(node.entry.path)}
          onKeyDown={(event) => {
            if (!item || !event.altKey) return;
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              move(event.key === "ArrowUp" ? -1 : 1);
            }
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/30",
            rootGroup && "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
            !rootGroup && "text-xs font-medium",
          )}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          aria-expanded={isExpanded}
        >
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", isExpanded && "rotate-90")} />
          {isExpanded ? <FolderOpen className="size-3.5 shrink-0 text-primary" /> : <Folder className="size-3.5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{rootGroup ? groupLabel(node.entry.path) : node.label}</span>
          <span className="font-mono text-[9px] font-normal text-muted-foreground">{node.fileCount}</span>
        </button>
        {rootKind && onMutate ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-1 size-6"
            disabled={structureBusy}
            aria-label={`新建 ${groupLabel(node.entry.path)}`}
            onClick={() => onMutate({ op: "create", kind: rootKind })}
          >
            <Plus className="size-3.5" />
          </Button>
        ) : null}
        {item && onMutate ? (
          <ItemActionsMenu
            kind={item.kind}
            name={itemDisplayName(item)}
            disabled={structureBusy}
            canMoveUp={itemIndex > 0}
            canMoveDown={itemIndex >= 0 && itemIndex < collection.length - 1}
            onRename={rename}
            onDuplicate={() => onMutate({ op: "duplicate", kind: item.kind, uid: item.uid })}
            onDelete={remove}
            onMoveUp={() => move(-1)}
            onMoveDown={() => move(1)}
          />
        ) : null}
      </div>
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
              structure={structure}
              structureBusy={structureBusy}
              searchActive={searchActive}
              onMutate={onMutate}
              draggedItem={draggedItem}
              onDragItem={onDragItem}
              onDropItem={onDropItem}
              onRequestRename={onRequestRename}
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
          : "text-foreground hover:bg-muted/80",
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

function rootKindFromPath(path: string): ProjectItemKind | null {
  if (path === "prompts") return "prompt";
  if (path === "regex") return "regex";
  if (path === "scripts") return "script";
  return null;
}

function collectionForKind(structure: ProjectStructure, kind: ProjectItemKind) {
  if (kind === "prompt") return structure.prompts;
  if (kind === "regex") return structure.regex;
  return structure.scripts;
}

function structureItemFromPath(structure: ProjectStructure, path: string) {
  const match = /^(prompts|regex|scripts)\/([^/]+)$/.exec(path);
  if (!match) return null;
  const kind: ProjectItemKind = match[1] === "prompts" ? "prompt" : match[1] === "regex" ? "regex" : "script";
  return collectionForKind(structure, kind).find((item) => item.uid === match[2]) ?? null;
}

function itemDisplayName(item: ReturnType<typeof structureItemFromPath> & {}) {
  if (item.kind === "prompt") return item.name || item.identifier || "未命名 Prompt";
  if (item.kind === "regex") return item.name || item.id || "未命名 Regex";
  return item.name || item.id || "未命名 Script";
}

function promptReferenceCount(promptOrder: unknown[], identifier: string) {
  let count = 0;
  for (const group of promptOrder) {
    if (!group || typeof group !== "object" || !Array.isArray((group as { order?: unknown }).order)) continue;
    for (const entry of (group as { order: unknown[] }).order) {
      if (entry && typeof entry === "object" && (entry as { identifier?: unknown }).identifier === identifier) count += 1;
    }
  }
  return count;
}
