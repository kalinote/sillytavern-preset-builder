import { RotateCcw, Trash2 } from "lucide-react";

import type { ProjectSnapshotSummary } from "../../lib/project-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function SnapshotHistoryDialog({
  open,
  onOpenChange,
  snapshots,
  busy,
  onRestore,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshots: ProjectSnapshotSummary[];
  busy?: boolean;
  onRestore: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[80vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)]">
      <DialogHeader><DialogTitle>快照历史</DialogTitle><DialogDescription>恢复会替换当前受管源码，并先自动创建“恢复前”快照。</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-2 overflow-y-auto">
        {[...snapshots].reverse().map((snapshot) => <div key={snapshot.uid} className="flex items-center gap-3 rounded-xl border border-border p-3">
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-xs font-medium">{snapshot.label}</p><Badge variant={snapshot.kind === "manual" ? "blue" : "neutral"}>{snapshot.kind === "manual" ? "手动" : "自动"}</Badge></div><p className="mt-1 text-[10px] text-muted-foreground">{reasonLabel(snapshot.reason)} · {new Date(snapshot.createdAt).toLocaleString()} · {formatBytes(snapshot.size)}</p><p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">{snapshot.presetRevision}</p></div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => {
            if (window.confirm(`恢复快照“${snapshot.label}”？当前未提交草稿需要先处理，恢复前会自动创建快照。`)) onRestore(snapshot.uid);
          }}><RotateCcw />恢复</Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => {
            if (window.confirm(`永久删除快照“${snapshot.label}”？`)) onDelete(snapshot.uid);
          }}><Trash2 /><span className="sr-only">删除快照</span></Button>
        </div>)}
        {snapshots.length === 0 ? <p className="py-12 text-center text-xs text-muted-foreground">还没有快照</p> : null}
      </div>
    </DialogContent>
  </Dialog>;
}

function reasonLabel(reason: ProjectSnapshotSummary["reason"]) { const labels = { manual: "手动创建", "before-item-delete": "删除条目前", "before-source-json-apply": "应用完整 JSON 前", "before-snapshot-restore": "恢复快照前" }; return labels[reason]; }
function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
