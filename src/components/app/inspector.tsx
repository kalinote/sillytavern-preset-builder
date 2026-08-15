import {
  Activity,
  Bot,
  Box,
  Check,
  ChevronRight,
  CircleDot,
  Code2,
  ExternalLink,
  FileText,
  Gauge,
  Globe2,
  Info,
  Layers3,
  Monitor,
  Play,
  Radio,
  RefreshCw,
  Regex,
  ShieldOff,
  Smartphone,
  Tablet,
  UserRound,
  Variable,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { StudioItem, StudioSection } from "../../data/demo";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

interface InspectorProps {
  item: StudioItem;
  section: StudioSection;
  connected: boolean;
}

type DeviceMode = "desktop" | "tablet" | "mobile";

export function Inspector({ item, section, connected }: InspectorProps) {
  const [device, setDevice] = useState<DeviceMode>("desktop");

  const runInST = () => {
    toast.success("已向 SillyTavern 发送真实运行请求", {
      description: "项目 JavaScript 将只在 ST 页面中执行。",
    });
  };

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-surface">
      <Tabs defaultValue="properties" className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="properties">属性</TabsTrigger>
            <TabsTrigger value="preview">预览</TabsTrigger>
            <TabsTrigger value="runtime">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  connected ? "bg-success" : "bg-destructive",
                )}
              />
              ST 调试
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="properties"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <PropertiesPanel item={item} section={section} />
        </TabsContent>

        <TabsContent
          value="preview"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <PreviewPanel
            item={item}
            section={section}
            device={device}
            onDeviceChange={setDevice}
          />
        </TabsContent>

        <TabsContent
          value="runtime"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <RuntimePanel connected={connected} onRun={runInST} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function PropertiesPanel({
  item,
  section,
}: {
  item: StudioItem;
  section: StudioSection;
}) {
  return (
    <div className="divide-y divide-border">
      <InspectorSection title="基础信息">
        <Field label="显示名称">
          <Input defaultValue={item.name} className="h-8 text-xs" />
        </Field>
        <Field label="Identifier">
          <Input
            defaultValue={item.identifier}
            className="h-8 font-mono text-[11px]"
          />
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/35 p-3">
          <div>
            <p className="text-xs font-medium">启用此项目</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              自动保存只写工程
            </p>
          </div>
          <Switch defaultChecked={item.enabled !== false} />
        </div>
      </InspectorSection>

      {section === "prompts" && (
        <>
          <InspectorSection title="Prompt 状态">
            <div className="grid grid-cols-3 gap-2">
              <StateCell label="已定义" active />
              <StateCell label={item.ordered === false ? "未插入" : "已插入"} active={item.ordered !== false} warning={item.ordered === false} />
              <StateCell label={item.enabled === false ? "已禁用" : "已启用"} active={item.enabled !== false} />
            </div>
            <Field label="Role">
              <select className="h-8 w-full rounded-lg border border-input bg-surface px-2.5 text-xs outline-none focus:border-primary/50">
                <option>System</option>
                <option>User</option>
                <option>Assistant</option>
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <SmallNumberField label="Position" value="0" />
              <SmallNumberField label="Depth" value="4" />
              <SmallNumberField label="Order" value="100" />
            </div>
          </InspectorSection>

          <InspectorSection
            title="宏与变量"
            trailing={<Badge variant="green">无错误</Badge>}
          >
            <InsightRow
              icon={Variable}
              label="变量定义"
              value="4"
              tone="blue"
            />
            <InsightRow
              icon={WandSparkles}
              label="变量引用"
              value="2"
              tone="blue"
            />
            <InsightRow
              icon={Check}
              label="未定义引用"
              value="0"
              tone="green"
            />
          </InspectorSection>
        </>
      )}

      {section === "regex" && (
        <>
          <InspectorSection
            title="镜像绑定"
            trailing={<Badge variant="blue">强关联</Badge>}
          >
            <MirrorRow path="extensions.regex_scripts" />
            <MirrorRow path="extensions.SPreset.RegexBinding" />
            <MirrorRow path="prompts/SPresetSettings" />
            <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary-soft/50 p-3">
              <Layers3 className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <p className="text-[11px] leading-5 text-muted-foreground">
                三处内容完全一致。工程仅保存一个逻辑对象，构建时自动重建镜像。
              </p>
            </div>
          </InspectorSection>
          <InspectorSection title="运行范围">
            <div className="grid grid-cols-2 gap-2">
              <SmallNumberField label="Min depth" value="0" />
              <SmallNumberField label="Max depth" value="4" />
            </div>
            <ToggleRow label="Prompt Only" />
            <ToggleRow label="Markdown Only" checked />
            <ToggleRow label="Run on edit" />
          </InspectorSection>
        </>
      )}

      {section === "scripts" && (
        <InspectorSection title="执行环境">
          <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-soft/55 p-3">
            <ShieldOff className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="text-xs font-medium text-foreground">
                工具中不执行项目 JavaScript
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                脚本只在点击真实调试后由 SillyTavern 与 Tavern Helper 执行。
              </p>
            </div>
          </div>
          <InsightRow icon={Code2} label="语言" value="JavaScript" tone="blue" />
          <InsightRow icon={Gauge} label="文件大小" value={item.meta ?? "—"} tone="amber" />
        </InspectorSection>
      )}

      {section === "snapshots" && (
        <InspectorSection title="快照规则">
          <ToggleRow label="只读快照" checked disabled />
          <ToggleRow label="自动刷新" disabled />
          <ToggleRow label="同步回 ST" disabled />
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/35 p-3">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-5 text-muted-foreground">
              真实测试始终使用 ST 当前上下文；旧快照不能恢复回 ST。
            </p>
          </div>
        </InspectorSection>
      )}
    </div>
  );
}

function PreviewPanel({
  item,
  section,
  device,
  onDeviceChange,
}: {
  item: StudioItem;
  section: StudioSection;
  device: DeviceMode;
  onDeviceChange: (device: DeviceMode) => void;
}) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium">本地设计预览</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            HTML/CSS · 项目 JS 已禁用
          </p>
        </div>
        <div className="flex rounded-lg bg-muted p-1">
          <DeviceButton
            icon={Monitor}
            active={device === "desktop"}
            onClick={() => onDeviceChange("desktop")}
            label="桌面"
          />
          <DeviceButton
            icon={Tablet}
            active={device === "tablet"}
            onClick={() => onDeviceChange("tablet")}
            label="平板"
          />
          <DeviceButton
            icon={Smartphone}
            active={device === "mobile"}
            onClick={() => onDeviceChange("mobile")}
            label="手机"
          />
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-preview-grid p-3">
        <div
          className={cn(
            "mx-auto overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-[max-width] duration-200",
            device === "desktop" && "max-w-full",
            device === "tablet" && "max-w-[280px]",
            device === "mobile" && "max-w-[220px]",
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-blue-600 text-[10px] font-semibold text-white">
                毓
              </span>
              <div>
                <p className="text-[10px] font-semibold text-slate-800">毓忻</p>
                <p className="text-[8px] text-slate-400">刚刚</p>
              </div>
            </div>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[8px] font-medium text-blue-600">
              静态预览
            </span>
          </div>
          <div className="space-y-3 p-3 text-[10px] leading-5 text-slate-700">
            <p>
              山风掠过檐角，细碎的铃音在暮色里荡开。她抬眼望向你，眸光里藏着一点未说出口的笑意。
            </p>

            {section === "regex" ? (
              <div className="overflow-hidden rounded-lg border border-blue-100 bg-blue-50/70">
                <div className="flex items-center justify-between border-b border-blue-100 px-3 py-2">
                  <div>
                    <p className="text-[8px] font-semibold uppercase tracking-[0.15em] text-blue-500">
                      Next move
                    </p>
                    <p className="text-[11px] font-semibold text-slate-800">
                      狐策 · 行动选项
                    </p>
                  </div>
                  <span className="flex size-6 items-center justify-center rounded-md bg-white text-blue-600 shadow-sm">
                    <WandSparkles className="size-3" />
                  </span>
                </div>
                <div className="grid gap-1.5 p-2">
                  {["追问铃音的来历", "沿石阶进入庭院", "先观察她的神情"].map(
                    (option, index) => (
                      <button
                        key={option}
                        type="button"
                        className="flex items-center gap-2 rounded-md bg-white px-2.5 py-2 text-left text-[9px] text-slate-700 shadow-xs transition-colors hover:bg-blue-600 hover:text-white"
                      >
                        <span className="font-mono text-blue-500">
                          0{index + 1}
                        </span>
                        {option}
                        <ChevronRight className="ml-auto size-3" />
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <p className="text-[8px] uppercase tracking-[0.14em] text-slate-400">
                  Source
                </p>
                <p className="mt-1 font-mono text-[9px] text-slate-600">
                  {item.identifier}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/35 p-3">
        <ShieldOff className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[10px] leading-4 text-muted-foreground">
          script、inline handler 和 javascript: URL
          不会在此执行。完整交互请进入 ST。
        </p>
      </div>
    </div>
  );
}

function RuntimePanel({
  connected,
  onRun,
}: {
  connected: boolean;
  onRun: () => void;
}) {
  return (
    <div className="p-3">
      <div className="rounded-xl border border-border bg-muted/35 p-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg bg-surface shadow-xs",
              connected ? "text-success" : "text-destructive",
            )}
          >
            <Radio className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium">
                {connected ? "SillyTavern 已连接" : "SillyTavern 未连接"}
              </p>
              {connected && <Badge variant="green">1.18.0</Badge>}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              毓忻 · 2026-08-15 试运行
            </p>
          </div>
        </div>
        <Button
          className="mt-3 w-full"
          onClick={onRun}
          disabled={!connected}
        >
          <Play />
          在 ST 中真实运行
          <ExternalLink className="ml-auto" />
        </Button>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-medium">最近一次运行</p>
        <Button variant="ghost" size="sm">
          <RefreshCw />
          刷新
        </Button>
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Activity className="size-3.5 text-success" />
            <p className="text-xs font-medium">Prompt 已捕获</p>
          </div>
          <span className="font-mono text-[9px] text-muted-foreground">
            17:08:42
          </span>
        </div>
        <div className="space-y-0 bg-editor p-3">
          <PromptTimelineRow
            icon={Bot}
            role="SYSTEM"
            title="主提示词与规则汇总"
            tokens="4,832"
            first
          />
          <PromptTimelineRow
            icon={Globe2}
            role="WORLD"
            title="狐神乡 · 主世界书"
            tokens="1,226"
          />
          <PromptTimelineRow
            icon={UserRound}
            role="USER"
            title="最近一条用户消息"
            tokens="86"
          />
          <PromptTimelineRow
            icon={Bot}
            role="ASSISTANT"
            title="Start reply with"
            tokens="12"
            last
          />
        </div>
        <div className="grid grid-cols-3 border-t border-border bg-surface">
          <RuntimeMetric label="输入" value="6,156" />
          <RuntimeMetric label="预留输出" value="4,096" />
          <RuntimeMetric label="上下文" value="10,252" />
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1">
          <FileText />
          查看消息树
        </Button>
        <Button variant="secondary" size="sm" className="flex-1">
          <Box />
          DOM 快照
        </Button>
      </div>
    </div>
  );
}

function InspectorSection({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {title}
        </h3>
        {trailing}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function StateCell({
  label,
  active,
  warning,
}: {
  label: string;
  active: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2 text-center text-[10px] font-medium",
        warning
          ? "border-warning/20 bg-warning-soft text-warning"
          : active
            ? "border-primary/15 bg-primary-soft text-primary"
            : "border-border bg-muted text-muted-foreground",
      )}
    >
      {label}
    </div>
  );
}

function SmallNumberField({ label, value }: { label: string; value: string }) {
  return (
    <label>
      <span className="mb-1 block text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Input defaultValue={value} className="h-8 px-2 text-center font-mono text-xs" />
    </label>
  );
}

function InsightRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Variable;
  label: string;
  value: string;
  tone: "blue" | "green" | "amber";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-md",
          tone === "blue" && "bg-primary-soft text-primary",
          tone === "green" && "bg-success-soft text-success",
          tone === "amber" && "bg-warning-soft text-warning",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="ml-auto text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

function MirrorRow({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/25 px-2.5 py-2">
      <span className="flex size-5 items-center justify-center rounded bg-success-soft text-success">
        <Check className="size-3" />
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
        {path}
      </span>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
}: {
  label: string;
  checked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Switch defaultChecked={checked} disabled={disabled} />
    </label>
  );
}

function DeviceButton({
  icon: Icon,
  active,
  onClick,
  label,
}: {
  icon: typeof Monitor;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30",
        active
          ? "bg-surface text-primary shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
      title={label}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function PromptTimelineRow({
  icon: Icon,
  role,
  title,
  tokens,
  first,
  last,
}: {
  icon: typeof Bot;
  role: string;
  title: string;
  tokens: string;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-2.5 pb-3 last:pb-0">
      {!last && (
        <span className="absolute left-[13px] top-6 h-full w-px bg-border" />
      )}
      <span
        className={cn(
          "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-surface",
          first ? "border-primary/25 text-primary" : "border-border text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] text-primary">{role}</span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {tokens} tk
          </span>
        </div>
        <p className="truncate text-[11px] text-foreground">{title}</p>
      </div>
    </div>
  );
}

function RuntimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-border px-2 py-2 text-center last:border-r-0">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-[11px] font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}
