import {
  Braces,
  CheckCircle2,
  ChevronDown,
  Download,
  FileArchive,
  FileJson2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Radio,
  RadioTower,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";

interface TopBarProps {
  connected: boolean;
  saved: boolean;
  onConnectionClick: () => void;
  onPushClick: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
}

export function TopBar({
  connected,
  saved,
  onConnectionClick,
  onPushClick,
  onToggleSidebar,
  onToggleInspector,
}: TopBarProps) {
  return (
    <header className="relative z-40 flex h-15 shrink-0 items-center border-b border-border bg-surface px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden md:inline-flex"
              onClick={onToggleSidebar}
            >
              <PanelLeft />
              <span className="sr-only">切换结构面板</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>切换结构面板</TooltipContent>
        </Tooltip>

        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Braces className="size-4" />
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-semibold tracking-tight">Preset Studio</p>
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            SillyTavern IDE
          </p>
        </div>
        <span className="mx-1 hidden h-5 w-px bg-border lg:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="max-w-[42vw] truncate text-sm font-medium text-foreground sm:max-w-72">
              V18 狐神抚 · 毓忻
            </p>
            <Badge variant="blue" className="hidden lg:inline-flex">
              v18
            </Badge>
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <div className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
          {saved ? (
            <>
              <CheckCircle2 className="size-3.5 text-success" />
              工程已保存
            </>
          ) : (
            <>
              <span className="size-2 animate-pulse rounded-full bg-warning" />
              正在保存…
            </>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={onConnectionClick}
          className="hidden sm:inline-flex"
        >
          <Radio className={connected ? "text-success" : "text-destructive"} />
          <span className="hidden lg:inline">
            {connected ? "ST 1.18.0" : "ST 未连接"}
          </span>
          <span className="lg:hidden">{connected ? "已连接" : "未连接"}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="hidden md:inline-flex">
              <Download />
              导出
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>工程输出</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() =>
                toast.success("JSON 构建已加入队列", {
                  description: "输出将保存到工程 output 目录。",
                })
              }
            >
              <FileJson2 />
              导出 Preset JSON
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileArchive />
              下载工程 ZIP
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Download />
              查看历史输出
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" onClick={onPushClick} className="hidden md:inline-flex">
          <RadioTower />
          推送至 ST
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden xl:inline-flex"
              onClick={onToggleInspector}
            >
              <PanelRight />
              <span className="sr-only">切换检查器</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>切换检查器</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="md:hidden">
              <MoreHorizontal />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onConnectionClick}>
              <Radio />
              ST 连接
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileJson2 />
              导出 JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPushClick}>
              <RadioTower />
              推送至 ST
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
