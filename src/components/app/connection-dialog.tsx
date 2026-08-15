import {
  CheckCircle2,
  CircleDot,
  Link2,
  LoaderCircle,
  Radio,
  RefreshCw,
  Server,
} from "lucide-react";
import { useState } from "react";

import type {
  StConnection,
  StExtensionArchiveDownload,
  StPairing,
} from "../../lib/st-bridge-api";
import { runSafely } from "../../lib/async";
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
import { StPairingCard } from "./st-pairing-card";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeConnection: StConnection | null;
  connections: StConnection[];
  pairing: StPairing | null;
  backendOnline: boolean;
  isLoading: boolean;
  isPairing: boolean;
  isDownloadingExtension: boolean;
  error?: string | null;
  onRefresh: () => void | Promise<unknown>;
  onCreatePairing: () => void | Promise<unknown>;
  onDownloadExtension: () => Promise<StExtensionArchiveDownload>;
  onRetryBackend: () => void | Promise<unknown>;
}

export function ConnectionDialog({
  open,
  onOpenChange,
  activeConnection,
  connections,
  pairing,
  backendOnline,
  isLoading,
  isPairing,
  isDownloadingExtension,
  error,
  onRefresh,
  onCreatePairing,
  onDownloadExtension,
  onRetryBackend,
}: ConnectionDialogProps) {
  const [showPairing, setShowPairing] = useState(false);
  const connectedCount = connections.filter((connection) => connection.status === "connected").length;
  const disconnectedCount = connections.length - connectedCount;

  const createNewPairing = () => {
    setShowPairing(true);
    return onCreatePairing();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Radio className="size-5" />
          </div>
          <DialogTitle>SillyTavern 连接</DialogTitle>
          <DialogDescription>
            浏览器只轮询本工具的 Node 服务；SillyTavern Bridge 扩展负责 WebSocket 与真实 ST 上下文。
          </DialogDescription>
        </DialogHeader>

        {activeConnection ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-success/20 bg-success-soft/70 p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-success shadow-xs">
                  <CheckCircle2 className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">连接正常</p>
                    <Badge variant="green">ST {activeConnection.st.version}</Badge>
                    {activeConnection.st.branch ? <Badge>{activeConnection.st.branch}</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {activeConnection.st.url ?? "ST 未报告页面 URL"} · Bridge {activeConnection.bridgeVersion}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ConnectionFact
                icon={Server}
                label="当前 Preset"
                value={contextValue(activeConnection, "currentPresetName") ?? "ST 未报告"}
              />
              <ConnectionFact
                icon={CircleDot}
                label="当前上下文"
                value={contextSummary(activeConnection)}
              />
              <ConnectionFact
                icon={Link2}
                label="连接 ID"
                value={activeConnection.connectionId}
                mono
              />
              <ConnectionFact
                icon={RefreshCw}
                label="最近心跳"
                value={formatDate(activeConnection.lastSeenAt)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/35 px-3 py-2 text-[11px] text-muted-foreground">
              <span>{connectedCount} 个在线连接</span>
              <span aria-hidden="true">·</span>
              <span>{disconnectedCount} 个可恢复会话</span>
              <span aria-hidden="true">·</span>
              <span>协议 v{activeConnection.protocolVersion}</span>
              <span aria-hidden="true">·</span>
              <span>{activeConnection.capabilities.length} 项能力</span>
            </div>

            {showPairing ? (
              <StPairingCard
                pairing={pairing}
                backendOnline={backendOnline}
                isPairing={isPairing}
                isDownloadingExtension={isDownloadingExtension}
                error={error}
                compact
                onCreatePairing={onCreatePairing}
                onDownloadExtension={onDownloadExtension}
                onRetryBackend={onRetryBackend}
              />
            ) : null}
          </div>
        ) : (
          <StPairingCard
            pairing={pairing}
            backendOnline={backendOnline}
            isPairing={isPairing}
            isDownloadingExtension={isDownloadingExtension}
            error={error}
            compact
            onCreatePairing={onCreatePairing}
            onDownloadExtension={onDownloadExtension}
            onRetryBackend={onRetryBackend}
          />
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>完成</Button>
          <Button variant="secondary" disabled={isLoading} onClick={() => runSafely(onRefresh)}>
            {isLoading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            刷新状态
          </Button>
          {activeConnection ? (
            <Button disabled={isPairing} onClick={() => runSafely(createNewPairing)}>
              <Link2 />
              重新配对
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectionFact({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={mono ? "truncate font-mono text-[11px] font-medium" : "truncate text-sm font-medium"} title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

function contextValue(connection: StConnection, key: string) {
  const value = connection.context?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function contextSummary(connection: StConnection) {
  const values = [
    contextValue(connection, "characterName"),
    contextValue(connection, "personaName"),
    contextValue(connection, "chatId"),
  ].filter((value): value is string => Boolean(value));
  return values.length ? values.join(" / ") : "ST 未报告";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
