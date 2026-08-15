import {
  Braces,
  CheckCircle2,
  ChevronDown,
  Download,
  FileArchive,
  FileJson2,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  PanelLeft,
  Radio,
  RadioTower,
  Server,
} from "lucide-react";

import type { StConnection } from "../../lib/st-bridge-api";
import type { SaveState } from "./workspace-editor-pane";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface WorkspaceTopBarProps {
  projectName: string;
  projectVersion?: string;
  hasProject: boolean;
  saveState: SaveState;
  backendOnline: boolean;
  stConnection: StConnection | null;
  stContextLabel?: string;
  pushAvailable?: boolean;
  onToggleExplorer: () => void;
  onOpenProjects: () => void;
  onExport: () => void;
  onDownloadProject: () => void;
  onOpenConnection: () => void;
  onPush: () => void;
}

export function WorkspaceTopBar({
  projectName,
  projectVersion,
  hasProject,
  saveState,
  backendOnline,
  stConnection,
  stContextLabel,
  pushAvailable = false,
  onToggleExplorer,
  onOpenProjects,
  onExport,
  onDownloadProject,
  onOpenConnection,
  onPush,
}: WorkspaceTopBarProps) {
  const stConnected = stConnection?.status === "connected";
  return (
    <header className="relative z-40 flex h-15 shrink-0 items-center border-b border-border bg-surface px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden md:inline-flex"
          onClick={onToggleExplorer}
          aria-label="切换工程文件面板"
        >
          <PanelLeft />
        </Button>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Braces className="size-4" />
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-semibold tracking-tight">Preset Studio</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Project Workspace
          </p>
        </div>
        <span className="mx-1 hidden h-5 w-px bg-border lg:block" />
        <button
          type="button"
          onClick={onOpenProjects}
          className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <span className="max-w-[42vw] truncate text-sm font-medium sm:max-w-72">
            {projectName}
          </span>
          {projectVersion && (
            <Badge variant="blue" className="hidden lg:inline-flex">
              {projectVersion}
            </Badge>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {hasProject ? <SaveStatus state={saveState} /> : null}

        <Badge variant={backendOnline ? "green" : "red"} className="hidden lg:inline-flex">
          <Server className="size-3" />
          {backendOnline ? "工程服务正常" : "工程服务离线"}
        </Badge>

        <Button
          variant="secondary"
          size="sm"
          className="hidden h-10 sm:inline-flex"
          onClick={onOpenConnection}
          title={stConnected ? `ST ${stConnection.st.version} · ${stContextLabel ?? "无上下文摘要"}` : "打开 SillyTavern 配对"}
        >
          <Radio className={stConnected ? "text-success" : "text-destructive"} />
          <span className="hidden max-w-44 flex-col items-start xl:flex">
            <span>{stConnected ? `ST ${stConnection.st.version}` : "ST 未连接"}</span>
            <span className="max-w-full truncate text-[9px] font-normal text-muted-foreground">
              {stConnected ? (stContextLabel ?? `Bridge ${stConnection.bridgeVersion}`) : "点击查看配对"}
            </span>
          </span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="hidden md:inline-flex" disabled={!hasProject}>
              <Download />
              导出
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>工程输出</DropdownMenuLabel>
            <DropdownMenuItem onSelect={onExport} disabled={!hasProject}>
              <FileJson2 />
              构建并导出 Preset JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDownloadProject} disabled={!hasProject}>
              <FileArchive />
              下载工程包
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenProjects}>
              <FolderOpen />
              项目管理
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          onClick={onPush}
          disabled={!stConnected || !pushAvailable}
          title={!pushAvailable ? "Preset 推送尚未实现" : undefined}
          className="hidden md:inline-flex"
        >
          <RadioTower />
          推送至 ST
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="md:hidden">
              <MoreHorizontal />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpenProjects}>
              <FolderOpen />
              项目管理
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenConnection}>
              <Radio />
              {stConnected ? `ST ${stConnection.st.version} 连接详情` : "连接 SillyTavern"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExport} disabled={!hasProject}>
              <FileJson2 />
              导出 JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDownloadProject} disabled={!hasProject}>
              <FileArchive />
              下载工程包
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPush} disabled={!stConnected || !pushAvailable}>
              <RadioTower />
              推送至 ST（待实现）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="hidden items-center gap-1.5 text-xs text-primary lg:flex">
        <LoaderCircle className="size-3.5 animate-spin" />
        正在保存…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="hidden items-center gap-1.5 text-xs text-destructive lg:flex">
        <span className="size-2 rounded-full bg-destructive" />
        保存失败
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span className="hidden items-center gap-1.5 text-xs text-warning lg:flex">
        <span className="size-2 rounded-full bg-warning" />
        等待自动保存
      </span>
    );
  }
  return (
    <span className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
      <CheckCircle2 className="size-3.5 text-success" />
      工程已保存
    </span>
  );
}
