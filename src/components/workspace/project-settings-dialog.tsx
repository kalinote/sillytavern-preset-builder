import { useEffect, useState } from "react";

import type { Project } from "../../lib/project-api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
  busy,
  previewOrigin,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  busy?: boolean;
  previewOrigin?: string;
  onSave: (input: {
    name: string;
    version: string;
    targetPresetName: string;
    preview: { javascriptEnabled: boolean };
  }) => void;
}) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [targetPresetName, setTargetPresetName] = useState("");
  const [javascriptEnabled, setJavascriptEnabled] = useState(false);
  useEffect(() => {
    if (!open || !project) return;
    setName(project.name);
    setVersion(project.version ?? "");
    setTargetPresetName(project.targetPresetName ?? project.name);
    setJavascriptEnabled(project.preview.javascriptEnabled);
  }, [open, project]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>工程设置</DialogTitle><DialogDescription>修改工程身份信息和默认 SillyTavern 推送目标。</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <Field label="工程名称"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Version"><Input value={version} onChange={(event) => setVersion(event.target.value)} /></Field>
        <Field label="默认 ST 目标 preset"><Input value={targetPresetName} onChange={(event) => setTargetPresetName(event.target.value)} /></Field>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <div>
            <p className="text-xs font-medium">允许动态 JavaScript 预览</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              开启后可手动运行已启用的 Tavern Helper content.js 和消息 HTML。脚本能够联网并产生外部副作用；关闭不会改变预设内脚本的 enabled 状态。
            </p>
          </div>
          <Switch
            checked={javascriptEnabled}
            onCheckedChange={setJavascriptEnabled}
            aria-label="允许动态 JavaScript 预览"
          />
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/25 p-3 text-[10px] text-muted-foreground">
          <span>Preview Host</span><code className="truncate">{previewOrigin ?? "未配置"}</code>
          <span>兼容运行时</span><span>Preset Studio M3</span>
          <span>固定基础库</span><span>jQuery 3.7.1 · Lodash 4.17.21 · js-yaml 4.1.0 · Showdown 2.1.0 · Toastr 2.1.4 · Zod 3.24.2 · EJS 3.1.10</span>
        </div>
        {project ? <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-muted/40 p-3 text-[10px] text-muted-foreground"><span>工程 ID</span><code className="truncate">{project.id}</code><span>来源</span><span>{project.source}</span><span>创建时间</span><span>{new Date(project.createdAt).toLocaleString()}</span><span>原始 hash</span><code className="truncate">{project.originalHash ?? "无"}</code></div> : null}
      </div>
      <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button><Button disabled={busy || !name.trim() || !targetPresetName.trim()} onClick={() => onSave({ name, version, targetPresetName, preview: { javascriptEnabled } })}>保存设置</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5 text-xs font-medium"><span>{label}</span>{children}</label>; }
