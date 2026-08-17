import { Braces, FolderOpen, Plus, RadioTower, ServerOff } from "lucide-react";

import { Button } from "../ui/button";

interface ProjectEmptyStateProps {
  backendOnline: boolean;
  stConnected: boolean;
  hasProjects: boolean;
  loading?: boolean;
  error?: string;
  onOpenProjects: () => void;
  onOpenConnection: () => void;
  onRetry: () => void;
}

export function ProjectEmptyState({
  backendOnline,
  stConnected,
  hasProjects,
  loading,
  error,
  onOpenProjects,
  onOpenConnection,
  onRetry,
}: ProjectEmptyStateProps) {
  return (
    <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-background px-5 py-10">
      <section className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-surface shadow-xl shadow-slate-200/50">
        <div className="p-7 sm:p-10">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
            {backendOnline ? <Braces className="size-5" /> : <ServerOff className="size-5" />}
          </span>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight sm:text-3xl">
            {backendOnline
              ? hasProjects
                ? "当前未打开工程"
                : "创建第一个 Preset 工程"
              : "工程服务尚未连接"}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            {backendOnline
              ? hasProjects
                ? "工作台已关闭，服务器上的工程文件仍然保留。可以重新打开已有工程，也可以导入或创建新工程。"
                : "可以从 SillyTavern catalog 明确选择一个 Chat Completion preset 创建快照，也可直接导入文件或创建空白工程。ST 暂时离线不会阻止本地工程操作。"
              : "前端已经运行，但没有连接到 Node 工程服务。请使用新的 pnpm dev 启动方式，或检查 /api/health。"}
          </p>

          {error && (
            <div className="mt-5 rounded-xl border border-destructive/20 bg-destructive-soft p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            {backendOnline ? (
              <>
                <Button
                  onClick={hasProjects || stConnected ? onOpenProjects : onOpenConnection}
                  disabled={loading}
                >
                  {hasProjects ? <FolderOpen /> : <RadioTower />}
                  {hasProjects
                    ? "打开或管理工程"
                    : stConnected
                      ? "从 ST 选择 preset"
                      : "连接 SillyTavern"}
                </Button>
                <Button variant="secondary" onClick={onOpenProjects} disabled={loading}>
                  <Plus />
                  {hasProjects ? "创建或导入工程" : "其他创建方式"}
                </Button>
              </>
            ) : (
              <Button onClick={onRetry} disabled={loading}>
                <FolderOpen />
                重新连接工程服务
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
