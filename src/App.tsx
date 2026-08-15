import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  LoaderCircle,
  PanelLeft,
  PanelRight,
  RadioTower,
  Server,
} from "lucide-react";
import { toast } from "sonner";

import { ConnectionDialog } from "./components/app/connection-dialog";
import { ConnectionGate } from "./components/app/connection-gate";
import { MobileNav, type MobileView } from "./components/app/mobile-nav";
import { DESKTOP_EDITOR_QUERY } from "./components/editor";
import {
  ProjectManagerDialog,
  type ProjectChoice,
  type StProjectSourceChoice,
} from "./components/workspace/project-manager-dialog";
import { ProjectEmptyState } from "./components/workspace/project-empty-state";
import {
  WorkspaceEditorPane,
  type SaveState,
} from "./components/workspace/workspace-editor-pane";
import {
  WorkspaceFileExplorer,
  type ExplorerFile,
} from "./components/workspace/workspace-file-explorer";
import { WorkspaceInspector } from "./components/workspace/workspace-inspector";
import { WorkspaceInspectorDrawer } from "./components/workspace/workspace-inspector-drawer";
import { WorkspaceTopBar } from "./components/workspace/workspace-top-bar";
import { Button } from "./components/ui/button";
import { TooltipProvider } from "./components/ui/tooltip";
import { useProjectWorkspace } from "./hooks/use-project-workspace";
import { useStBridge } from "./hooks/use-st-bridge";
import type { ProjectExportResult } from "./lib/project-api";
import { StBridgeApiError } from "./lib/st-bridge-api";

export default function App() {
  const [backendOnline, setBackendOnline] = useState(false);
  const bridge = useStBridge({
    enabled: backendOnline,
    onError: (error) => {
      if (error instanceof StBridgeApiError && error.status === 0) {
        setBackendOnline(false);
      }
    },
  });
  const workspace = useProjectWorkspace({
    autoLoad: Boolean(bridge.activeConnection),
    autosaveDelay: 850,
    onError: (error) => {
      if (!error.message.includes("project service")) {
        toast.error("工程操作失败", { description: error.message });
      }
    },
  });
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("editor");
  const [operationBusy, setOperationBusy] = useState(false);
  const inspectorDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const clearWorkspaceError = workspace.clearError;
  const desktopLayout = useMediaQuery(DESKTOP_EDITOR_QUERY, true);
  const wideInspectorLayout = useMediaQuery("(min-width: 1280px)", true);
  const mediumInspectorLayout = desktopLayout && !wideInspectorLayout;

  useEffect(() => {
    if (!mediumInspectorLayout) setInspectorDrawerOpen(false);
  }, [mediumInspectorLayout]);

  const checkBackend = useCallback(async () => {
    try {
      const response = await fetch("/api/health", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setBackendOnline(true);
      clearWorkspaceError();
      return true;
    } catch {
      setBackendOnline(false);
      return false;
    }
  }, [clearWorkspaceError]);

  useEffect(() => {
    void checkBackend();
  }, [checkBackend]);

  const retryBackend = async () => {
    const online = await checkBackend();
    if (!online) {
      toast.error("仍无法连接工程服务", {
        description: "请确认 Node 服务已启动，并检查 Vite /api 代理。",
      });
      return;
    }
    try {
      const connections = await bridge.refreshConnections();
      if (!connections.some((connection) => connection.status === "connected")) return;
      const projects = await workspace.refreshProjects();
      if (!workspace.project && projects[0]) {
        await workspace.openProject(projects[0].id);
      }
    } catch {
      // Hook already exposes the detailed error.
    }
  };

  const projectChoices = useMemo<ProjectChoice[]>(
    () =>
      workspace.projects.map((project) => ({
        id: project.id,
        name: project.name,
        version: project.version ?? undefined,
        source: project.source,
        updatedAt: project.updatedAt,
      })),
    [workspace.projects],
  );
  const stProjectSources = useMemo<StProjectSourceChoice[]>(
    () =>
      bridge.connectedConnections.map((connection) => ({
        connectionId: connection.connectionId,
        stVersion: connection.st.version,
        bridgeVersion: connection.bridgeVersion,
        presetName: contextString(connection.context, "currentPresetName") ?? undefined,
        contextLabel: stContextSummary(connection.context) || undefined,
      })),
    [bridge.connectedConnections],
  );
  const stContextLabel = stContextSummary(bridge.activeConnection?.context);

  const mappedSaveState: SaveState =
    workspace.saveState === "saving"
      ? "saving"
      : workspace.saveState === "dirty"
        ? "dirty"
        : workspace.saveState === "error"
          ? "error"
          : "saved";

  const runOperation = async (
    operation: () => Promise<void>,
    successMessage?: string,
  ) => {
    setOperationBusy(true);
    try {
      await operation();
      setBackendOnline(true);
      workspace.clearError();
      if (successMessage) toast.success(successMessage);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "发生未知工程错误。";
      toast.error("工程操作失败", { description: message });
    } finally {
      setOperationBusy(false);
    }
  };

  const handleExport = () =>
    runOperation(async () => {
      const result = await workspace.exportProject({
        version: workspace.project?.version,
      });
      triggerExportDownload(result);
      toast.success("Preset JSON 已构建", {
        description: `${result.filename} · ${formatBytes(result.size)}`,
      });
    });

  const handleDownloadProject = () =>
    runOperation(async () => {
      const archive = await workspace.downloadProjectArchive();
      triggerBlobDownload(archive.blob, archive.filename);
      toast.success("工程包已生成", {
        description: `${archive.filename} · ${formatBytes(archive.size)}`,
      });
    });

  const activePath = workspace.activeFile?.path ?? "";
  const activeContent = workspace.content;
  const activeSize =
    workspace.activeFile?.size ?? new TextEncoder().encode(activeContent).length;
  const activeLineCount = useDebouncedLineCount(activeContent);
  const explorerFiles = useMemo<ExplorerFile[]>(
    () =>
      workspace.files.map((file) => ({
        path: file.path,
        type: file.kind,
        size: file.size ?? 0,
        updatedAt: file.updatedAt ?? undefined,
      })),
    [workspace.files],
  );
  const openProjectManager = useCallback(() => {
    if (!bridge.activeConnection) {
      setConnectionDialogOpen(true);
      return;
    }
    setProjectDialogOpen(true);
  }, [bridge.activeConnection]);
  const selectWorkspaceFile = workspace.selectFile;
  const handleDesktopFileSelect = useCallback(
    (path: string) => {
      void selectWorkspaceFile(path).catch(() => undefined);
    },
    [selectWorkspaceFile],
  );
  const handleMobileFileSelect = useCallback(
    (path: string) => {
      void selectWorkspaceFile(path)
        .then(() => setMobileView("editor"))
        .catch(() => undefined);
    },
    [selectWorkspaceFile],
  );

  return (
    <TooltipProvider delayDuration={350}>
      <div
        className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background text-foreground"
        data-workbench-layout={desktopLayout ? "desktop" : "mobile"}
      >
        <WorkspaceTopBar
          projectName={workspace.project?.name ?? "未打开工程"}
          projectVersion={workspace.project?.version ?? undefined}
          hasProject={Boolean(workspace.project)}
          saveState={mappedSaveState}
          backendOnline={backendOnline}
          stConnection={bridge.activeConnection}
          stContextLabel={stContextLabel || undefined}
          pushAvailable={false}
          onToggleExplorer={() => setExplorerVisible((value) => !value)}
          onOpenProjects={openProjectManager}
          onOpenConnection={() => setConnectionDialogOpen(true)}
          onExport={() => void handleExport()}
          onDownloadProject={() => void handleDownloadProject()}
          onPush={() => {
            toast.info("Preset 推送尚未实现", {
              description: "Bridge v1 当前只支持连接状态与从 ST 当前 preset 创建工程。",
            });
          }}
        />

        {!backendOnline || !bridge.activeConnection ? (
          <ConnectionGate
            backendOnline={backendOnline}
            pairing={bridge.pairing}
            isPairing={bridge.isPairing}
            isDownloadingExtension={bridge.isDownloadingExtension}
            isCheckingConnections={bridge.isLoading}
            error={bridge.error?.message}
            onCreatePairing={bridge.createPairing}
            onDownloadExtension={bridge.downloadExtensionArchive}
            onRetryBackend={retryBackend}
            onRetryConnections={bridge.retry}
          />
        ) : !workspace.project ? (
          <ProjectEmptyState
            backendOnline={backendOnline}
            loading={workspace.isLoading || operationBusy}
            error={workspace.error?.message}
            onOpenProjects={openProjectManager}
            onRetry={() => void retryBackend()}
          />
        ) : !workspace.activeFile ? (
          <WorkspaceLoading
            loading={workspace.isLoading}
            onOpenExplorer={() => setProjectDialogOpen(true)}
          />
        ) : (
          <>
            {desktopLayout ? (
              <div className="flex min-h-0 flex-1">
              {explorerVisible && (
                <WorkspaceFileExplorer
                  projectName={workspace.project.name}
                  projectVersion={workspace.project.version ?? undefined}
                  files={explorerFiles}
                  activePath={activePath}
                  onSelect={handleDesktopFileSelect}
                  onOpenProjects={openProjectManager}
                />
              )}

              <WorkspaceEditorPane
                viewStateKey={`${workspace.project.id}:${activePath}`}
                path={activePath}
                content={activeContent}
                size={activeSize}
                lineCount={activeLineCount}
                revision={workspace.activeFile.revision ?? undefined}
                saveState={mappedSaveState}
                error={workspace.error?.message}
                onChange={workspace.setContent}
                onFlush={workspace.handleEditorBlur}
              />

              {inspectorVisible && (
                <div
                  id="desktop-workspace-inspector"
                  className="hidden min-h-0 xl:flex"
                  data-testid="desktop-inspector-panel"
                >
                  <WorkspaceInspector
                    path={activePath}
                    content={activeContent}
                    size={activeSize}
                    lineCount={activeLineCount}
                    revision={workspace.activeFile.revision}
                    saveState={mappedSaveState}
                    backendOnline={backendOnline}
                  />
                </div>
              )}

              <div className="absolute bottom-10 right-3 z-20 hidden xl:block">
                <Button
                  variant="secondary"
                  size="icon-sm"
                  onClick={() => setInspectorVisible((value) => !value)}
                  aria-label="切换检查器"
                  aria-expanded={inspectorVisible}
                  aria-controls="desktop-workspace-inspector"
                  data-testid="desktop-inspector-toggle"
                >
                  {inspectorVisible ? <PanelRight /> : <PanelLeft />}
                </Button>
              </div>

              {mediumInspectorLayout && (
                <>
                  <div className="absolute bottom-10 right-3 z-30 hidden md:flex xl:hidden">
                    <Button
                      ref={inspectorDrawerTriggerRef}
                      variant="secondary"
                      className="min-h-11 gap-2 rounded-xl px-3 shadow-lg"
                      onClick={() => setInspectorDrawerOpen(true)}
                      aria-label="打开检查器与静态预览"
                      aria-haspopup="dialog"
                      aria-expanded={inspectorDrawerOpen}
                      aria-controls="workspace-inspector-drawer"
                      data-testid="medium-inspector-trigger"
                    >
                      <Eye />
                      检查器
                    </Button>
                  </div>
                  <WorkspaceInspectorDrawer
                    open={inspectorDrawerOpen}
                    onOpenChange={setInspectorDrawerOpen}
                    triggerRef={inspectorDrawerTriggerRef}
                    path={activePath}
                    content={activeContent}
                    size={activeSize}
                    lineCount={activeLineCount}
                    revision={workspace.activeFile.revision}
                    saveState={mappedSaveState}
                    backendOnline={backendOnline}
                  />
                </>
              )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
              {mobileView === "structure" && (
                <div className="mobile-full-panel flex min-h-0 w-full">
                  <WorkspaceFileExplorer
                    projectName={workspace.project.name}
                    projectVersion={workspace.project.version ?? undefined}
                    files={explorerFiles}
                    activePath={activePath}
                    onSelect={handleMobileFileSelect}
                    onOpenProjects={openProjectManager}
                  />
                </div>
              )}
              {mobileView === "editor" && (
                <WorkspaceEditorPane
                  viewStateKey={`${workspace.project.id}:${activePath}`}
                  path={activePath}
                  content={activeContent}
                  size={activeSize}
                  lineCount={activeLineCount}
                  revision={workspace.activeFile.revision ?? undefined}
                  saveState={mappedSaveState}
                  error={workspace.error?.message}
                  onChange={workspace.setContent}
                  onFlush={workspace.handleEditorBlur}
                />
              )}
              {mobileView === "preview" && (
                <WorkspaceInspector
                  className="w-full border-l-0"
                  path={activePath}
                  content={activeContent}
                  size={activeSize}
                  lineCount={activeLineCount}
                  revision={workspace.activeFile.revision}
                  saveState={mappedSaveState}
                  backendOnline={backendOnline}
                  initialTab="preview"
                />
              )}
              {mobileView === "runtime" && <RuntimeUnavailable />}
              </div>
            )}

            {!desktopLayout && (
              <MobileNav
                value={mobileView}
                onChange={setMobileView}
                connected={Boolean(bridge.activeConnection)}
                runtimeAvailable={false}
              />
            )}
          </>
        )}

        <ProjectManagerDialog
          open={projectDialogOpen}
          onOpenChange={setProjectDialogOpen}
          projects={projectChoices}
          activeProjectId={workspace.project?.id}
          busy={operationBusy || workspace.isLoading}
          error={workspace.error?.message}
          stConnections={stProjectSources}
          onSelect={(projectId) =>
            runOperation(async () => {
              await workspace.openProject(projectId);
              setProjectDialogOpen(false);
            })
          }
          onCreate={(input) =>
            runOperation(async () => {
              await workspace.createProject(input);
              setProjectDialogOpen(false);
            }, "空白工程已创建")
          }
          onImport={(input) =>
            runOperation(async () => {
              await workspace.importProjectJson(input.file, {
                name: input.name,
                version: input.version,
              });
              setProjectDialogOpen(false);
            }, "Preset 已导入并拆分为工程")
          }
          onImportArchive={(input) =>
            runOperation(async () => {
              await workspace.importProjectArchive(input.file, {
                name: input.name,
                version: input.version,
              });
              setProjectDialogOpen(false);
            }, "工程包已作为新工程导入")
          }
          onCreateFromSt={(input) =>
            runOperation(async () => {
              await workspace.createProjectFromSt(input);
              await bridge.refreshConnections();
              setProjectDialogOpen(false);
            }, "已从 ST 当前 preset 创建工程快照")
          }
        />

        <ConnectionDialog
          open={connectionDialogOpen}
          onOpenChange={setConnectionDialogOpen}
          activeConnection={bridge.activeConnection}
          connections={bridge.connections}
          pairing={bridge.pairing}
          backendOnline={backendOnline}
          isLoading={bridge.isLoading}
          isPairing={bridge.isPairing}
          isDownloadingExtension={bridge.isDownloadingExtension}
          error={bridge.error?.message}
          onRefresh={bridge.refreshConnections}
          onCreatePairing={bridge.createPairing}
          onDownloadExtension={bridge.downloadExtensionArchive}
          onRetryBackend={retryBackend}
        />
      </div>
    </TooltipProvider>
  );
}

function WorkspaceLoading({
  loading,
  onOpenExplorer,
}: {
  loading: boolean;
  onOpenExplorer: () => void;
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
          {loading ? (
            <LoaderCircle className="size-5 animate-spin" />
          ) : (
            <Server className="size-5" />
          )}
        </span>
        <p className="mt-4 text-sm font-medium">
          {loading ? "正在读取工程…" : "工程中没有可编辑文件"}
        </p>
        {!loading && (
          <Button variant="secondary" className="mt-4" onClick={onOpenExplorer}>
            项目管理
          </Button>
        )}
      </div>
    </main>
  );
}

function RuntimeUnavailable() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <RadioTower className="size-5" />
        </span>
        <p className="mt-4 text-sm font-medium">ST 真实运行调试尚未实现</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Bridge v1 当前只接通连接状态和 preset 快照拉取；这里不会显示模拟运行数据。
        </p>
      </div>
    </main>
  );
}

function contextString(context: Record<string, unknown> | null | undefined, key: string) {
  const value = context?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function stContextSummary(context: Record<string, unknown> | null | undefined) {
  const presetName = contextString(context, "currentPresetName");
  const characterName = contextString(context, "characterName");
  const personaName = contextString(context, "personaName");
  const chatId = contextString(context, "chatId");
  return [presetName, characterName, personaName, chatId]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

function triggerExportDownload(result: ProjectExportResult) {
  if (result.kind === "download") {
    triggerBlobDownload(result.blob, result.filename);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = result.downloadUrl;
  anchor.download = result.filename;
  anchor.click();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function useMediaQuery(query: string, defaultMatches: boolean) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined"
      ? defaultMatches
      : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }
    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, [query]);

  return matches;
}

function useDebouncedLineCount(content: string) {
  const [lineCount, setLineCount] = useState(() => countLines(content));

  useEffect(() => {
    if (content.length < 1_000_000) {
      setLineCount(countLines(content));
      return;
    }

    const timer = window.setTimeout(() => {
      setLineCount(countLines(content));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [content]);

  return lineCount;
}

function countLines(content: string) {
  let count = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) count += 1;
  }
  return count;
}
