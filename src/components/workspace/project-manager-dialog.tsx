import {
  Braces,
  Check,
  FileArchive,
  FileJson2,
  FolderOpen,
  LoaderCircle,
  Plus,
  RadioTower,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

export interface ProjectChoice {
  id: string;
  name: string;
  version?: string;
  source?: string;
  updatedAt?: string;
}

export interface StProjectSourceChoice {
  connectionId: string;
  stVersion: string;
  bridgeVersion: string;
  presetName?: string;
  contextLabel?: string;
}

interface ProjectManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectChoice[];
  activeProjectId?: string;
  busy?: boolean;
  error?: string;
  stConnections: StProjectSourceChoice[];
  onSelect: (projectId: string) => void | Promise<void>;
  onCreate: (input: { name: string; version?: string }) => void | Promise<void>;
  onImport: (input: {
    name: string;
    version?: string;
    file: File;
    sourcePresetName?: string;
  }) => void | Promise<void>;
  onImportArchive: (input: {
    name?: string;
    version?: string;
    file: File;
  }) => void | Promise<void>;
  onCreateFromSt: (input: {
    connectionId: string;
    name?: string;
    version?: string;
  }) => void | Promise<void>;
}

export function ProjectManagerDialog({
  open,
  onOpenChange,
  projects,
  activeProjectId,
  busy,
  error,
  stConnections,
  onSelect,
  onCreate,
  onImport,
  onImportArchive,
  onCreateFromSt,
}: ProjectManagerDialogProps) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [selectedFile, setSelectedFile] = useState<File>();
  const [localError, setLocalError] = useState<string>();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedKind = selectedFile ? getImportKind(selectedFile) : undefined;
  const effectiveConnectionId =
    stConnections.find((connection) => connection.connectionId === selectedConnectionId)?.connectionId ??
    stConnections[0]?.connectionId;

  const createProject = async () => {
    if (!name.trim()) {
      setLocalError("请输入工程名称。");
      return;
    }
    setLocalError(undefined);
    await onCreate({ name: name.trim(), version: version.trim() || undefined });
    setName("");
    setVersion("");
  };

  const importProject = async () => {
    if (!selectedFile) {
      setLocalError("请选择一个 Preset JSON 或工程 ZIP 文件。");
      return;
    }
    try {
      setLocalError(undefined);
      const importKind = getImportKind(selectedFile);
      if (!importKind) {
        throw new Error("仅支持 .json Preset 或 .zip 工程包。");
      }

      if (importKind === "archive") {
        await onImportArchive({
          name: name.trim() || undefined,
          version: version.trim() || undefined,
          file: selectedFile,
        });
      } else {
        const text = await selectedFile.text();
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Preset 顶层必须是 JSON object。");
        }
        const fallbackName = selectedFile.name.replace(/\.json$/i, "");
        await onImport({
          name: name.trim() || fallbackName,
          version: version.trim() || undefined,
          file: selectedFile,
          sourcePresetName: fallbackName,
        });
      }
      setSelectedFile(undefined);
      setName("");
      setVersion("");
      if (inputRef.current) inputRef.current.value = "";
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "无法导入所选文件。");
    }
  };

  const createFromSt = async () => {
    if (!effectiveConnectionId) {
      setLocalError("当前没有可用的 SillyTavern 连接。");
      return;
    }
    setLocalError(undefined);
    await onCreateFromSt({
      connectionId: effectiveConnectionId,
      name: name.trim() || undefined,
      version: version.trim() || undefined,
    });
    setName("");
    setVersion("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Braces className="size-5" />
          </div>
          <DialogTitle>工程管理</DialogTitle>
          <DialogDescription>
            工程保存在服务端工作区。可从已连接 ST 的当前 preset 建立快照、导入文件或新建空白工程。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={projects.length ? "projects" : stConnections.length ? "st" : "import"}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
            <TabsTrigger value="projects">已有工程</TabsTrigger>
            <TabsTrigger value="st">从 ST 创建</TabsTrigger>
            <TabsTrigger value="import">导入文件</TabsTrigger>
            <TabsTrigger value="create">空白工程</TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="max-h-80 overflow-y-auto py-3">
            <div className="space-y-2">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void onSelect(project.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30",
                    project.id === activeProjectId
                      ? "border-primary/25 bg-primary-soft/50"
                      : "border-border bg-surface",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FolderOpen className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{project.name}</span>
                      {project.version && <Badge variant="blue">{project.version}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {project.source ?? "工程"} · {project.updatedAt ? new Date(project.updatedAt).toLocaleString() : "尚未编辑"}
                    </span>
                  </span>
                  {project.id === activeProjectId && <Check className="size-4 text-success" />}
                </button>
              ))}
              {!projects.length && (
                <div className="py-10 text-center text-xs text-muted-foreground">
                  还没有工程，请导入 JSON 或新建空白工程。
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="st" className="space-y-4 py-4">
            <div className="rounded-xl border border-primary/15 bg-primary-soft/30 p-4 text-xs leading-5 text-muted-foreground">
              单向拉取所选连接的完整 Chat Completion preset，并创建一次性工程快照；不会修改 ST，也不会建立持续同步。快照中的 proxy_password、reverse_proxy、custom headers 等连接字段会被写入工程，请按敏感配置管理。
            </div>
            <div className="space-y-2">
              {stConnections.map((connection) => {
                const selected = connection.connectionId === effectiveConnectionId;
                return (
                  <button
                    key={connection.connectionId}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => setSelectedConnectionId(connection.connectionId)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                      selected ? "border-primary/30 bg-primary-soft/45" : "border-border bg-surface hover:border-primary/25",
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-success shadow-xs">
                      <RadioTower className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        ST {connection.stVersion}
                        <Badge variant="green">在线</Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {connection.presetName ?? "当前 preset 名称将在拉取后确定"}
                        {connection.contextLabel ? ` · ${connection.contextLabel}` : ""}
                        {` · Bridge ${connection.bridgeVersion}`}
                      </span>
                    </span>
                    {selected ? <Check className="size-4 text-success" /> : null}
                  </button>
                );
              })}
              {!stConnections.length ? (
                <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                  没有在线 ST 连接。请返回连接页重新配对。
                </div>
              ) : null}
            </div>
            <ProjectFields name={name} version={version} onName={setName} onVersion={setVersion} namePlaceholder="留空使用 ST 当前 preset 名称" />
            <Button className="w-full" disabled={busy || !effectiveConnectionId} onClick={() => void createFromSt()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <RadioTower />}
              从 ST 当前 preset 创建工程
            </Button>
          </TabsContent>

          <TabsContent value="import" className="space-y-4 py-4">
            <button
              type="button"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                inputRef.current?.click();
              }}
              className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary-soft/25 px-5 py-8 text-center outline-none transition-colors hover:bg-primary-soft/45 focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-surface text-primary shadow-xs">
                {selectedKind === "archive" ? (
                  <FileArchive className="size-5" />
                ) : selectedFile ? (
                  <FileJson2 className="size-5" />
                ) : (
                  <Upload className="size-5" />
                )}
              </span>
              <span className="mt-3 text-sm font-medium">
                {selectedFile?.name ?? "选择 Preset JSON 或工程 ZIP"}
              </span>
              <span className="mt-1 text-[11px] text-muted-foreground">
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                  : "JSON 会拆分为新工程；ZIP 会恢复完整工程副本"}
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".json,.zip,application/json,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(event) => setSelectedFile(event.target.files?.[0])}
            />
            {selectedKind === "archive" && (
              <div className="rounded-xl border border-primary/15 bg-primary-soft/30 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                工程包会作为新工程导入并生成新的工程 ID，不会覆盖服务器中的同名工程。名称和 Version 留空时沿用包内配置。
              </div>
            )}
            <ProjectFields name={name} version={version} onName={setName} onVersion={setVersion} />
            <Button className="w-full" disabled={busy || !selectedFile} onClick={() => void importProject()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {selectedKind === "archive" ? "导入工程包副本" : "导入并创建拆分工程"}
            </Button>
          </TabsContent>

          <TabsContent value="create" className="space-y-4 py-4">
            <div className="rounded-xl border border-border bg-muted/35 p-4 text-xs leading-5 text-muted-foreground">
              空白工程会创建标准 Chat Completion preset 基础结构，version 可以留空并稍后维护。
            </div>
            <ProjectFields name={name} version={version} onName={setName} onVersion={setVersion} />
            <Button className="w-full" disabled={busy} onClick={() => void createProject()}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Plus />}
              创建空白工程
            </Button>
          </TabsContent>
        </Tabs>

        {(localError || error) && (
          <div className="rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs text-destructive">
            {localError ?? error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getImportKind(file: File): "json" | "archive" | undefined {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".zip")) return "archive";
  if (lowerName.endsWith(".json")) return "json";
  return undefined;
}

function ProjectFields({
  name,
  version,
  onName,
  onVersion,
  namePlaceholder = "默认使用 JSON 文件名",
}: {
  name: string;
  version: string;
  onName: (value: string) => void;
  onVersion: (value: string) => void;
  namePlaceholder?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
      <label>
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          工程名称
        </span>
        <Input value={name} onChange={(event) => onName(event.target.value)} placeholder={namePlaceholder} />
      </label>
      <label>
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Version（可选）
        </span>
        <Input value={version} onChange={(event) => onVersion(event.target.value)} placeholder="例如 v18" />
      </label>
    </div>
  );
}
