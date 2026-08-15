import {
  BookOpenText,
  ChevronDown,
  Circle,
  Code2,
  FileText,
  Filter,
  GripVertical,
  Plus,
  Regex,
  Search,
  SlidersHorizontal,
  Sparkles,
  Variable,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  sectionCounts,
  sectionItems,
  type StudioItem,
  type StudioSection,
} from "../../data/demo";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SidebarProps {
  activeSection: StudioSection;
  selectedItemId: string;
  onSectionChange: (section: StudioSection) => void;
  onItemSelect: (item: StudioItem) => void;
  onDirty: () => void;
}

type FilterMode = "all" | "enabled" | "unordered";

const sections: Array<{
  id: StudioSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "prompts", label: "Prompts", icon: FileText },
  { id: "regex", label: "Regex", icon: Regex },
  { id: "scripts", label: "Scripts", icon: Code2 },
  { id: "snapshots", label: "快照", icon: BookOpenText },
];

export function Sidebar({
  activeSection,
  selectedItemId,
  onSectionChange,
  onItemSelect,
  onDirty,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sectionItems[activeSection].filter((item) => {
      const matchesQuery =
        !normalized ||
        item.name.toLowerCase().includes(normalized) ||
        item.identifier.toLowerCase().includes(normalized);
      const matchesFilter =
        filterMode === "all" ||
        (filterMode === "enabled" && item.enabled) ||
        (filterMode === "unordered" && item.ordered === false);
      return matchesQuery && matchesFilter;
    });
  }, [activeSection, filterMode, query]);

  return (
    <aside className="flex h-full w-[288px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-surface p-3 shadow-xs">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">
                V18 狐神抚 · 毓忻
              </p>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              ST: V18 狐神抚 · 毓忻
            </p>
          </div>
        </div>

        <nav className="mt-3 grid grid-cols-4 gap-1" aria-label="工程模块">
          {sections.map((section) => {
            const Icon = section.icon;
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                className={cn(
                  "group flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => onSectionChange(section.id)}
              >
                <Icon className="size-4" />
                <span className="flex items-center gap-1">
                  <span className="truncate">{section.label}</span>
                  <span
                    className={cn(
                      "text-[9px]",
                      active
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground",
                    )}
                  >
                    {sectionCounts[section.id]}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 border-b border-border px-3 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={"搜索 " + sectionLabel(activeSection) + "…"}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {activeSection === "prompts" && (
          <div className="flex items-center gap-1">
            <Filter className="mr-1 size-3.5 text-muted-foreground" />
            <FilterButton
              active={filterMode === "all"}
              onClick={() => setFilterMode("all")}
            >
              全部
            </FilterButton>
            <FilterButton
              active={filterMode === "enabled"}
              onClick={() => setFilterMode("enabled")}
            >
              已启用
            </FilterButton>
            <FilterButton
              active={filterMode === "unordered"}
              onClick={() => setFilterMode("unordered")}
            >
              未插入
            </FilterButton>
            <Button
              size="icon-sm"
              variant="ghost"
              className="ml-auto size-7"
              aria-label="高级筛选"
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-2 flex items-center justify-between px-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            {sectionLabel(activeSection)}
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={onDirty}
            aria-label={"新建 " + sectionLabel(activeSection)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>

        <div className="space-y-0.5">
          {visibleItems.map((item, index) => (
            <SidebarItem
              key={item.id}
              item={item}
              index={index}
              active={selectedItemId === item.id}
              onClick={() => onItemSelect(item)}
            />
          ))}
          {visibleItems.length === 0 && (
            <div className="px-3 py-10 text-center text-xs text-muted-foreground">
              没有符合条件的项目
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>工程 schema 1.0</span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-success" />
            语义无损
          </span>
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({
  item,
  index,
  active,
  onClick,
}: {
  item: StudioItem;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const ItemIcon =
    item.kind === "marker"
      ? Variable
      : item.kind === "regex"
        ? Regex
        : item.kind === "script"
          ? Code2
          : item.kind === "snapshot"
            ? BookOpenText
            : FileText;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
        active
          ? "bg-primary-soft text-foreground"
          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
      )}
    >
      {item.kind === "prompt" || item.kind === "marker" ? (
        <GripVertical
          className={cn(
            "size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60",
            active && "opacity-40",
          )}
        />
      ) : (
        <span className="w-3.5 shrink-0 text-center font-mono text-[9px] text-muted-foreground/60">
          {String(index + 1).padStart(2, "0")}
        </span>
      )}
      <ItemIcon
        className={cn(
          "size-3.5 shrink-0",
          active ? "text-primary" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-xs font-medium">{item.name}</p>
          {item.status === "modified" && (
            <Circle className="size-1.5 fill-primary text-primary" />
          )}
          {item.status === "warning" && (
            <Circle className="size-1.5 fill-warning text-warning" />
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/80">
          {item.identifier}
        </p>
      </div>
      {item.enabled === false && <Badge>关</Badge>}
      {item.ordered === false && <Badge variant="amber">未插入</Badge>}
    </button>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-2 py-1 text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
        active
          ? "bg-primary-soft text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function sectionLabel(section: StudioSection) {
  switch (section) {
    case "prompts":
      return "Prompts";
    case "regex":
      return "Regex";
    case "scripts":
      return "Scripts";
    case "snapshots":
      return "上下文快照";
  }
}
