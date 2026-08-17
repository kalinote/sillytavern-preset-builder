import { useEffect, useState, type FormEvent } from "react";

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

interface TextInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  inputLabel: string;
  initialValue: string;
  confirmLabel: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
}

export function TextInputDialog({
  open,
  onOpenChange,
  title,
  description,
  inputLabel,
  initialValue,
  confirmLabel,
  busy = false,
  onSubmit,
}: TextInputDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized || busy) return;
    onSubmit(normalized);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent>
        <form className="grid gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            {inputLabel}
            <Input
              autoFocus
              value={value}
              disabled={busy}
              maxLength={120}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy ? "处理中…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
