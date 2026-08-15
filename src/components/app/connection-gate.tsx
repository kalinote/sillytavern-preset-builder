import {
  ArrowRight,
  Braces,
  DatabaseZap,
  LoaderCircle,
  RadioTower,
  Server,
  type LucideIcon,
} from "lucide-react";

import type { StExtensionArchiveDownload, StPairing } from "../../lib/st-bridge-api";
import { runSafely } from "../../lib/async";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { StPairingCard } from "./st-pairing-card";

interface ConnectionGateProps {
  backendOnline: boolean;
  pairing: StPairing | null;
  isPairing: boolean;
  isDownloadingExtension: boolean;
  isCheckingConnections: boolean;
  error?: string | null;
  onCreatePairing: () => void | Promise<unknown>;
  onDownloadExtension: () => Promise<StExtensionArchiveDownload>;
  onRetryBackend: () => void | Promise<unknown>;
  onRetryConnections: () => void | Promise<unknown>;
}

export function ConnectionGate({
  backendOnline,
  pairing,
  isPairing,
  isDownloadingExtension,
  isCheckingConnections,
  error,
  onCreatePairing,
  onDownloadExtension,
  onRetryBackend,
  onRetryConnections,
}: ConnectionGateProps) {
  return (
    <main className="relative min-h-0 flex-1 overflow-y-auto bg-background px-4 py-6 sm:px-6 sm:py-10">
      <div className="gate-orb gate-orb-left" />
      <div className="gate-orb gate-orb-right" />

      <section className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-surface shadow-xl shadow-slate-200/55">
        <div className="grid lg:grid-cols-[1.02fr_.98fr]">
          <div className="p-6 sm:p-9 lg:p-11">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
                  <Braces className="size-5" />
                </span>
                <div>
                  <p className="text-base font-semibold">Preset Studio</p>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    SillyTavern Preset IDE
                  </p>
                </div>
              </div>
              <Badge variant={backendOnline ? "green" : "red"}>
                <Server className="size-3" />
                {backendOnline ? "工程服务正常" : "工程服务离线"}
              </Badge>
            </div>

            <h1 className="mt-8 max-w-xl text-3xl font-semibold tracking-[-0.035em] text-foreground sm:text-4xl">
              先连接正在使用的 SillyTavern。
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
              第一版需要真实 ST 提供当前 preset 与运行上下文。连接前不会开放完整工程工作台；工程服务状态仍可在这里独立检查。
            </p>

            <div className="mt-7">
              <StPairingCard
                pairing={pairing}
                backendOnline={backendOnline}
                isPairing={isPairing}
                isDownloadingExtension={isDownloadingExtension}
                error={error}
                onCreatePairing={onCreatePairing}
                onDownloadExtension={onDownloadExtension}
                onRetryBackend={onRetryBackend}
              />
            </div>

            {backendOnline ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-3 w-full text-muted-foreground"
                disabled={isCheckingConnections}
                onClick={() => runSafely(onRetryConnections)}
              >
                {isCheckingConnections ? <LoaderCircle className="animate-spin" /> : <RadioTower />}
                {isCheckingConnections ? "正在检查连接…" : "立即检查 ST 连接"}
              </Button>
            ) : null}
          </div>

          <div className="border-t border-border bg-sidebar p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              连接后的工作流
            </p>
            <div className="mt-5 space-y-3">
              <GateFeature
                icon={RadioTower}
                step="01"
                title="从当前 Preset 建立快照"
                description="选择已连接会话，单向拉取 ST 当前 preset 并拆分为新工程。"
              />
              <GateFeature
                icon={DatabaseZap}
                step="02"
                title="自动保存工程"
                description="编辑内容只写入服务端工程，不会持续同步或修改 ST。"
              />
              <GateFeature
                icon={ArrowRight}
                step="03"
                title="静态预览与后续真实运行"
                description="本地只预览 HTML/CSS；推送与 ST 真实运行在相应功能完成后开放。"
              />
            </div>

            <div className="mt-5 rounded-2xl border border-border bg-surface p-4 text-xs leading-5 text-muted-foreground shadow-xs">
              Preset Studio 不访问 ST 登录凭据、Cookie 或 secrets/API Key 存储。Bridge 拉取的是完整 preset 快照；若 preset 本身包含 proxy_password、reverse_proxy、custom headers 等连接字段，它们会随快照写入工程，请将工程目录、ZIP 和导出文件按敏感配置管理。
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function GateFeature({
  icon: Icon,
  step,
  title,
  description,
}: {
  icon: LucideIcon;
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xs">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-primary">{step}</span>
          <p className="text-sm font-medium">{title}</p>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
