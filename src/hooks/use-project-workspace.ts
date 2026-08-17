import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

import {
  isAbortError,
  projectApi,
  type BuildProjectInput,
  type CreateProjectInput,
  type CreateProjectFromStInput,
  type ExportProjectInput,
  type ImportProjectArchiveInput,
  type ImportProjectInput,
  type Project,
  type ProjectApi,
  type ProjectArchiveDownload,
  type ProjectArchiveImportResult,
  type ProjectBuildResult,
  type ProjectExportResult,
  type ProjectFile,
  type ProjectFileEntry,
  type ProjectSummary,
} from "../lib/project-api";

export type WorkspaceSaveState =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

export type WorkspaceSaveMode = "auto" | "explicit";

export class ExplicitSourceDraftError extends Error {
  constructor() {
    super("Complete preset JSON has unapplied changes");
    this.name = "ExplicitSourceDraftError";
  }
}

const WORKSPACE_SELECTION_KEY = "preset-studio:workspace-selection:v1";

function workspaceWasClosed() {
  try {
    const value = localStorage.getItem(WORKSPACE_SELECTION_KEY);
    if (!value) return false;
    const parsed = JSON.parse(value) as unknown;
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        "state" in parsed &&
        parsed.state === "closed",
    );
  } catch {
    return false;
  }
}

function rememberClosedWorkspace() {
  try {
    localStorage.setItem(WORKSPACE_SELECTION_KEY, JSON.stringify({ state: "closed" }));
  } catch {
    // A blocked storage area must not prevent closing a project.
  }
}

function forgetClosedWorkspace() {
  try {
    localStorage.removeItem(WORKSPACE_SELECTION_KEY);
  } catch {
    // Opening a project still succeeds when storage is unavailable.
  }
}

export interface UseProjectWorkspaceOptions {
  api?: ProjectApi;
  initialProjectId?: string;
  initialFilePath?: string;
  autoLoad?: boolean;
  autosaveDelay?: number;
  onError?: (error: Error) => void;
}

export interface UseProjectWorkspaceResult {
  projects: ProjectSummary[];
  project: Project | null;
  files: ProjectFileEntry[];
  activeFile: ProjectFile | null;
  content: string;
  isDirty: boolean;
  saveMode: WorkspaceSaveMode;
  hasExplicitDraft: boolean;
  saveState: WorkspaceSaveState;
  error: Error | null;
  isLoadingProjects: boolean;
  isLoadingProject: boolean;
  isLoadingFile: boolean;
  isLoading: boolean;
  refreshProjects: () => Promise<ProjectSummary[]>;
  openProject: (
    projectId: string,
    preferredFilePath?: string,
  ) => Promise<void>;
  closeProject: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  selectFile: (file: ProjectFileEntry | string) => Promise<void>;
  setContent: (value: SetStateAction<string>) => void;
  flushSave: () => Promise<ProjectFile | null>;
  discardChanges: () => void;
  handleEditorBlur: () => void;
  createProject: (input: CreateProjectInput) => Promise<Project>;
  createProjectFromSt: (input: CreateProjectFromStInput) => Promise<Project>;
  importProjectJson: (
    file: File,
    input?: ImportProjectInput,
  ) => Promise<Project>;
  importProjectArchive: (
    file: File,
    input?: ImportProjectArchiveInput,
  ) => Promise<ProjectArchiveImportResult>;
  buildProject: (input?: BuildProjectInput) => Promise<ProjectBuildResult>;
  exportProject: (input?: ExportProjectInput) => Promise<ProjectExportResult>;
  downloadProjectArchive: () => Promise<ProjectArchiveDownload>;
  clearError: () => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function firstEditableFile(files: ProjectFileEntry[]) {
  return (
    files.find(
      (file) =>
        file.kind === "file" &&
        file.path.startsWith("prompts/") &&
        file.path.endsWith("/content.md"),
    ) ??
    files.find((file) => file.kind === "file" && file.path === "project.json") ??
    files.find((file) => file.kind === "file") ??
    null
  );
}

function isSourceJsonFile(file: ProjectFileEntry | null | undefined) {
  return file?.role === "source-json" || file?.path === "preset.json";
}

function mergeProjectSummary(
  projects: ProjectSummary[],
  project: Project,
): ProjectSummary[] {
  const summary: ProjectSummary = {
    id: project.id,
    name: project.name,
    version: project.version,
    source: project.source,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  const index = projects.findIndex((item) => item.id === project.id);
  if (index < 0) return [summary, ...projects];
  return projects.map((item, itemIndex) =>
    itemIndex === index ? summary : item,
  );
}

/**
 * Owns the server-backed project workspace lifecycle.
 *
 * Edits update `content` synchronously, then save after 850 ms by default.
 * File/project switches, blur, build and export all pass through `flushSave`.
 */
export function useProjectWorkspace(
  options: UseProjectWorkspaceOptions = {},
): UseProjectWorkspaceResult {
  const api = options.api ?? projectApi;
  const autoLoad = options.autoLoad ?? true;
  const autosaveDelay = options.autosaveDelay ?? 850;

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);
  const [content, setContentState] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<WorkspaceSaveState>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  const mountedRef = useRef(false);
  const projectRef = useRef<Project | null>(null);
  const activeFileRef = useRef<ProjectFile | null>(null);
  const contentRef = useRef("");
  const dirtyRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromiseRef = useRef<Promise<ProjectFile> | null>(null);
  const deletingProjectRef = useRef<string | null>(null);
  const projectsAbortRef = useRef<AbortController | null>(null);
  const projectAbortRef = useRef<AbortController | null>(null);
  const fileAbortRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  const reportError = useCallback((caught: unknown) => {
    if (isAbortError(caught)) return;
    const nextError = toError(caught);
    if (mountedRef.current) setError(nextError);
    onErrorRef.current?.(nextError);
  }, []);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const applyLoadedFile = useCallback((nextFile: ProjectFile | null) => {
    activeFileRef.current = nextFile;
    contentRef.current = nextFile?.content ?? "";
    dirtyRef.current = false;
    setActiveFile(nextFile);
    setContentState(nextFile?.content ?? "");
    setIsDirty(false);
    setSaveState(nextFile ? "saved" : "idle");
  }, []);

  const flushSave = useCallback(async (): Promise<ProjectFile | null> => {
    clearAutosaveTimer();

    // The loop makes a forced flush include edits made while an earlier request
    // was in flight, without ever issuing concurrent PUTs for one workspace.
    while (true) {
      const inFlight = savePromiseRef.current;
      if (inFlight) {
        await inFlight;
        continue;
      }

      const currentProject = projectRef.current;
      const currentFile = activeFileRef.current;
      if (!dirtyRef.current || !currentProject || !currentFile) {
        return currentFile;
      }

      const savedProjectId = currentProject.id;
      const savedPath = currentFile.path;
      const savedContent = contentRef.current;
      const savedRevision = currentFile.revision;

      dirtyRef.current = false;
      if (mountedRef.current) {
        setIsDirty(false);
        setSaveState("saving");
      }

      const request = api.updateProjectFile(savedProjectId, savedPath, {
        content: savedContent,
        revision: savedRevision,
      });
      savePromiseRef.current = request;

      try {
        const savedFile = await request;
        const current = activeFileRef.current;

        if (isSourceJsonFile(savedFile)) {
          const [updatedProject, updatedFiles] = await Promise.all([
            api.getProject(savedProjectId),
            api.listProjectFiles(savedProjectId),
          ]);
          if (projectRef.current?.id === savedProjectId) {
            projectRef.current = updatedProject;
            if (mountedRef.current) {
              setProject(updatedProject);
              setFiles(updatedFiles);
              setProjects((projects) => mergeProjectSummary(projects, updatedProject));
            }
          }
        }

        if (
          projectRef.current?.id === savedProjectId &&
          current?.path === savedPath
        ) {
          const mergedFile: ProjectFile = {
            ...savedFile,
            // A user may have typed again while PUT was pending. Preserve the
            // current buffer but advance its revision to the committed base.
            content: dirtyRef.current ? contentRef.current : savedFile.content,
          };
          activeFileRef.current = mergedFile;
          if (mountedRef.current) {
            setActiveFile(mergedFile);
            if (!isSourceJsonFile(savedFile)) {
              setFiles((currentFiles) =>
                currentFiles.map((file) =>
                  file.path === savedPath
                    ? {
                        ...file,
                        size: savedFile.size,
                        revision: savedFile.revision,
                        updatedAt: savedFile.updatedAt,
                      }
                    : file,
                ),
              );
            }
            setSaveState(dirtyRef.current ? "dirty" : "saved");
            setIsDirty(dirtyRef.current);
          }
        }
      } catch (caught) {
        dirtyRef.current = true;
        if (mountedRef.current) {
          setIsDirty(true);
          setSaveState("error");
        }
        reportError(caught);
        throw caught;
      } finally {
        if (savePromiseRef.current === request) savePromiseRef.current = null;
      }

      clearAutosaveTimer();
      // If the buffer changed while saving, loop once more with the revision
      // returned by the preceding PUT. Otherwise this is a complete flush.
      if (
        !dirtyRef.current ||
        isSourceJsonFile(activeFileRef.current) ||
        deletingProjectRef.current === savedProjectId
      ) {
        return activeFileRef.current;
      }
    }
  }, [api, clearAutosaveTimer, reportError]);

  const scheduleAutosave = useCallback(() => {
    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void flushSave().catch(() => {
        // Error state is set inside flushSave; timers must not create an
        // unhandled promise rejection.
      });
    }, Math.max(0, autosaveDelay));
  }, [autosaveDelay, clearAutosaveTimer, flushSave]);

  const setContent = useCallback(
    (value: SetStateAction<string>) => {
      if (!activeFileRef.current) return;
      const nextContent =
        typeof value === "function" ? value(contentRef.current) : value;
      if (nextContent === contentRef.current) return;

      contentRef.current = nextContent;
      dirtyRef.current = true;
      setContentState(nextContent);
      setIsDirty(true);
      setSaveState("dirty");
      setError(null);
      if (!isSourceJsonFile(activeFileRef.current)) scheduleAutosave();
    },
    [scheduleAutosave],
  );

  const flushBeforeOperation = useCallback(async () => {
    if (dirtyRef.current && isSourceJsonFile(activeFileRef.current)) {
      throw new ExplicitSourceDraftError();
    }
    return flushSave();
  }, [flushSave]);

  const selectFile = useCallback(
    async (file: ProjectFileEntry | string) => {
      const path = typeof file === "string" ? file : file.path;
      if (typeof file !== "string" && file.kind === "directory") return;
      if (activeFileRef.current?.path === path) return;

      await flushBeforeOperation();
      const currentProject = projectRef.current;
      if (!currentProject) throw new Error("No project is currently open");

      fileAbortRef.current?.abort();
      const controller = new AbortController();
      fileAbortRef.current = controller;
      if (mountedRef.current) {
        setIsLoadingFile(true);
        setError(null);
      }

      try {
        const loaded = await api.getProjectFile(currentProject.id, path, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || fileAbortRef.current !== controller) {
          return;
        }
        applyLoadedFile(loaded);
      } catch (caught) {
        if (isAbortError(caught)) return;
        reportError(caught);
        throw caught;
      } finally {
        if (fileAbortRef.current === controller) {
          fileAbortRef.current = null;
          if (mountedRef.current) setIsLoadingFile(false);
        }
      }
    },
    [api, applyLoadedFile, flushBeforeOperation, reportError],
  );

  const openProject = useCallback(
    async (projectId: string, preferredFilePath?: string) => {
      await flushBeforeOperation();
      projectAbortRef.current?.abort();
      fileAbortRef.current?.abort();
      const controller = new AbortController();
      projectAbortRef.current = controller;
      if (mountedRef.current) {
        setIsLoadingProject(true);
        setError(null);
      }

      try {
        const [loadedProject, loadedFiles] = await Promise.all([
          api.getProject(projectId, { signal: controller.signal }),
          api.listProjectFiles(projectId, { signal: controller.signal }),
        ]);
        if (
          controller.signal.aborted ||
          projectAbortRef.current !== controller
        ) {
          return;
        }

        const preferred = preferredFilePath
          ? loadedFiles.find(
              (file) =>
                file.kind === "file" && file.path === preferredFilePath,
            )
          : undefined;
        const initialFile = preferred ?? firstEditableFile(loadedFiles);
        const loadedFile = initialFile
          ? await api.getProjectFile(loadedProject.id, initialFile.path, {
              signal: controller.signal,
            })
          : null;
        if (
          controller.signal.aborted ||
          projectAbortRef.current !== controller
        ) {
          return;
        }

        projectRef.current = loadedProject;
        forgetClosedWorkspace();
        setProject(loadedProject);
        setFiles(loadedFiles);
        setProjects((current) =>
          mergeProjectSummary(current, loadedProject),
        );
        applyLoadedFile(loadedFile);
      } catch (caught) {
        if (isAbortError(caught)) return;
        reportError(caught);
        throw caught;
      } finally {
        if (projectAbortRef.current === controller) {
          projectAbortRef.current = null;
          if (mountedRef.current) setIsLoadingProject(false);
        }
      }
    },
    [api, applyLoadedFile, flushBeforeOperation, reportError],
  );

  const refreshProjects = useCallback(async () => {
    projectsAbortRef.current?.abort();
    const controller = new AbortController();
    projectsAbortRef.current = controller;
    if (mountedRef.current) {
      setIsLoadingProjects(true);
      setError(null);
    }

    try {
      const loaded = await api.listProjects({ signal: controller.signal });
      if (
        !controller.signal.aborted &&
        projectsAbortRef.current === controller &&
        mountedRef.current
      ) {
        setProjects(loaded);
      }
      return loaded;
    } catch (caught) {
      if (!isAbortError(caught)) reportError(caught);
      throw caught;
    } finally {
      if (projectsAbortRef.current === controller) {
        projectsAbortRef.current = null;
        if (mountedRef.current) setIsLoadingProjects(false);
      }
    }
  }, [api, reportError]);

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      await flushBeforeOperation();
      let created: Project;
      try {
        created = await api.createProject(input);
      } catch (caught) {
        reportError(caught);
        throw caught;
      }
      if (mountedRef.current) {
        setProjects((current) => mergeProjectSummary(current, created));
      }
      await openProject(created.id);
      return created;
    },
    [api, flushBeforeOperation, openProject, reportError],
  );

  const createProjectFromSt = useCallback(
    async (input: CreateProjectFromStInput) => {
      await flushBeforeOperation();
      let created: Project;
      try {
        created = await api.createProjectFromSt(input);
      } catch (caught) {
        reportError(caught);
        throw caught;
      }
      if (mountedRef.current) {
        setProjects((current) => mergeProjectSummary(current, created));
      }
      await openProject(created.id);
      return created;
    },
    [api, flushBeforeOperation, openProject, reportError],
  );

  const importProjectJson = useCallback(
    async (file: File, input?: ImportProjectInput) => {
      await flushBeforeOperation();
      let imported: Project;
      try {
        imported = await api.importProjectJson(file, input);
      } catch (caught) {
        reportError(caught);
        throw caught;
      }
      if (mountedRef.current) {
        setProjects((current) => mergeProjectSummary(current, imported));
      }
      await openProject(imported.id);
      return imported;
    },
    [api, flushBeforeOperation, openProject, reportError],
  );

  const importProjectArchive = useCallback(
    async (file: File, input?: ImportProjectArchiveInput) => {
      await flushBeforeOperation();
      let result: ProjectArchiveImportResult;
      try {
        result = await api.importProjectArchive(file, input);
      } catch (caught) {
        reportError(caught);
        throw caught;
      }
      if (mountedRef.current) {
        setProjects((current) =>
          mergeProjectSummary(current, result.project),
        );
      }
      await openProject(result.project.id);
      return result;
    },
    [api, flushBeforeOperation, openProject, reportError],
  );

  const buildProject = useCallback(
    async (input?: BuildProjectInput) => {
      await flushBeforeOperation();
      const currentProject = projectRef.current;
      if (!currentProject) throw new Error("No project is currently open");
      try {
        return await api.buildProject(currentProject.id, input);
      } catch (caught) {
        reportError(caught);
        throw caught;
      }
    },
    [api, flushBeforeOperation, reportError],
  );

  const exportProject = useCallback(
    async (input?: ExportProjectInput) => {
      await flushBeforeOperation();
      const currentProject = projectRef.current;
      if (!currentProject) throw new Error("No project is currently open");
      try {
        return await api.exportProject(currentProject.id, input);
      } catch (caught) {
        reportError(caught);
        throw caught;
      }
    },
    [api, flushBeforeOperation, reportError],
  );

  const downloadProjectArchive = useCallback(async () => {
    await flushBeforeOperation();
    const currentProject = projectRef.current;
    if (!currentProject) throw new Error("No project is currently open");
    try {
      return await api.downloadProjectArchive(currentProject.id);
    } catch (caught) {
      reportError(caught);
      throw caught;
    }
  }, [api, flushBeforeOperation, reportError]);

  const discardChanges = useCallback(() => {
    clearAutosaveTimer();
    const current = activeFileRef.current;
    if (!current) return;
    applyLoadedFile(current);
    setError(null);
  }, [applyLoadedFile, clearAutosaveTimer]);

  const clearWorkspace = useCallback(() => {
    clearAutosaveTimer();
    projectAbortRef.current?.abort();
    fileAbortRef.current?.abort();
    projectAbortRef.current = null;
    fileAbortRef.current = null;
    projectRef.current = null;
    setProject(null);
    setFiles([]);
    applyLoadedFile(null);
    setIsLoadingProject(false);
    setIsLoadingFile(false);
    setError(null);
  }, [applyLoadedFile, clearAutosaveTimer]);

  const closeProject = useCallback(async () => {
    await flushBeforeOperation();
    clearWorkspace();
    rememberClosedWorkspace();
  }, [clearWorkspace, flushBeforeOperation]);

  const deleteProject = useCallback(
    async (projectId: string) => {
      const deletingActive = projectRef.current?.id === projectId;
      if (deletingActive) {
        clearAutosaveTimer();
        deletingProjectRef.current = projectId;
        await savePromiseRef.current?.catch(() => undefined);
      }
      try {
        await api.deleteProject(projectId);
      } catch (caught) {
        if (deletingActive) deletingProjectRef.current = null;
        if (deletingActive && dirtyRef.current && !isSourceJsonFile(activeFileRef.current)) {
          scheduleAutosave();
        }
        reportError(caught);
        throw caught;
      }

      if (mountedRef.current) {
        setProjects((current) => current.filter((item) => item.id !== projectId));
      }
      if (deletingActive) {
        deletingProjectRef.current = null;
        clearWorkspace();
        rememberClosedWorkspace();
      }
    },
    [api, clearAutosaveTimer, clearWorkspace, reportError, scheduleAutosave],
  );

  const handleEditorBlur = useCallback(() => {
    if (isSourceJsonFile(activeFileRef.current)) return;
    void flushSave().catch(() => {
      // The hook exposes error/saveState for the UI to surface.
    });
  }, [flushSave]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    mountedRef.current = true;
    if (autoLoad) {
      void (async () => {
        try {
          const loadedProjects = await refreshProjects();
          const initialId =
            options.initialProjectId ??
            (workspaceWasClosed() ? undefined : loadedProjects[0]?.id);
          if (initialId) {
            await openProject(initialId, options.initialFilePath);
          }
        } catch (caught) {
          // Aborts and reported API errors are already represented in state.
          if (!isAbortError(caught)) return;
        }
      })();
    }

    return () => {
      mountedRef.current = false;
      clearAutosaveTimer();
      projectsAbortRef.current?.abort();
      projectAbortRef.current?.abort();
      fileAbortRef.current?.abort();
    };
  }, [
    autoLoad,
    clearAutosaveTimer,
    openProject,
    options.initialFilePath,
    options.initialProjectId,
    refreshProjects,
  ]);

  return {
    projects,
    project,
    files,
    activeFile,
    content,
    isDirty,
    saveMode: isSourceJsonFile(activeFile) ? "explicit" : "auto",
    hasExplicitDraft: isDirty && isSourceJsonFile(activeFile),
    saveState,
    error,
    isLoadingProjects,
    isLoadingProject,
    isLoadingFile,
    isLoading: isLoadingProjects || isLoadingProject || isLoadingFile,
    refreshProjects,
    openProject,
    closeProject,
    deleteProject,
    selectFile,
    setContent,
    flushSave,
    discardChanges,
    handleEditorBlur,
    createProject,
    createProjectFromSt,
    importProjectJson,
    importProjectArchive,
    buildProject,
    exportProject,
    downloadProjectArchive,
    clearError,
  };
}
