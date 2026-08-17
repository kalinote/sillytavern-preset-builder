import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileJson2,
  GitCompareArrows,
  LoaderCircle,
  RadioTower,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import type { StOperation } from "../../hooks/use-st-connection";
import type {
  StPushMode,
  StPushPreview,
  StPushResult,
} from "../../lib/st-api";
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

interface PushDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  defaultTargetName: string;
  presetNames?: string[];
  operation: StOperation;
  onPreview: (
    projectId: string,
    input: { targetName: string; mode: StPushMode },
  ) => Promise<StPushPreview>;
  onCommit: (projectId: string, previewToken: string) => Promise<StPushResult>;
}

export function PushDialog({
  open,
  onOpenChange,
  projectId,
  defaultTargetName,
  presetNames = [],
  operation,
  onPreview,
  onCommit,
}: PushDialogProps) {
  const [targetName, setTargetName] = useState(defaultTargetName);
  const [mode, setMode] = useState<StPushMode>("create");
  const [preview, setPreview] = useState<StPushPreview | null>(null);
  const [result, setResult] = useState<StPushResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = operation === "preview" || operation === "commit";

  const reset = () => {
    setTargetName(defaultTargetName);
    setMode("create");
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const invalidatePreview = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const requestPreview = async () => {
    const normalizedTarget = targetName.trim();
    if (!normalizedTarget) {
      setError("请输入目标 preset 名称。");
      return;
    }
    setError(null);
    setResult(null);
    try {
      setPreview(await onPreview(projectId, { targetName: normalizedTarget, mode }));
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "无法生成推送预览。");
    }
  };

  const commit = async () => {
    if (!preview?.canCommit) return;
    setError(null);
    try {
      setResult(await onCommit(projectId, preview.previewToken));
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存到 SillyTavern 失败。");
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <RadioTower className="size-5" />
          </div>
          <DialogTitle>保存 Preset 到 SillyTavern</DialogTitle>
          <DialogDescription>
            先由服务端构建并核对目标状态，再用一次性 preview token 提交。此操作只保存文件，不会切换已打开的 ST 页面。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!result ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    ST 目标 Preset
                  </span>
                  <Input
                    value={targetName}
                    onChange={(event) => {
                      setTargetName(event.target.value);
                      invalidatePreview();
                    }}
                    list="st-push-preset-names"
                    disabled={busy}
                    placeholder="输入目标 preset 名称"
                  />
                  <datalist id="st-push-preset-names">
                    {presetNames.map((name) => <option key={name} value={name} />)}
                  </datalist>
                </label>
                <label>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    保存策略
                  </span>
                  <select
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value as StPushMode);
                      invalidatePreview();
                    }}
                    disabled={busy}
                    className="flex h-9 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
                  >
                    <option value="overwrite">覆盖已有 preset</option>
                    <option value="create">仅新建 preset</option>
                  </select>
                </label>
              </div>

              <div className="rounded-xl border border-border bg-muted/35 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                “仅新建”要求目标不存在；“覆盖”要求目标已经存在。预览会验证这一条件，且 token 有效期约 5 分钟并只能尝试提交一次。
              </div>

              {preview ? <PreviewPanel preview={preview} mode={mode} /> : null}
            </>
          ) : (
            <PushSuccess result={result} />
          )}

          {error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>
            {result ? "完成" : "取消"}
          </Button>
          {!result ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void requestPreview()}>
                {operation === "preview" ? <LoaderCircle className="animate-spin" /> : preview ? <RefreshCw /> : <GitCompareArrows />}
                {preview ? "重新生成预览" : "生成真实预览"}
              </Button>
              <Button disabled={busy || !preview?.canCommit} onClick={() => void commit()}>
                {operation === "commit" ? <LoaderCircle className="animate-spin" /> : <FileJson2 />}
                确认保存到 ST
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewPanel({ preview, mode }: { preview: StPushPreview; mode: StPushMode }) {
  const unchanged = preview.change === "unchanged";
  return (
    <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary-soft/25 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="size-4 text-primary" />
          <p className="text-sm font-medium">服务端推送预览</p>
        </div>
        <Badge variant={unchanged ? "green" : preview.canCommit ? "blue" : "red"}>
          {changeLabel(preview.change)}
        </Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <PreviewFact label="目标" value={preview.target.name} />
        <PreviewFact label="策略" value={mode === "create" ? "仅新建" : "覆盖已有"} />
        <PreviewFact label="ST 当前 revision" value={preview.target.revision?.slice(0, 16) ?? "目标不存在"} mono />
        <PreviewFact label="构建 revision" value={preview.build.revision.slice(0, 16)} mono />
        <PreviewFact label="构建大小" value={formatBytes(preview.build.size)} />
        <PreviewFact label="Token 到期" value={formatDate(preview.expiresAt)} />
      </div>
      {preview.build.diagnostics.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-soft/55 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">{preview.build.diagnostics.length} 条构建诊断</p>
            {preview.build.diagnostics.slice(0, 3).map((diagnostic, index) => (
              <p key={index} className="break-words">{formatDiagnostic(diagnostic)}</p>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-success/20 bg-success-soft/55 p-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <p className="text-[11px] leading-5 text-muted-foreground">
            构建未报告诊断；{unchanged ? "目标内容已一致，无需提交。" : preview.canCommit ? "可以使用此 preview token 保存。" : "当前目标策略不允许提交。"}
          </p>
        </div>
      )}
    </div>
  );
}

function PushSuccess({ result }: { result: StPushResult }) {
  return (
    <div className="space-y-4 rounded-2xl border border-success/25 bg-success-soft/50 p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
        <div>
          <p className="text-sm font-medium">Preset 已保存到 SillyTavern</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {result.presetName} · {outcomeLabel(result.outcome)} · {formatDate(result.savedAt)}
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-warning/25 bg-warning-soft/60 p-3 text-xs leading-5 text-muted-foreground">
        HTTP 保存不会让已经打开的 ST 页面热切换。请打开或刷新 SillyTavern，手动选择“{result.presetName}”，再发起测试对话检查最终 Prompt、Regex、HTML 和 JavaScript 交互。
      </div>
      <a
        href={result.stUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 text-xs font-medium text-primary hover:underline"
      >
        打开 SillyTavern 手动测试
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function PreviewFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={mono ? "mt-0.5 truncate font-mono text-[11px] font-medium" : "mt-0.5 truncate text-xs font-medium"} title={value}>
        {value}
      </p>
    </div>
  );
}

function changeLabel(change: StPushPreview["change"]) {
  if (change === "created") return "将创建";
  if (change === "changed") return "内容有变更";
  return "内容一致";
}

function outcomeLabel(outcome: StPushResult["outcome"]) {
  if (outcome === "created") return "已新建";
  if (outcome === "overwritten") return "已覆盖";
  return "内容原本一致";
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

function formatDiagnostic(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
