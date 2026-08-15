import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  stBridgeApi,
  type StBridgeApi,
  type StConnection,
  type StExtensionArchiveDownload,
  type StPairing,
} from "../lib/st-bridge-api";

export interface UseStBridgeOptions {
  api?: StBridgeApi;
  enabled?: boolean;
  disconnectedPollMs?: number;
  connectedPollMs?: number;
  maxRetryMs?: number;
  onError?: (error: Error) => void;
}

export interface UseStBridgeResult {
  connections: StConnection[];
  connectedConnections: StConnection[];
  activeConnection: StConnection | null;
  pairing: StPairing | null;
  error: Error | null;
  isLoading: boolean;
  isPairing: boolean;
  isDownloadingExtension: boolean;
  isPageVisible: boolean;
  refreshConnections: () => Promise<StConnection[]>;
  retry: () => Promise<StConnection[]>;
  createPairing: () => Promise<StPairing>;
  downloadExtensionArchive: () => Promise<StExtensionArchiveDownload>;
  clearError: () => void;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
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

/** Polls only the Node service. The browser never opens a Bridge WebSocket. */
export function useStBridge(options: UseStBridgeOptions = {}): UseStBridgeResult {
  const api = options.api ?? stBridgeApi;
  const enabled = options.enabled ?? true;
  const disconnectedPollMs = Math.max(1_000, options.disconnectedPollMs ?? 3_000);
  const connectedPollMs = Math.max(3_000, options.connectedPollMs ?? 10_000);
  const maxRetryMs = Math.max(connectedPollMs, options.maxRetryMs ?? 30_000);

  const [connections, setConnections] = useState<StConnection[]>([]);
  const [pairing, setPairing] = useState<StPairing | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [isDownloadingExtension, setIsDownloadingExtension] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  const mountedRef = useRef(false);
  const connectionsRef = useRef<StConnection[]>([]);
  const requestRef = useRef<Promise<StConnection[]> | null>(null);
  const connectionAbortRef = useRef<AbortController | null>(null);
  const pairingAbortRef = useRef<AbortController | null>(null);
  const extensionAbortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const onErrorRef = useRef(options.onError);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectionAbortRef.current?.abort();
      pairingAbortRef.current?.abort();
      extensionAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const refreshConnections = useCallback(async () => {
    if (requestRef.current) return requestRef.current;

    const controller = new AbortController();
    connectionAbortRef.current = controller;
    if (mountedRef.current) setIsLoading(true);

    const request = api.listConnections({ signal: controller.signal });
    requestRef.current = request;
    try {
      const nextConnections = await request;
      if (controller.signal.aborted) return connectionsRef.current;
      connectionsRef.current = nextConnections;
      retryCountRef.current = 0;
      if (mountedRef.current) {
        setConnections(nextConnections);
        setError(null);
      }
      return nextConnections;
    } catch (caught) {
      if (isAbortError(caught)) return connectionsRef.current;
      const nextError = toError(caught);
      retryCountRef.current += 1;
      if (mountedRef.current) setError(nextError);
      onErrorRef.current?.(nextError);
      throw nextError;
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      if (connectionAbortRef.current === controller) connectionAbortRef.current = null;
      if (mountedRef.current) setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!enabled || !isPageVisible) {
      connectionAbortRef.current?.abort();
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        await refreshConnections();
      } catch {
        // Error state and retry count are maintained by refreshConnections.
      }
      if (cancelled) return;

      const hasConnectedSession = connectionsRef.current.some(
        (connection) => connection.status === "connected",
      );
      const baseDelay = hasConnectedSession ? connectedPollMs : disconnectedPollMs;
      const retryDelay = Math.min(
        maxRetryMs,
        baseDelay * 2 ** Math.min(retryCountRef.current, 4),
      );
      timer = setTimeout(poll, retryCountRef.current ? retryDelay : baseDelay);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [connectedPollMs, disconnectedPollMs, enabled, isPageVisible, maxRetryMs, refreshConnections]);

  const createPairing = useCallback(async () => {
    pairingAbortRef.current?.abort();
    const controller = new AbortController();
    pairingAbortRef.current = controller;
    if (mountedRef.current) {
      setIsPairing(true);
      setError(null);
    }

    try {
      const nextPairing = await api.createPairing({ signal: controller.signal });
      if (!controller.signal.aborted && mountedRef.current) setPairing(nextPairing);
      return nextPairing;
    } catch (caught) {
      if (isAbortError(caught)) throw caught;
      const nextError = toError(caught);
      if (mountedRef.current) setError(nextError);
      onErrorRef.current?.(nextError);
      throw nextError;
    } finally {
      if (pairingAbortRef.current === controller) pairingAbortRef.current = null;
      if (mountedRef.current) setIsPairing(false);
    }
  }, [api]);

  const downloadExtensionArchive = useCallback(async () => {
    extensionAbortRef.current?.abort();
    const controller = new AbortController();
    extensionAbortRef.current = controller;
    if (mountedRef.current) {
      setIsDownloadingExtension(true);
      setError(null);
    }

    try {
      return await api.downloadExtensionArchive({ signal: controller.signal });
    } catch (caught) {
      if (isAbortError(caught)) throw caught;
      const nextError = toError(caught);
      if (mountedRef.current) setError(nextError);
      onErrorRef.current?.(nextError);
      throw nextError;
    } finally {
      if (extensionAbortRef.current === controller) extensionAbortRef.current = null;
      if (mountedRef.current) setIsDownloadingExtension(false);
    }
  }, [api]);

  const connectedConnections = useMemo(
    () => connections.filter((connection) => connection.status === "connected"),
    [connections],
  );
  const activeConnection = connectedConnections[0] ?? null;
  const clearError = useCallback(() => setError(null), []);

  return {
    connections,
    connectedConnections,
    activeConnection,
    pairing,
    error,
    isLoading,
    isPairing,
    isDownloadingExtension,
    isPageVisible,
    refreshConnections,
    retry: refreshConnections,
    createPairing,
    downloadExtensionArchive,
    clearError,
  };
}
