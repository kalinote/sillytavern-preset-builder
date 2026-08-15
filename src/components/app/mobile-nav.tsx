import { Braces, Eye, Files, RadioTower } from "lucide-react";

import { cn } from "../../lib/utils";

export type MobileView = "structure" | "editor" | "preview" | "runtime";

interface MobileNavProps {
  value: MobileView;
  onChange: (value: MobileView) => void;
  connected: boolean;
  runtimeAvailable?: boolean;
}

const items = [
  { value: "structure", label: "结构", icon: Files },
  { value: "editor", label: "编辑", icon: Braces },
  { value: "preview", label: "预览", icon: Eye },
  { value: "runtime", label: "ST 调试", icon: RadioTower },
] as const;

export function MobileNav({ value, onChange, connected, runtimeAvailable = false }: MobileNavProps) {
  return (
    <nav
      className="grid h-16 shrink-0 grid-cols-4 border-t border-border bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="移动端工作台导航"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.value === value;
        const disabled = item.value === "runtime" && !runtimeAvailable;
        return (
          <button
            key={item.value}
            type="button"
            disabled={disabled}
            title={disabled ? "ST 真实运行调试尚未实现" : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
              active ? "text-primary" : "text-muted-foreground",
              disabled && "opacity-45",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-10 items-center justify-center rounded-full transition-colors",
                active && "bg-primary-soft",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="truncate">{item.label}</span>
            {item.value === "runtime" && (
              <span
                className={cn(
                  "absolute right-[calc(50%-17px)] top-2 size-1.5 rounded-full ring-2 ring-surface",
                  runtimeAvailable && connected ? "bg-success" : "bg-warning",
                )}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
