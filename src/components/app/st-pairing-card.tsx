import { Check, Clipboard, Download, ExternalLink, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  deriveBridgeWebSocketUrl,
  type StExtensionArchiveDownload,
  type StPairing,
} from "../../lib/st-bridge-api";
import { runSafely } from "../../lib/async";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface StPairingCardProps {
  pairing: StPairing | null;
  backendOnline: boolean;
  isPairing: boolean;
  isDownloadingExtension: boolean;
  error?: string | null;
  compact?: boolean;
  onCreatePairing: () => void | Promise<unknown>;
  onDownloadExtension: () => Promise<StExtensionArchiveDownload>;
  onRetryBackend?: () => void | Promise<unknown>;
}

export function StPairingCard({
  pairing,
  backendOnline,
  isPairing,
  isDownloadingExtension,
  error,
  compact = false,
  onCreatePairing,
  onDownloadExtension,
  onRetryBackend,
}: StPairingCardProps) {
  const [copied, setCopied] = useState<"code" | "url" | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const secondsRemaining = usePairingCountdown(pairing?.expiresAt);
  const expired = pairing ? secondsRemaining <= 0 : false;
  const bridgeUrl = useMemo(
    () => (pairing ? deriveBridgeWebSocketUrl(pairing.bridgePath) : null),
    [pairing],
  );

  const copy = async (kind: "code" | "url", value: string) => {
    try {
      setCopyError(null);
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1_500);
    } catch {
      setCopyError("浏览器未允许写入剪贴板，请手动选择并复制。");
    }
  };

  const downloadExtension = async () => {
    try {
      const archive = await onDownloadExtension();
      triggerBlobDownload(archive.blob, archive.filename);
      toast.success("Bridge 扩展 ZIP 已下载", {
        description: `${archive.filename} · ${formatBytes(archive.size)}；请按包内 README 手动安装。`,
      });
    } catch (caught) {
      toast.error("Bridge 扩展下载失败", {
        description: caught instanceof Error ? caught.message : "无法获取扩展安装包。",
      });
    }
  };

  if (!backendOnline) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive-soft/55 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-destructive shadow-xs">
            <WifiOff className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">工程服务离线</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              配对码由 Node 服务生成。请先确认服务已启动以及 /api 代理可用。
            </p>
          </div>
        </div>
        {onRetryBackend ? (
          <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => runSafely(onRetryBackend)}>
            <RefreshCw />
            重试工程服务
          </Button>
        ) : null}
      </div>
    );
  }

  if (!pairing) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary-soft/35 p-4">
        <p className="text-sm font-medium">生成一次性配对码</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          在已安装 Preset Studio Bridge 的 SillyTavern 页面中输入配对码。浏览器工具只轮询 Node，不会直接建立 WebSocket。
        </p>
        <Button className="mt-4 w-full" disabled={isPairing} onClick={() => runSafely(onCreatePairing)}>
          {isPairing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {isPairing ? "正在生成…" : "生成配对码"}
        </Button>
        {error ? <PairingError message={error} /> : null}
        <InstallationGuide
          compact={compact}
          isDownloading={isDownloadingExtension}
          onDownload={() => void downloadExtension()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary-soft/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">SillyTavern 配对码</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {expired ? "该配对码已过期" : "等待 Bridge 扩展连接"}
          </p>
        </div>
        <Badge variant={expired ? "red" : "blue"}>{formatDuration(secondsRemaining)}</Badge>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-3">
        <code className="min-w-0 flex-1 break-all font-mono text-base font-semibold tracking-[0.08em]">
          {pairing.pairingCode}
        </code>
        <CopyButton
          label="复制配对码"
          copied={copied === "code"}
          onClick={() => void copy("code", pairing.pairingCode)}
        />
      </div>

      {bridgeUrl ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {bridgeUrl}
          </code>
          <CopyButton
            label="复制 Bridge URL"
            copied={copied === "url"}
            onClick={() => void copy("url", bridgeUrl)}
          />
        </div>
      ) : null}

      <Button
        variant={expired ? "default" : "secondary"}
        size="sm"
        className="w-full"
        disabled={isPairing}
        onClick={() => runSafely(onCreatePairing)}
      >
        {isPairing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        {expired ? "刷新配对码" : "生成新的配对码"}
      </Button>
      {error ? <PairingError message={error} /> : null}
      {copyError ? <PairingError message={copyError} /> : null}
      <InstallationGuide
        compact={compact}
        isDownloading={isDownloadingExtension}
        onDownload={() => void downloadExtension()}
      />
    </div>
  );
}

function CopyButton({
  label,
  copied,
  onClick,
}: {
  label: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick}>
      {copied ? <Check className="text-success" /> : <Clipboard />}
    </Button>
  );
}

function PairingError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">
      {message}
    </div>
  );
}

function InstallationGuide({
  compact,
  isDownloading,
  onDownload,
}: {
  compact: boolean;
  isDownloading: boolean;
  onDownload: () => void;
}) {
  return (
    <details className="group rounded-xl border border-border bg-surface px-3 py-2.5 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        <ExternalLink className="size-3.5 text-primary" />
        Bridge 安装与连接说明
      </summary>
      <div className="mt-3 border-t border-border pt-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={isDownloading}
          onClick={onDownload}
        >
          {isDownloading ? <LoaderCircle className="animate-spin" /> : <Download />}
          {isDownloading ? "正在生成扩展包…" : "下载 Bridge 扩展 ZIP"}
        </Button>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          仅下载安装包，不会自动安装或修改 SillyTavern。
        </p>
      </div>
      <ol className="mt-3 space-y-2 border-t border-border pt-3 leading-5 text-muted-foreground">
        <li>
          1. 打开项目源码中的 <code className="font-mono text-foreground">sillytavern-extension/README.md</code>，按说明将 <code className="font-mono text-foreground">sillytavern-extension/</code> 安装到当前 ST 并启用。
        </li>
        <li>2. 保持该 ST 页面打开，在扩展面板填写上方 Bridge URL 和配对码。</li>
        <li>3. 扩展连接成功后，本页会自动发现该 ST；工具不访问 ST 登录凭据、Cookie 或 secrets/API Key 存储。</li>
        <li>4. 完整 preset 快照本身可能包含 proxy_password、reverse_proxy、custom headers 等连接字段，并会被写入工程；请将工程目录、ZIP 和导出文件按敏感配置管理。</li>
        {!compact ? <li>5. 配对码只在有效期内可使用，成功连接后会被一次性消费。</li> : null}
      </ol>
    </details>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function usePairingCountdown(expiresAt?: string) {
  const deadline = expiresAt ? Date.parse(expiresAt) : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline || deadline <= Date.now()) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const nextNow = Date.now();
      setNow(nextNow);
      if (nextNow >= deadline) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);

  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1_000)) : 0;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
