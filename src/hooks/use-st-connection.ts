import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getRememberedStOrigin,
  rememberStOrigin,
  stApi,
  type ConnectStSessionInput,
  type StApi,
  type StLiveBridgeMutationResult,
  type StLiveBridgeStatus,
  type StPresetCatalog,
  type StPresetDocument,
  type StPushMode,
  type StPushPreview,
  type StPushResult,
  type StSession,
} from "../lib/st-api";

export interface UseStConnectionOptions {
  api?: StApi;
  enabled?: boolean;
  disconnectedPollMs?: number;
  connectedPollMs?: number;
  maxRetryMs?: number;
  onError?: (error: Error) => void;
}

export type StOperation =
  | "connect"
  | "check"
  | "disconnect"
  | "catalog"
  | "preview"
  | "commit"
  | null;

export type StLiveBridgeOperation =
  | "check"
  | "install"
  | "update"
  | "uninstall"
  | null;

export interface UseStConnectionResult {
  session: StSession | null;
  catalog: StPresetCatalog | null;
  presets: StPresetCatalog["presets"];
  rememberedOrigin: string;
  error: Error | null;
  operation: StOperation;
  isPageVisible: boolean;
  isRefreshingSession: boolean;
  refreshSession: () => Promise<StSession | null>;
  connectSession: (input: ConnectStSessionInput) => Promise<StSession>;
  liveBridge: StLiveBridgeStatus | null;
  liveBridgeError: Error | null;
  liveBridgeOperation: StLiveBridgeOperation;
  checkSession: () => Promise<StSession>;
  disconnectSession: () => Promise<void>;
  refreshPresets: () => Promise<StPresetCatalog>;
  readPreset: (name: string) => Promise<StPresetDocument>;
  previewProjectPush: (
    projectId: string,
    input: { targetName: string; mode: StPushMode },
  ) => Promise<StPushPreview>;
  commitProjectPush: (
    projectId: string,
    previewToken: string,
  ) => Promise<StPushResult>;
  checkLiveBridge: () => Promise<StLiveBridgeStatus>;
  installLiveBridge: () => Promise<StLiveBridgeMutationResult>;
  updateLiveBridge: () => Promise<StLiveBridgeMutationResult>;
  uninstallLiveBridge: () => Promise<StLiveBridgeMutationResult>;
  clearError: () => void;
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameSession(left: StSession | null, right: StSession | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.status === right.status &&
    left.origin === right.origin &&
    left.version === right.version &&
    left.branch === right.branch &&
    left.userHandle === right.userHandle &&
    left.compatibility === right.compatibility &&
    left.targetPolicy === right.targetPolicy &&
    left.connectedAt === right.connectedAt &&
    left.lastCheckedAt === right.lastCheckedAt &&
    sameStrings(left.authModes, right.authModes) &&
    sameStrings(left.capabilities, right.capabilities)
  );
}

/**
 * Owns the single server-side ST HTTP session.
 *
 * Polling is request-deduplicated and pauses while the page is hidden. Only the
 * non-sensitive ST origin is persisted; authentication material is submitted
 * once and remains outside React state and browser storage.
 */
export function useStConnection(
  options: UseStConnectionOptions = {},
): UseStConnectionResult {
  const api = options.api ?? stApi;
  const enabled = options.enabled ?? true;
  const disconnectedPollMs = Math.max(2_000, options.disconnectedPollMs ?? 5_000);
  const connectedPollMs = Math.max(15_000, options.connectedPollMs ?? 60_000);
  const maxRetryMs = Math.max(connectedPollMs, options.maxRetryMs ?? 30_000);

  const [session, setSession] = useState<StSession | null>(null);
  const [catalog, setCatalog] = useState<StPresetCatalog | null>(null);
  const [rememberedOrigin, setRememberedOrigin] = useState(getRememberedStOrigin);
  const [error, setError] = useState<Error | null>(null);
  const [operation, setOperation] = useState<StOperation>(null);
  const [liveBridge, setLiveBridge] = useState<StLiveBridgeStatus | null>(null);
  const [liveBridgeError, setLiveBridgeError] = useState<Error | null>(null);
  const [liveBridgeOperation, setLiveBridgeOperation] = useState<StLiveBridgeOperation>(null);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  const mountedRef = useRef(false);
  const sessionRef = useRef<StSession | null>(null);
  const sessionRequestRef = useRef<Promise<StSession | null> | null>(null);
  const catalogRequestRef = useRef<Promise<StPresetCatalog> | null>(null);
  const heartbeatRequestRef = useRef<Promise<StSession> | null>(null);
  const liveBridgeRequestRef = useRef<Promise<StLiveBridgeStatus> | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const catalogAbortRef = useRef<AbortController | null>(null);
  const heartbeatAbortRef = useRef<AbortController | null>(null);
  const liveBridgeAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const pushAbortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const connectionGenerationRef = useRef(0);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionAbortRef.current?.abort();
      catalogAbortRef.current?.abort();
      heartbeatAbortRef.current?.abort();
      liveBridgeAbortRef.current?.abort();
      mutationAbortRef.current?.abort();
      pushAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const updateVisibility = () =>
      setIsPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const applySession = useCallback((nextSession: StSession | null) => {
    sessionRef.current = nextSession;
    if (nextSession?.status !== "connected") {
      liveBridgeAbortRef.current?.abort();
      liveBridgeRequestRef.current = null;
    }
    if (mountedRef.current) {
      setSession((current) => (sameSession(current, nextSession) ? current : nextSession));
      if (nextSession?.status !== "connected") {
        setCatalog(null);
        setLiveBridge(null);
        setLiveBridgeError(null);
        setLiveBridgeOperation(null);
      }
    }
  }, []);

  const invalidateConnectionReads = useCallback(() => {
    connectionGenerationRef.current += 1;
    sessionAbortRef.current?.abort();
    catalogAbortRef.current?.abort();
    heartbeatAbortRef.current?.abort();
    liveBridgeAbortRef.current?.abort();
    sessionRequestRef.current = null;
    catalogRequestRef.current = null;
    heartbeatRequestRef.current = null;
    liveBridgeRequestRef.current = null;
    if (mountedRef.current) {
      setLiveBridge(null);
      setLiveBridgeError(null);
      setLiveBridgeOperation(null);
    }
    return connectionGenerationRef.current;
  }, []);

  const loadSession = useCallback(
    async (showLoading: boolean) => {
      if (sessionRequestRef.current) return sessionRequestRef.current;
      const controller = new AbortController();
      const generation = connectionGenerationRef.current;
      sessionAbortRef.current = controller;
      if (showLoading && mountedRef.current) setIsRefreshingSession(true);

      const request = api.getSession({ signal: controller.signal });
      sessionRequestRef.current = request;
      try {
        const nextSession = await request;
        if (
          controller.signal.aborted ||
          generation !== connectionGenerationRef.current
        ) {
          return sessionRef.current;
        }
        retryCountRef.current = 0;
        applySession(nextSession);
        if (mountedRef.current) setError(null);
        return nextSession;
      } catch (caught) {
        if (
          isAbortError(caught) ||
          generation !== connectionGenerationRef.current
        ) {
          return sessionRef.current;
        }
        retryCountRef.current += 1;
        const nextError = toError(caught);
        if (mountedRef.current) setError(nextError);
        if (showLoading) onErrorRef.current?.(nextError);
        throw nextError;
      } finally {
        if (sessionRequestRef.current === request) sessionRequestRef.current = null;
        if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
        if (showLoading && mountedRef.current) setIsRefreshingSession(false);
      }
    },
    [api, applySession],
  );

  const refreshSession = useCallback(() => loadSession(true), [loadSession]);

  const probeSession = useCallback(
    async (showLoading: boolean) => {
      if (heartbeatRequestRef.current) return heartbeatRequestRef.current;
      const controller = new AbortController();
      const generation = connectionGenerationRef.current;
      heartbeatAbortRef.current = controller;
      if (showLoading && mountedRef.current) {
        setOperation("check");
        setIsRefreshingSession(true);
        setError(null);
      }
      const request = api.checkSession({ signal: controller.signal });
      heartbeatRequestRef.current = request;
      try {
        const nextSession = await request;
        if (
          !controller.signal.aborted &&
          generation === connectionGenerationRef.current
        ) {
          retryCountRef.current = 0;
          applySession(nextSession);
          if (mountedRef.current) setError(null);
        }
        return nextSession;
      } catch (caught) {
        if (isAbortError(caught) && sessionRef.current) return sessionRef.current;
        retryCountRef.current += 1;
        const nextError = toError(caught);
        if (mountedRef.current) setError(nextError);
        if (showLoading) onErrorRef.current?.(nextError);
        throw nextError;
      } finally {
        if (heartbeatRequestRef.current === request) heartbeatRequestRef.current = null;
        if (heartbeatAbortRef.current === controller) heartbeatAbortRef.current = null;
        if (showLoading && mountedRef.current) {
          setOperation((current) => (current === "check" ? null : current));
          setIsRefreshingSession(false);
        }
      }
    },
    [api, applySession],
  );

  useEffect(() => {
    if (!enabled || !isPageVisible) {
      sessionAbortRef.current?.abort();
      heartbeatAbortRef.current?.abort();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        if (
          sessionRef.current?.status === "connected" ||
          sessionRef.current?.status === "unreachable"
        ) {
          await probeSession(false);
        } else {
          await loadSession(false);
        }
      } catch {
        // The check endpoint updates server-side reachability. Refresh its
        // resulting local session record without starting another ST probe.
        if (
          sessionRef.current?.status === "connected" ||
          sessionRef.current?.status === "unreachable"
        ) {
          await loadSession(false).catch(() => undefined);
        }
      }
      if (cancelled) return;
      const connected = sessionRef.current?.status === "connected";
      const baseDelay = connected ? connectedPollMs : disconnectedPollMs;
      const retryDelay = Math.min(
        maxRetryMs,
        baseDelay * 2 ** Math.min(retryCountRef.current, 3),
      );
      timer = window.setTimeout(
        poll,
        retryCountRef.current ? retryDelay : baseDelay,
      );
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [connectedPollMs, disconnectedPollMs, enabled, isPageVisible, loadSession, maxRetryMs, probeSession]);

  const refreshPresets = useCallback(async () => {
    if (catalogRequestRef.current) return catalogRequestRef.current;
    if (sessionRef.current?.status !== "connected") {
      throw new Error("请先连接 SillyTavern，再读取 preset 列表。");
    }
    const controller = new AbortController();
    const generation = connectionGenerationRef.current;
    catalogAbortRef.current = controller;
    const request = api.listPresets({ signal: controller.signal });
    catalogRequestRef.current = request;
    if (mountedRef.current) setOperation("catalog");
    try {
      const nextCatalog = await request;
      if (
        mountedRef.current &&
        !controller.signal.aborted &&
        generation === connectionGenerationRef.current
      ) {
        setCatalog(nextCatalog);
        setError(null);
      }
      return nextCatalog;
    } catch (caught) {
      if (
        isAbortError(caught) ||
        generation !== connectionGenerationRef.current
      ) {
        throw caught;
      }
      const nextError = toError(caught);
      if (mountedRef.current) setError(nextError);
      onErrorRef.current?.(nextError);
      throw nextError;
    } finally {
      if (catalogRequestRef.current === request) catalogRequestRef.current = null;
      if (catalogAbortRef.current === controller) catalogAbortRef.current = null;
      if (mountedRef.current) setOperation((current) => (current === "catalog" ? null : current));
    }
  }, [api]);

  useEffect(() => {
    if (session?.status !== "connected" || catalog) return;
    void refreshPresets().catch(() => undefined);
  }, [catalog, refreshPresets, session?.origin, session?.status]);

  const connectSession = useCallback(
    async (input: ConnectStSessionInput) => {
      mutationAbortRef.current?.abort();
      const controller = new AbortController();
      mutationAbortRef.current = controller;
      const generation = invalidateConnectionReads();
      if (mountedRef.current) {
        setOperation("connect");
        setError(null);
      }
      try {
        const nextSession = await api.connectSession(input, {
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          generation !== connectionGenerationRef.current
        ) {
          return nextSession;
        }
        invalidateConnectionReads();
        applySession(nextSession);
        rememberStOrigin(nextSession.origin);
        if (mountedRef.current) {
          setCatalog(null);
          setRememberedOrigin(nextSession.origin);
        }
        return nextSession;
      } catch (caught) {
        if (
          isAbortError(caught) ||
          generation !== connectionGenerationRef.current
        ) {
          throw caught;
        }
        const nextError = toError(caught);
        if (mountedRef.current) setError(nextError);
        onErrorRef.current?.(nextError);
        throw nextError;
      } finally {
        if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
        if (mountedRef.current) setOperation((current) => (current === "connect" ? null : current));
      }
    },
    [api, applySession, invalidateConnectionReads],
  );

  const checkSession = useCallback(() => probeSession(true), [probeSession]);

  const disconnectSession = useCallback(async () => {
    mutationAbortRef.current?.abort();
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    const generation = invalidateConnectionReads();
    if (mountedRef.current) setOperation("disconnect");
    try {
      await api.disconnectSession({ signal: controller.signal });
      if (
        controller.signal.aborted ||
        generation !== connectionGenerationRef.current
      ) {
        return;
      }
      invalidateConnectionReads();
      applySession(null);
      if (mountedRef.current) {
        setCatalog(null);
        setError(null);
      }
    } catch (caught) {
      if (
        isAbortError(caught) ||
        generation !== connectionGenerationRef.current
      ) {
        throw caught;
      }
      const nextError = toError(caught);
      if (mountedRef.current) setError(nextError);
      onErrorRef.current?.(nextError);
      throw nextError;
    } finally {
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
      if (mountedRef.current) setOperation((current) => (current === "disconnect" ? null : current));
    }
  }, [api, applySession, invalidateConnectionReads]);

  const readPreset = useCallback(
    (name: string) => api.readPreset(name),
    [api],
  );

  const previewProjectPush = useCallback(
    async (
      projectId: string,
      input: { targetName: string; mode: StPushMode },
    ) => {
      pushAbortRef.current?.abort();
      const controller = new AbortController();
      pushAbortRef.current = controller;
      if (mountedRef.current) {
        setOperation("preview");
        setError(null);
      }
      try {
        return await api.previewProjectPush(projectId, input, {
          signal: controller.signal,
        });
      } catch (caught) {
        const nextError = toError(caught);
        if (mountedRef.current) setError(nextError);
        throw nextError;
      } finally {
        if (pushAbortRef.current === controller) pushAbortRef.current = null;
        if (mountedRef.current) setOperation((current) => (current === "preview" ? null : current));
      }
    },
    [api],
  );

  const commitProjectPush = useCallback(
    async (projectId: string, previewToken: string) => {
      pushAbortRef.current?.abort();
      const controller = new AbortController();
      pushAbortRef.current = controller;
      if (mountedRef.current) {
        setOperation("commit");
        setError(null);
      }
      try {
        return await api.commitProjectPush(projectId, previewToken, {
          signal: controller.signal,
        });
      } catch (caught) {
        const nextError = toError(caught);
        if (mountedRef.current) setError(nextError);
        throw nextError;
      } finally {
        if (pushAbortRef.current === controller) pushAbortRef.current = null;
        if (mountedRef.current) setOperation((current) => (current === "commit" ? null : current));
      }
    },
    [api],
  );

  const checkLiveBridge = useCallback(async () => {
    if (liveBridgeRequestRef.current) return liveBridgeRequestRef.current;
    if (sessionRef.current?.status !== "connected") {
      throw new Error("请先连接 SillyTavern，再检查 Live Bridge。");
    }
    liveBridgeAbortRef.current?.abort();
    const controller = new AbortController();
    const generation = connectionGenerationRef.current;
    liveBridgeAbortRef.current = controller;
    const request = api.getLiveBridgeStatus({ signal: controller.signal });
    liveBridgeRequestRef.current = request;
    if (mountedRef.current) {
      setLiveBridgeOperation("check");
      setLiveBridgeError(null);
    }
    try {
      const status = await request;
      if (
        mountedRef.current
        && !controller.signal.aborted
        && generation === connectionGenerationRef.current
      ) {
        setLiveBridge(status);
      }
      return status;
    } catch (caught) {
      if (isAbortError(caught) || generation !== connectionGenerationRef.current) {
        throw caught;
      }
      const nextError = toError(caught);
      if (mountedRef.current) setLiveBridgeError(nextError);
      throw nextError;
    } finally {
      if (liveBridgeRequestRef.current === request) liveBridgeRequestRef.current = null;
      if (liveBridgeAbortRef.current === controller) liveBridgeAbortRef.current = null;
      if (mountedRef.current) {
        setLiveBridgeOperation((current) => (current === "check" ? null : current));
      }
    }
  }, [api]);

  const mutateLiveBridge = useCallback(async (
    nextOperation: Exclude<StLiveBridgeOperation, "check" | null>,
    action: (signal: AbortSignal) => Promise<StLiveBridgeMutationResult>,
  ) => {
    if (sessionRef.current?.status !== "connected") {
      throw new Error("请先连接 SillyTavern，再管理 Live Bridge。");
    }
    liveBridgeAbortRef.current?.abort();
    liveBridgeRequestRef.current = null;
    const controller = new AbortController();
    const generation = connectionGenerationRef.current;
    liveBridgeAbortRef.current = controller;
    if (mountedRef.current) {
      setLiveBridgeOperation(nextOperation);
      setLiveBridgeError(null);
    }
    try {
      const result = await action(controller.signal);
      if (
        mountedRef.current
        && !controller.signal.aborted
        && generation === connectionGenerationRef.current
      ) {
        setLiveBridge(result.liveBridge);
      }
      return result;
    } catch (caught) {
      if (isAbortError(caught) || generation !== connectionGenerationRef.current) {
        throw caught;
      }
      const nextError = toError(caught);
      if (mountedRef.current) setLiveBridgeError(nextError);
      throw nextError;
    } finally {
      if (liveBridgeAbortRef.current === controller) liveBridgeAbortRef.current = null;
      if (mountedRef.current) {
        setLiveBridgeOperation((current) => (current === nextOperation ? null : current));
      }
    }
  }, []);

  const installLiveBridge = useCallback(
    () => mutateLiveBridge(
      "install",
      (signal) => api.installLiveBridge({ signal }),
    ),
    [api, mutateLiveBridge],
  );

  const updateLiveBridge = useCallback(
    () => mutateLiveBridge(
      "update",
      (signal) => api.updateLiveBridge({ signal }),
    ),
    [api, mutateLiveBridge],
  );

  const uninstallLiveBridge = useCallback(
    () => mutateLiveBridge(
      "uninstall",
      (signal) => api.uninstallLiveBridge({ signal }),
    ),
    [api, mutateLiveBridge],
  );

  const presets = useMemo(() => catalog?.presets ?? [], [catalog?.presets]);
  const clearError = useCallback(() => setError(null), []);

  return {
    session,
    catalog,
    presets,
    rememberedOrigin,
    error,
    operation,
    liveBridge,
    liveBridgeError,
    liveBridgeOperation,
    isPageVisible,
    isRefreshingSession,
    refreshSession,
    connectSession,
    checkSession,
    disconnectSession,
    refreshPresets,
    readPreset,
    previewProjectPush,
    commitProjectPush,
    checkLiveBridge,
    installLiveBridge,
    updateLiveBridge,
    uninstallLiveBridge,
    clearError,
  };
}
