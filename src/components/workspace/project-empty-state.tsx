import { Braces, FolderOpen, Plus, RadioTower, ServerOff } from "lucide-react";

import { Button } from "../ui/button";

interface ProjectEmptyStateProps {
  backendOnline: boolean;
  loading?: boolean;
  error?: string;
  onOpenProjects: () => void;
  onRetry: () => void;
}

export function ProjectEmptyState({
  backendOnline,
  loading,
  error,
  onOpenProjects,
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
            {backendOnline ? "创建第一个 Preset 工程" : "工程服务尚未连接"}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
            {backendOnline
              ? "从已连接 SillyTavern 的当前 Chat Completion preset 创建一次性工程快照，也可导入文件或创建空白工程。所有实时保存只写入服务端工作区。"
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
                <Button onClick={onOpenProjects} disabled={loading}>
                  <RadioTower />
                  从 ST 当前 preset 创建
                </Button>
                <Button variant="secondary" onClick={onOpenProjects} disabled={loading}>
                  <Plus />
                  其他创建方式
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
