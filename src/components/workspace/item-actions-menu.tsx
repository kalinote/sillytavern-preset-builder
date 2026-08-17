import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import type { ProjectItemKind } from "../../lib/project-api";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface ItemActionsMenuProps {
  kind: ProjectItemKind;
  name: string;
  disabled?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function ItemActionsMenu({
  kind,
  name,
  disabled,
  canMoveUp,
  canMoveDown,
  onRename,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: ItemActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100"
          aria-label={`${name} 条目操作`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />重命名
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy />复制 {kindLabel(kind)}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onMoveUp} disabled={!canMoveUp}>
          <ArrowUp />上移 <span className="ml-auto text-[10px] text-muted-foreground">Alt+↑</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMoveDown} disabled={!canMoveDown}>
          <ArrowDown />下移 <span className="ml-auto text-[10px] text-muted-foreground">Alt+↓</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 />永久删除条目
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function kindLabel(kind: ProjectItemKind) {
  if (kind === "prompt") return "Prompt";
  if (kind === "regex") return "Regex";
  return "Script";
}
