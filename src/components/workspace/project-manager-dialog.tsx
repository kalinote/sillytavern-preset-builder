import {
  Braces,
  Check,
  FileArchive,
  FileJson2,
  FolderOpen,
  LoaderCircle,
  Plus,
  RadioTower,
  RefreshCw,
  Server,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { runSafely } from "../../lib/async";
import type { StPresetCatalog, StSession } from "../../lib/st-api";
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

interface ProjectManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectChoice[];
  activeProjectId?: string;
  busy?: boolean;
  error?: string;
  stSession: StSession | null;
  stCatalog: StPresetCatalog | null;
  isLoadingStPresets?: boolean;
  onSelect: (projectId: string) => void | Promise<void>;
  onCloseProject: () => void | Promise<void>;
  onDeleteProject: (project: ProjectChoice) => void;
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
    presetName: string;
    name?: string;
    version?: string;
  }) => void | Promise<void>;
  onRefreshStPresets: () => void | Promise<unknown>;
  onOpenStConnection: () => void;
}

export function ProjectManagerDialog({
  open,
  onOpenChange,
  projects,
  activeProjectId,
  busy,
  error,
  stSession,
  stCatalog,
  isLoadingStPresets,
  onSelect,
  onCloseProject,
  onDeleteProject,
  onCreate,
  onImport,
  onImportArchive,
  onCreateFromSt,
  onRefreshStPresets,
  onOpenStConnection,
}: ProjectManagerDialogProps) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [selectedFile, setSelectedFile] = useState<File>();
  const [localError, setLocalError] = useState<string>();
  const [selectedPresetName, setSelectedPresetName] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedKind = selectedFile ? getImportKind(selectedFile) : undefined;
  const presets = stCatalog?.presets ?? [];
  const persistedPresetName = stCatalog?.persistedSelectedPresetName ?? undefined;
  const effectivePresetName =
    presets.find((preset) => preset.name === selectedPresetName)?.name ??
    presets.find((preset) => preset.name === persistedPresetName)?.name ??
    presets[0]?.name;

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
    if (stSession?.status !== "connected") {
      setLocalError("请先连接 SillyTavern。");
      return;
    }
    if (!effectivePresetName) {
      setLocalError("请选择一个 Chat Completion preset。");
      return;
    }
    setLocalError(undefined);
    await onCreateFromSt({
      presetName: effectivePresetName,
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
            工程保存在服务端工作区。可从 ST 显式选择 preset 建立快照，也可导入文件或新建空白工程。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={projects.length ? "projects" : stSession?.status === "connected" ? "st" : "import"}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
            <TabsTrigger value="projects">已有工程</TabsTrigger>
            <TabsTrigger value="st">从 ST 创建</TabsTrigger>
            <TabsTrigger value="import">导入文件</TabsTrigger>
            <TabsTrigger value="create">空白工程</TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="max-h-80 overflow-y-auto py-3">
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30",
                    project.id === activeProjectId
                      ? "border-primary/25 bg-primary-soft/50"
                      : "border-border bg-surface",
                  )}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runSafely(() => onSelect(project.id))}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
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
                  {project.id === activeProjectId ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      onClick={() => runSafely(onCloseProject)}
                      aria-label={`关闭工程 ${project.name}`}
                      title="关闭工程"
                    >
                      <XCircle />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => onDeleteProject(project)}
                    aria-label={`删除工程 ${project.name}`}
                    title="永久删除服务器工程"
                  >
                    <Trash2 />
                  </Button>
                </div>
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
              从服务端 catalog 明确选择一个完整 Chat Completion preset，并创建一次性工程快照；不会修改 ST，也不会建立持续同步。preset 自带的敏感连接字段会进入工程，请按敏感配置管理。
            </div>
            {stSession?.status === "connected" ? (
              <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                    <Server className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">ST {stSession.version ?? "未知版本"}</p>
                      <Badge variant="green">HTTP 已连接</Badge>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">{stSession.origin}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" disabled={isLoadingStPresets} onClick={() => runSafely(onRefreshStPresets)} aria-label="刷新 preset 列表">
                    <RefreshCw className={isLoadingStPresets ? "animate-spin" : undefined} />
                  </Button>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Chat Completion preset</span>
                  <select
                    value={effectivePresetName ?? ""}
                    onChange={(event) => setSelectedPresetName(event.target.value)}
                    disabled={busy || isLoadingStPresets || !presets.length}
                    className="flex h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  >
                    {!presets.length ? <option value="">没有可用 preset</option> : null}
                    {presets.map((preset) => (
                      <option key={preset.name} value={preset.name}>
                        {preset.name} · {formatBytes(preset.size)}
                      </option>
                    ))}
                  </select>
                </label>
                {stCatalog ? (
                  <p className="text-[10px] text-muted-foreground">
                    {presets.length} 个 preset · catalog 更新于 {formatDate(stCatalog.refreshedAt)}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center">
                <p className="text-xs text-muted-foreground">尚未建立 SillyTavern HTTP 会话。</p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={onOpenStConnection}>
                  <Server />
                  打开连接设置
                </Button>
              </div>
            )}
            <ProjectFields name={name} version={version} onName={setName} onVersion={setVersion} namePlaceholder="留空使用所选 preset 名称" />
            <Button className="w-full" disabled={busy || !effectivePresetName || stSession?.status !== "connected"} onClick={() => runSafely(createFromSt)}>
              {busy ? <LoaderCircle className="animate-spin" /> : <RadioTower />}
              从所选 preset 创建工程
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
            <Button className="w-full" disabled={busy || !selectedFile} onClick={() => runSafely(importProject)}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {selectedKind === "archive" ? "导入工程包副本" : "导入并创建拆分工程"}
            </Button>
          </TabsContent>

          <TabsContent value="create" className="space-y-4 py-4">
            <div className="rounded-xl border border-border bg-muted/35 p-4 text-xs leading-5 text-muted-foreground">
              空白工程会创建标准 Chat Completion preset 基础结构，version 可以留空并稍后维护。
            </div>
            <ProjectFields name={name} version={version} onName={setName} onVersion={setVersion} />
            <Button className="w-full" disabled={busy} onClick={() => runSafely(createProject)}>
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
