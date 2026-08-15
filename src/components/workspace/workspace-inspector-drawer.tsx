import type { ComponentProps, RefObject } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { WorkspaceInspector } from "./workspace-inspector";

type WorkspaceInspectorDrawerProps = ComponentProps<
  typeof WorkspaceInspector
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * Keyboard-accessible inspector for the two-column tablet workbench.
 * The inspector itself stays shared with the wide desktop and mobile layouts.
 */
export function WorkspaceInspectorDrawer({
  open,
  onOpenChange,
  triggerRef,
  ...inspectorProps
}: WorkspaceInspectorDrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="workspace-inspector-drawer"
        data-testid="medium-inspector-drawer"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        className="inset-y-0 left-auto right-0 top-0 flex h-[100dvh] w-[min(420px,calc(100vw-1rem))] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-l-2xl rounded-r-none border-y-0 border-r-0 p-0 shadow-2xl data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
      >
        <DialogHeader className="h-13 shrink-0 justify-center space-y-0 border-b border-border px-4 pr-14">
          <DialogTitle className="text-sm">检查器与静态预览</DialogTitle>
          <DialogDescription className="sr-only">
            查看当前工程文件信息或切换到隔离的 HTML 与 CSS 静态预览。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <WorkspaceInspector
            {...inspectorProps}
            className="w-full border-l-0"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
