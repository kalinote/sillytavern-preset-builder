import {
  ArrowRight,
  CheckCircle2,
  FileJson2,
  GitCompareArrows,
  RadioTower,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
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
}

export function PushDialog({ open, onOpenChange }: PushDialogProps) {
  const completePush = (activate: boolean) => {
    onOpenChange(false);
    toast.success(activate ? "Preset 已推送并在 ST 中应用" : "Preset 已推送到 ST", {
      description: "工程仍保持自动保存；后续修改不会自动同步。",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <RadioTower className="size-5" />
          </div>
          <DialogTitle>推送 Preset 到 SillyTavern</DialogTitle>
          <DialogDescription>
            推送是手动操作。工程自动保存、导出 JSON 和关闭页面都不会修改 ST。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="preset-target"
              className="mb-1.5 block text-xs font-medium text-muted-foreground"
            >
              ST 目标 Preset
            </label>
            <Input id="preset-target" defaultValue="V18 狐神抚 · 毓忻" />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <PresetVersionCard
              title="ST 当前版本"
              detail="最后更新 16:42"
              count="217 prompts"
            />
            <ArrowRight className="mx-auto hidden size-5 text-muted-foreground sm:block" />
            <PresetVersionCard
              title="工程构建版本"
              detail="刚刚自动保存"
              count="217 prompts"
              active
            />
          </div>

          <div className="rounded-xl border border-border bg-muted/35 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <GitCompareArrows className="size-4 text-primary" />
                <p className="text-sm font-medium">差异摘要</p>
              </div>
              <Badge variant="amber">3 项变更</Badge>
            </div>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <DiffFact label="Prompt" value="2 已修改" />
              <DiffFact label="Regex" value="1 已修改" />
              <DiffFact label="镜像校验" value="3/3 一致" success />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-success/20 bg-success-soft/55 p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <p className="text-xs leading-5 text-muted-foreground">
              构建校验已通过：Prompt 引用完整，40 条 Regex
              镜像一致，未知字段将被保留。
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">取消</Button>
          </DialogClose>
          <Button variant="secondary" onClick={() => completePush(false)}>
            <FileJson2 />
            仅推送保存
          </Button>
          <Button onClick={() => completePush(true)}>
            <RadioTower />
            推送并应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PresetVersionCard({
  title,
  detail,
  count,
  active,
}: {
  title: string;
  detail: string;
  count: string;
  active?: boolean;
}) {
  return (
    <div
      className={
        active
          ? "rounded-xl border border-primary/25 bg-primary-soft/60 p-4"
          : "rounded-xl border border-border bg-surface p-4"
      }
    >
      <div className="flex items-center gap-2">
        <FileJson2 className={active ? "size-4 text-primary" : "size-4 text-muted-foreground"} />
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      <p className="mt-1 font-mono text-xs text-foreground">{count}</p>
    </div>
  );
}

function DiffFact({
  label,
  value,
  success,
}: {
  label: string;
  value: string;
  success?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p
        className={
          success
            ? "mt-0.5 text-xs font-medium text-success"
            : "mt-0.5 text-xs font-medium text-foreground"
        }
      >
        {value}
      </p>
    </div>
  );
}
