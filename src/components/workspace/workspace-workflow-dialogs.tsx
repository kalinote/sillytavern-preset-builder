import { AlertTriangle, LoaderCircle, Save, Trash2, Undo2 } from "lucide-react";

import type { ProjectChoice } from "./project-manager-dialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function ExplicitDraftDialog({
  open,
  busy,
  actionLabel,
  onApply,
  onDiscard,
  onCancel,
}: {
  open: boolean;
  busy?: boolean;
  actionLabel?: string;
  onApply: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-warning-soft text-warning">
            <AlertTriangle className="size-5" />
          </div>
          <DialogTitle>完整 JSON 尚未应用</DialogTitle>
          <DialogDescription>
            当前草稿只保存在这个浏览器页面中。应用会校验完整 JSON 并重新拆分工程；放弃会恢复服务器上最近一次成功保存的版本。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>取消</Button>
          <Button variant="secondary" disabled={busy} onClick={onDiscard}>
            <Undo2 />
            放弃并{actionLabel ?? "继续"}
          </Button>
          <Button disabled={busy} onClick={onApply}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Save />}
            应用并{actionLabel ?? "继续"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteProjectDialog({
  project,
  busy,
  onConfirm,
  onCancel,
}: {
  project: ProjectChoice | null;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-destructive-soft text-destructive">
            <Trash2 className="size-5" />
          </div>
          <DialogTitle>永久删除服务器工程？</DialogTitle>
          <DialogDescription>
            工程“{project?.name}”的拆分源码、构建输出、快照和恢复文件都会被永久删除，且无法撤销。SillyTavern 中的同名 preset 不会受到影响。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-destructive/20 bg-destructive-soft/60 px-4 py-3 text-sm font-medium text-destructive">
          删除目标：{project?.name}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            永久删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
