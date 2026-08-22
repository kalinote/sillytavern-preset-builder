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
import { MobileNav, type MobileView } from "./components/app/mobile-nav";
import { PushDialog } from "./components/app/push-dialog";
import { DESKTOP_EDITOR_QUERY } from "./components/editor";
import {
  ProjectManagerDialog,
  type ProjectChoice,
} from "./components/workspace/project-manager-dialog";
import { ProjectEmptyState } from "./components/workspace/project-empty-state";
import {
  WorkspaceEditorPane,
  type SaveState,
} from "./components/workspace/workspace-editor-pane";
import { WorkspaceFileExplorer } from "./components/workspace/workspace-file-explorer";
import { WorkspaceInspector } from "./components/workspace/workspace-inspector";
import { WorkspaceInspectorDrawer } from "./components/workspace/workspace-inspector-drawer";
import { ResizableSidebar } from "./components/workspace/resizable-sidebar";
import { WorkspaceTopBar } from "./components/workspace/workspace-top-bar";
import { ProjectSettingsDialog } from "./components/workspace/project-settings-dialog";
import { SnapshotHistoryDialog } from "./components/workspace/snapshot-history-dialog";
import { TextInputDialog } from "./components/workspace/text-input-dialog";
import {
  DeleteProjectDialog,
  ExplicitDraftDialog,
} from "./components/workspace/workspace-workflow-dialogs";
import { Button } from "./components/ui/button";
import { TooltipProvider } from "./components/ui/tooltip";
import { useProjectWorkspace } from "./hooks/use-project-workspace";
import { useStConnection } from "./hooks/use-st-connection";
import { runSafely } from "./lib/async";
import type { JsonValue, ProjectExportResult, StructureMutation } from "./lib/project-api";
import { buildProjectResourceCatalog } from "./lib/project-resource-catalog";
import { useProjectPreviewRuntime } from "./preview/use-project-preview-runtime";

export default function App() {
  const [backendOnline, setBackendOnline] = useState(false);
  const [previewOrigin, setPreviewOrigin] = useState<string>();
  const st = useStConnection({
    enabled: backendOnline,
  });
  const workspace = useProjectWorkspace({
    autoLoad: backendOnline,
    autosaveDelay: 850,
    onError: (error) => {
      if (!error.message.includes("project service")) {
        toast.error("工程操作失败", { description: error.message });
      }
    },
  });
  const updateProjectSettings = workspace.updateProjectSettings;
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [snapshotCreateDialogOpen, setSnapshotCreateDialogOpen] = useState(false);
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("editor");
  const [operationBusy, setOperationBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftDialogOpen, setDraftDialogOpen] = useState(false);
  const [draftActionLabel, setDraftActionLabel] = useState("继续");
  const [pendingDelete, setPendingDelete] = useState<ProjectChoice | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const pendingWorkspaceActionRef = useRef<(() => void | Promise<void>) | null>(null);
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
      const health = await response.json() as {
        previewRuntime?: { enabled?: boolean; origin?: string };
      };
      setPreviewOrigin(
        health.previewRuntime?.enabled === true && typeof health.previewRuntime.origin === "string"
          ? health.previewRuntime.origin
          : undefined,
      );
      setBackendOnline(true);
      clearWorkspaceError();
      return true;
    } catch {
      setBackendOnline(false);
      setPreviewOrigin(undefined);
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
    await Promise.allSettled([
      st.refreshSession(),
      workspace.refreshProjects(),
    ]);
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
  const mappedSaveState: SaveState =
    workspace.saveState === "saving"
      ? "saving"
      : workspace.saveState === "dirty"
        ? "dirty"
        : workspace.saveState === "error"
          ? "error"
          : "saved";
  const previewRuntime = useProjectPreviewRuntime({
    project: workspace.project,
    structure: workspace.structure,
    activeFile: workspace.activeFile,
    content: workspace.content,
    saveState: mappedSaveState,
    previewOrigin,
  });
  const stopPreviewRuntime = previewRuntime.stop;

  const runOperation = useCallback(
    async (operation: () => Promise<void>, successMessage?: string) => {
      setOperationBusy(true);
      try {
        await operation();
        setBackendOnline(true);
        clearWorkspaceError();
        if (successMessage) toast.success(successMessage);
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "发生未知工程错误。";
        toast.error("工程操作失败", { description: message });
      } finally {
        setOperationBusy(false);
      }
    },
    [clearWorkspaceError],
  );

  const handleJavascriptEnabledChange = useCallback((enabled: boolean) => {
    if (!enabled) void stopPreviewRuntime(true);
    void runOperation(
      () => updateProjectSettings({ preview: { javascriptEnabled: enabled } }).then(() => undefined),
      enabled ? "已允许动态 JavaScript 预览" : "已关闭动态 JavaScript 预览",
    );
  }, [runOperation, stopPreviewRuntime, updateProjectSettings]);

  const requestWorkspaceAction = useCallback(
    (action: () => void | Promise<void>, actionLabel = "继续") => {
      if (workspace.hasExplicitDraft) {
        pendingWorkspaceActionRef.current = action;
        setDraftActionLabel(actionLabel);
        setDraftDialogOpen(true);
        return;
      }
      runSafely(action);
    },
    [workspace.hasExplicitDraft],
  );

  const continuePendingWorkspaceAction = useCallback(() => {
    const action = pendingWorkspaceActionRef.current;
    pendingWorkspaceActionRef.current = null;
    setDraftActionLabel("继续");
    setDraftDialogOpen(false);
    if (action) runSafely(action);
  }, []);

  const cancelPendingWorkspaceAction = useCallback(() => {
    pendingWorkspaceActionRef.current = null;
    setDraftActionLabel("继续");
    setDraftDialogOpen(false);
  }, []);

  const applyDraftAndContinue = useCallback(async () => {
    setDraftBusy(true);
    try {
      await workspace.flushSave();
      toast.success("完整 JSON 已应用并重新拆分");
      continuePendingWorkspaceAction();
    } catch (caught) {
      toast.error("完整 JSON 应用失败", {
        description: caught instanceof Error ? caught.message : "请检查 JSON 内容后重试。",
      });
    } finally {
      setDraftBusy(false);
    }
  }, [continuePendingWorkspaceAction, workspace]);

  const discardDraftAndContinue = useCallback(() => {
    workspace.discardChanges();
    continuePendingWorkspaceAction();
  }, [continuePendingWorkspaceAction, workspace]);

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

  const handleApplySourceJson = () =>
    runOperation(async () => {
      await workspace.flushSave();
    }, "完整 JSON 已应用并重新拆分");

  const handleStructureMutation = useCallback((mutation: StructureMutation) => {
    if (mutation.op === "set-prompt-order") {
      requestWorkspaceAction(() => workspace.setPromptOrder(mutation.promptOrder));
      return;
    }
    requestWorkspaceAction(() => runOperation(
      () => workspace.mutateStructure(mutation),
      mutation.op === "delete" ? "条目已删除，并已创建恢复快照" : "工程结构已更新",
    ));
  }, [requestWorkspaceAction, runOperation, workspace]);
  const handlePromptOrderChange = useCallback((promptOrder: JsonValue[], identifier: string) => {
    requestWorkspaceAction(() => workspace.setPromptOrder(promptOrder, identifier));
  }, [requestWorkspaceAction, workspace]);

  const handleValidate = () => runOperation(async () => {
    const result = await workspace.validateProject();
    const errors = result.diagnostics.filter((item) => item.severity === "error").length;
    const warnings = result.diagnostics.filter((item) => item.severity === "warning").length;
    if (errors) toast.error(`验证发现 ${errors} 个错误`, { description: "请在诊断页签中定位并修复。" });
    else toast.success("工程验证通过", { description: warnings ? `${warnings} 个警告允许继续导出` : "未发现构建问题" });
  });

  const handleCreateSnapshot = (label: string) => {
    setSnapshotCreateDialogOpen(false);
    requestWorkspaceAction(() => runOperation(async () => {
      await workspace.createSnapshot(label);
    }, "快照已创建"));
  };

  const handleRestoreSnapshot = (snapshotId: string) => {
    requestWorkspaceAction(() => runOperation(async () => {
      await workspace.restoreSnapshot(snapshotId);
      setSnapshotDialogOpen(false);
    }, "快照已恢复；恢复前状态已自动保存"), "恢复快照");
  };

  const handleDeleteSnapshot = (snapshotId: string) => {
    void runOperation(() => workspace.deleteSnapshot(snapshotId), "快照已永久删除");
  };

  const handleCloseProject = () =>
    runOperation(async () => {
      await workspace.closeProject();
      setPushDialogOpen(false);
      setInspectorDrawerOpen(false);
    }, "工程已关闭，服务器文件仍然保留");

  const requestDeleteProject = (project: ProjectChoice) => {
    setProjectDialogOpen(false);
    setPendingDelete(project);
  };

  const cancelDeleteProject = () => {
    if (deleteBusy) return;
    setPendingDelete(null);
    setProjectDialogOpen(true);
  };

  const confirmDeleteProject = async () => {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    try {
      await workspace.deleteProject(pendingDelete.id);
      toast.success(`工程“${pendingDelete.name}”已从服务器永久删除`);
      setPendingDelete(null);
      setProjectDialogOpen(true);
    } catch (caught) {
      toast.error("删除工程失败", {
        description: caught instanceof Error ? caught.message : "无法删除服务器工程。",
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const activePath = workspace.activeFile?.path ?? "";
  const activeContent = workspace.content;
  const activeSize =
    workspace.activeFile?.size ?? new TextEncoder().encode(activeContent).length;
  const activeLineCount = useDebouncedLineCount(activeContent);
  const diagnosticsBlocking = workspace.diagnostics.some((item) => item.severity === "error");
  const explorerFiles = useMemo(
    () => buildProjectResourceCatalog(workspace.files, workspace.structure),
    [workspace.files, workspace.structure],
  );
  const showProjectManager = useCallback(() => {
    setProjectDialogOpen(true);
    if (st.session?.status === "connected" && !st.catalog) {
      void st.refreshPresets().catch(() => undefined);
    }
  }, [st.catalog, st.refreshPresets, st.session?.status]);
  const openProjectManager = useCallback(() => {
    requestWorkspaceAction(showProjectManager);
  }, [requestWorkspaceAction, showProjectManager]);
  const selectWorkspaceFile = workspace.selectFile;
  const handleDesktopFileSelect = useCallback(
    (path: string) => {
      requestWorkspaceAction(() => selectWorkspaceFile(path));
    },
    [requestWorkspaceAction, selectWorkspaceFile],
  );
  const handleMobileFileSelect = useCallback(
    (path: string) => {
      requestWorkspaceAction(async () => {
        await selectWorkspaceFile(path);
        setMobileView("editor");
      });
    },
    [requestWorkspaceAction, selectWorkspaceFile],
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
          saveMode={workspace.saveMode}
          backendOnline={backendOnline}
          stConnection={st.session}
          pushAvailable={Boolean(backendOnline && workspace.project && st.session?.status === "connected")}
          diagnosticsBlocking={diagnosticsBlocking}
          onToggleExplorer={() => setExplorerVisible((value) => !value)}
          onOpenProjects={openProjectManager}
          onCloseProject={() => requestWorkspaceAction(handleCloseProject, "关闭")}
          onOpenConnection={() => setConnectionDialogOpen(true)}
          onExport={() => requestWorkspaceAction(handleExport)}
          onDownloadProject={() => requestWorkspaceAction(handleDownloadProject)}
          onValidate={() => requestWorkspaceAction(handleValidate)}
          onCreateSnapshot={() => setSnapshotCreateDialogOpen(true)}
          onOpenSnapshots={() => setSnapshotDialogOpen(true)}
          onOpenSettings={() => setSettingsDialogOpen(true)}
          onPush={() => {
            if (st.session?.status !== "connected") {
              setConnectionDialogOpen(true);
              return;
            }
            requestWorkspaceAction(() => setPushDialogOpen(true));
          }}
        />

        {!backendOnline || !workspace.project ? (
          <ProjectEmptyState
            backendOnline={backendOnline}
            stConnected={st.session?.status === "connected"}
            hasProjects={workspace.projects.length > 0}
            loading={workspace.isLoading || operationBusy}
            error={workspace.error?.message}
            onOpenProjects={openProjectManager}
            onOpenConnection={() => setConnectionDialogOpen(true)}
            onRetry={() => runSafely(retryBackend)}
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
                <ResizableSidebar
                  side="left"
                  defaultWidth={292}
                  minWidth={220}
                  maxWidth={480}
                  label="调整文件侧边栏宽度"
                >
                  <WorkspaceFileExplorer
                    projectName={workspace.project.name}
                    projectVersion={workspace.project.version ?? undefined}
                    files={explorerFiles}
                    activePath={activePath}
                    onSelect={handleDesktopFileSelect}
                    onOpenProjects={openProjectManager}
                    onOpenSettings={() => setSettingsDialogOpen(true)}
                    promptOrder={workspace.structure?.promptOrder}
                    promptOrderBusy={workspace.structureMutation === "saving"}
                    promptOrderPending={workspace.promptOrderPending}
                    onPromptOrderChange={handlePromptOrderChange}
                  />
                </ResizableSidebar>
              )}

              <WorkspaceEditorPane
                viewStateKey={`${workspace.project.id}:${activePath}`}
                path={activePath}
                content={activeContent}
                size={activeSize}
                lineCount={activeLineCount}
                revision={workspace.activeFile.revision ?? undefined}
                saveState={mappedSaveState}
                saveMode={workspace.saveMode}
                error={workspace.error?.message}
                onChange={workspace.setContent}
                onFlush={workspace.handleEditorBlur}
                onApply={() => void handleApplySourceJson()}
                structure={workspace.structure}
                structureBusy={workspace.structureMutation === "saving"}
                onMutateStructure={handleStructureMutation}
              />

              {wideInspectorLayout && inspectorVisible && (
                <ResizableSidebar
                  id="desktop-workspace-inspector"
                  side="right"
                  defaultWidth={560}
                  minWidth={420}
                  maxWidth={840}
                  label="调整检查器侧边栏宽度"
                  className="hidden xl:flex"
                  data-testid="desktop-inspector-panel"
                >
                  <WorkspaceInspector
                    path={activePath}
                    content={activeContent}
                    size={activeSize}
                    lineCount={activeLineCount}
                    revision={workspace.activeFile.revision}
                    saveState={mappedSaveState}
                    saveMode={workspace.saveMode}
                    backendOnline={backendOnline}
                    structure={workspace.structure}
                    structureBusy={workspace.structureMutation === "saving"}
                    diagnostics={workspace.diagnostics}
                    diagnosticsStale={workspace.diagnosticsStale}
                    validationBusy={operationBusy}
                    onMutateStructure={handleStructureMutation}
                    onValidate={() => requestWorkspaceAction(handleValidate)}
                    onOpenPath={handleDesktopFileSelect}
                    javascriptEnabled={workspace.project.preview.javascriptEnabled}
                    javascriptSettingsBusy={operationBusy}
                    previewOrigin={previewOrigin}
                    previewRuntime={previewRuntime}
                    regexMirrorBinding={workspace.project.regexMirrorBinding}
                    onJavascriptEnabledChange={handleJavascriptEnabledChange}
                  />
                </ResizableSidebar>
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
                    saveMode={workspace.saveMode}
                    backendOnline={backendOnline}
                    structure={workspace.structure}
                    structureBusy={workspace.structureMutation === "saving"}
                    diagnostics={workspace.diagnostics}
                    diagnosticsStale={workspace.diagnosticsStale}
                    validationBusy={operationBusy}
                    onMutateStructure={handleStructureMutation}
                    onValidate={() => requestWorkspaceAction(handleValidate)}
                    onOpenPath={handleDesktopFileSelect}
                    javascriptEnabled={workspace.project.preview.javascriptEnabled}
                    javascriptSettingsBusy={operationBusy}
                    previewOrigin={previewOrigin}
                    previewRuntime={previewRuntime}
                    regexMirrorBinding={workspace.project.regexMirrorBinding}
                    onJavascriptEnabledChange={handleJavascriptEnabledChange}
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
                    onOpenSettings={() => setSettingsDialogOpen(true)}
                    promptOrder={workspace.structure?.promptOrder}
                    promptOrderBusy={workspace.structureMutation === "saving"}
                    promptOrderPending={workspace.promptOrderPending}
                    onPromptOrderChange={handlePromptOrderChange}
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
                  saveMode={workspace.saveMode}
                  error={workspace.error?.message}
                  onChange={workspace.setContent}
                  onFlush={workspace.handleEditorBlur}
                  onApply={() => void handleApplySourceJson()}
                  structure={workspace.structure}
                  structureBusy={workspace.structureMutation === "saving"}
                  onMutateStructure={handleStructureMutation}
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
                  saveMode={workspace.saveMode}
                  backendOnline={backendOnline}
                  initialTab="preview"
                  structure={workspace.structure}
                  structureBusy={workspace.structureMutation === "saving"}
                  diagnostics={workspace.diagnostics}
                  diagnosticsStale={workspace.diagnosticsStale}
                  validationBusy={operationBusy}
                  onMutateStructure={handleStructureMutation}
                  onValidate={() => requestWorkspaceAction(handleValidate)}
                  onOpenPath={handleMobileFileSelect}
                  javascriptEnabled={workspace.project.preview.javascriptEnabled}
                  javascriptSettingsBusy={operationBusy}
                  previewOrigin={previewOrigin}
                  previewRuntime={previewRuntime}
                  regexMirrorBinding={workspace.project.regexMirrorBinding}
                  onJavascriptEnabledChange={handleJavascriptEnabledChange}
                />
              )}
              {mobileView === "runtime" && <RuntimeUnavailable stOrigin={st.session?.origin} />}
              </div>
            )}

            {!desktopLayout && (
              <MobileNav
                value={mobileView}
                onChange={setMobileView}
                connected={st.session?.status === "connected"}
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
          stSession={st.session}
          stCatalog={st.catalog}
          isLoadingStPresets={st.operation === "catalog"}
          onSelect={(projectId) =>
            runOperation(async () => {
              await workspace.openProject(projectId);
              setProjectDialogOpen(false);
            })
          }
          onCloseProject={() =>
            runOperation(async () => {
              await workspace.closeProject();
            }, "工程已关闭，服务器文件仍然保留")
          }
          onDeleteProject={requestDeleteProject}
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
                preview: input.preview,
              });
              setProjectDialogOpen(false);
            }, "Preset 已导入并拆分为工程")
          }
          onImportArchive={(input) =>
            runOperation(async () => {
              await workspace.importProjectArchive(input.file, {
                name: input.name,
                version: input.version,
                javascriptPolicy: input.javascriptPolicy,
              });
              setProjectDialogOpen(false);
            }, "工程包已作为新工程导入")
          }
          onCreateFromSt={(input) =>
            runOperation(async () => {
              await workspace.createProjectFromSt(input);
              setProjectDialogOpen(false);
            }, `已从 ST preset“${input.presetName}”创建工程快照`)
          }
          onRefreshStPresets={st.refreshPresets}
          onOpenStConnection={() => {
            setProjectDialogOpen(false);
            setConnectionDialogOpen(true);
          }}
        />

        <ConnectionDialog
          open={connectionDialogOpen}
          onOpenChange={setConnectionDialogOpen}
          session={st.session}
          rememberedOrigin={st.rememberedOrigin}
          backendOnline={backendOnline}
          operation={st.operation}
          isRefreshing={st.isRefreshingSession}
          error={st.error?.message}
          liveBridge={st.liveBridge}
          liveBridgeOperation={st.liveBridgeOperation}
          liveBridgeError={st.liveBridgeError?.message}
          onConnect={st.connectSession}
          onRefresh={st.refreshSession}
          onCheck={st.checkSession}
          onDisconnect={st.disconnectSession}
          onRetryBackend={retryBackend}
          onCheckLiveBridge={st.checkLiveBridge}
          onInstallLiveBridge={st.installLiveBridge}
          onUpdateLiveBridge={st.updateLiveBridge}
        />

        {workspace.project && pushDialogOpen ? (
          <PushDialog
            key={workspace.project.id}
            open={pushDialogOpen}
            onOpenChange={setPushDialogOpen}
            projectId={workspace.project.id}
            defaultTargetName={
              workspace.project.targetPresetName ??
              workspace.project.sourcePresetName ??
              workspace.project.name
            }
            presetNames={st.presets.map((preset) => preset.name)}
            operation={st.operation}
            onPreview={async (projectId, input) => {
              await workspace.flushSave();
              return st.previewProjectPush(projectId, input);
            }}
            onCommit={async (projectId, previewToken) => {
              const result = await st.commitProjectPush(projectId, previewToken);
              await Promise.allSettled([
                st.refreshPresets(),
                workspace.openProject(projectId),
              ]);
              return result;
            }}
          />
        ) : null}

        <ProjectSettingsDialog
          open={settingsDialogOpen}
          onOpenChange={setSettingsDialogOpen}
          project={workspace.project}
          busy={operationBusy}
          previewOrigin={previewOrigin}
          onSave={(input) => {
            void runOperation(async () => {
              await workspace.updateProjectSettings(input);
              setSettingsDialogOpen(false);
            }, "工程设置已保存");
          }}
        />

        <SnapshotHistoryDialog
          open={snapshotDialogOpen}
          onOpenChange={setSnapshotDialogOpen}
          snapshots={workspace.snapshots}
          busy={operationBusy}
          onRestore={handleRestoreSnapshot}
          onDelete={handleDeleteSnapshot}
        />

        <TextInputDialog
          open={snapshotCreateDialogOpen}
          onOpenChange={setSnapshotCreateDialogOpen}
          title="创建工程快照"
          description="保存当前完整 preset 构建结果，之后可从快照历史恢复。"
          inputLabel="快照名称"
          initialValue="手动快照"
          confirmLabel="创建快照"
          busy={operationBusy}
          onSubmit={handleCreateSnapshot}
        />

        <ExplicitDraftDialog
          open={draftDialogOpen}
          busy={draftBusy}
          actionLabel={draftActionLabel}
          onApply={() => void applyDraftAndContinue()}
          onDiscard={discardDraftAndContinue}
          onCancel={cancelPendingWorkspaceAction}
        />

        <DeleteProjectDialog
          project={pendingDelete}
          busy={deleteBusy}
          onConfirm={() => void confirmDeleteProject()}
          onCancel={cancelDeleteProject}
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

function RuntimeUnavailable({ stOrigin }: { stOrigin?: string }) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <RadioTower className="size-5" />
        </span>
        <p className="mt-4 text-sm font-medium">请在 SillyTavern 中手动测试</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          HTTP 连接可以读取和保存 preset，但不能控制已经打开的 ST 页面、捕获最终 Prompt 或执行页面 JavaScript。保存后请刷新 ST、手动选择目标 preset，再发起测试对话。
        </p>
        {stOrigin ? (
          <Button asChild variant="secondary" className="mt-4">
            <a href={stOrigin} target="_blank" rel="noreferrer">
              打开 SillyTavern
            </a>
          </Button>
        ) : null}
      </div>
    </main>
  );
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
