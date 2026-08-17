import { useEffect, useState } from "react";

import type { Project } from "../../lib/project-api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  busy?: boolean;
  onSave: (input: { name: string; version: string; targetPresetName: string }) => void;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [targetPresetName, setTargetPresetName] = useState("");
  useEffect(() => {
    if (!open || !project) return;
    setName(project.name);
    setVersion(project.version ?? "");
    setTargetPresetName(project.targetPresetName ?? project.name);
  }, [open, project]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>工程设置</DialogTitle><DialogDescription>修改工程身份信息和默认 SillyTavern 推送目标。</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <Field label="工程名称"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Version"><Input value={version} onChange={(event) => setVersion(event.target.value)} /></Field>
        <Field label="默认 ST 目标 preset"><Input value={targetPresetName} onChange={(event) => setTargetPresetName(event.target.value)} /></Field>
        {project ? <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-muted/40 p-3 text-[10px] text-muted-foreground"><span>工程 ID</span><code className="truncate">{project.id}</code><span>来源</span><span>{project.source}</span><span>创建时间</span><span>{new Date(project.createdAt).toLocaleString()}</span><span>原始 hash</span><code className="truncate">{project.originalHash ?? "无"}</code></div> : null}
      </div>
      <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={busy || !name.trim() || !targetPresetName.trim()} onClick={() => onSave({ name, version, targetPresetName })}>保存设置</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5 text-xs font-medium"><span>{label}</span>{children}</label>; }
