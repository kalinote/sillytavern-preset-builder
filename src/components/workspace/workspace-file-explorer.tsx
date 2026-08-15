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
import { memo, useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface ExplorerFile {
  path: string;
  type: "file" | "directory";
  size: number;
  updatedAt?: string;
}

interface WorkspaceFileExplorerProps {
  projectName: string;
  projectVersion?: string;
  files: ExplorerFile[];
  activePath?: string;
  onSelect: (path: string) => void;
  onOpenProjects: () => void;
}

const groupOrder = ["prompts", "regex", "scripts", "snapshots", "output", "project"];

export const WorkspaceFileExplorer = memo(function WorkspaceFileExplorer({
  projectName,
  projectVersion,
  files,
  activePath,
  onSelect,
  onOpenProjects,
}: WorkspaceFileExplorerProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(["snapshots", "output"]),
  );

  const grouped = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const groups = new Map<string, ExplorerFile[]>();

    for (const file of files) {
      if (file.type !== "file") continue;
      if (normalized && !file.path.toLowerCase().includes(normalized)) continue;
      const root = file.path.includes("/") ? file.path.split("/")[0] : "project";
      const items = groups.get(root) ?? [];
      items.push(file);
      groups.set(root, items);
    }

    return [...groups.entries()].sort(
      ([left], [right]) => groupRank(left) - groupRank(right),
    );
  }, [files, query]);

  const toggleGroup = (group: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  return (
    <aside className="flex h-full w-[292px] shrink-0 flex-col border-r border-border bg-sidebar">
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
              {projectVersion && <Badge variant="blue">{projectVersion}</Badge>}
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
            placeholder="搜索工程文件…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {grouped.map(([group, groupFiles]) => {
          const isCollapsed = collapsed.has(group);
          return (
            <section key={group} className="mb-2">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:bg-muted/70"
              >
                {isCollapsed ? (
                  <Folder className="size-3.5" />
                ) : (
                  <FolderOpen className="size-3.5 text-primary" />
                )}
                {groupLabel(group)}
                <span className="ml-auto font-mono text-[9px] font-normal">
                  {groupFiles.length}
                </span>
              </button>

              {!isCollapsed && (
                <div className="mt-0.5 space-y-0.5">
                  {groupFiles.map((file) => (
                    <FileRow
                      key={file.path}
                      file={file}
                      active={activePath === file.path}
                      onClick={() => onSelect(file.path)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {grouped.length === 0 && (
          <div className="px-4 py-12 text-center text-xs text-muted-foreground">
            没有符合条件的工程文件
          </div>
        )}
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

function FileRow({
  file,
  active,
  onClick,
}: {
  file: ExplorerFile;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = fileIcon(file.path);
  const segments = file.path.split("/");
  const filename = segments.at(-1) ?? file.path;
  const context = segments.length > 2 ? segments.at(-2) : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
        active
          ? "bg-primary-soft text-foreground"
          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", active && "text-primary")} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{filename}</span>
        {context && (
          <span className="block truncate font-mono text-[9px] text-muted-foreground/75">
            {context}
          </span>
        )}
      </span>
      {file.size > 1_000_000 && <Badge variant="amber">大文件</Badge>}
    </button>
  );
}

function groupRank(group: string) {
  const rank = groupOrder.indexOf(group);
  return rank === -1 ? groupOrder.length : rank;
}

function groupLabel(group: string) {
  const labels: Record<string, string> = {
    prompts: "Prompts",
    regex: "Regex",
    scripts: "Scripts",
    snapshots: "只读快照",
    output: "构建输出",
    project: "工程配置",
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
