import { AlertTriangle, CheckCircle2, Info, RefreshCw, XCircle } from "lucide-react";

import type { ProjectDiagnostic } from "../../lib/project-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function WorkspaceDiagnostics({
  diagnostics,
  stale,
  busy,
  onValidate,
  onOpenPath,
}: {
  diagnostics: ProjectDiagnostic[];
  stale?: boolean;
  busy?: boolean;
  onValidate?: () => void;
  onOpenPath?: (path: string) => void;
}) {
  const counts = { error: 0, warning: 0, info: 0 };
  diagnostics.forEach((item) => { counts[item.severity] += 1; });
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold">构建诊断</p>
          <div className="mt-1 flex gap-1.5">
            <Badge variant={counts.error ? "red" : "green"}>{counts.error} 错误</Badge>
            <Badge variant={counts.warning ? "amber" : "neutral"}>{counts.warning} 警告</Badge>
            <Badge>{counts.info} 信息</Badge>
          </div>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onValidate}><RefreshCw className={busy ? "animate-spin" : ""} />验证</Button>
      </div>
      {stale ? <div className="flex gap-2 rounded-xl border border-warning/25 bg-warning-soft/60 p-3 text-[11px] text-warning"><AlertTriangle className="size-4 shrink-0" />内容已变化，需要重新验证。</div> : null}
      {diagnostics.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center text-xs text-muted-foreground"><CheckCircle2 className="mb-2 size-7 text-success" />未报告构建问题</div>
      ) : (
        <div className="space-y-2">
          {diagnostics.map((diagnostic, index) => {
            const Icon = diagnostic.severity === "error" ? XCircle : diagnostic.severity === "warning" ? AlertTriangle : Info;
            return <button key={`${diagnostic.code}-${index}`} type="button" disabled={!diagnostic.path} onClick={() => diagnostic.path && onOpenPath?.(diagnostic.path)} className="flex w-full items-start gap-2 rounded-xl border border-border p-3 text-left disabled:cursor-default">
              <Icon className={diagnostic.severity === "error" ? "mt-0.5 size-4 text-destructive" : diagnostic.severity === "warning" ? "mt-0.5 size-4 text-warning" : "mt-0.5 size-4 text-primary"} />
              <span className="min-w-0"><span className="block text-xs font-medium">{diagnostic.message}</span>{diagnostic.path ? <span className="mt-1 block truncate font-mono text-[10px] text-primary">{diagnostic.path}</span> : null}{diagnostic.code ? <span className="mt-1 block font-mono text-[9px] text-muted-foreground">{diagnostic.code}</span> : null}</span>
            </button>;
          })}
        </div>
      )}
    </div>
  );
}
