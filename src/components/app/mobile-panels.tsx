import {
  Activity,
  Bot,
  Box,
  ExternalLink,
  Monitor,
  Play,
  ShieldOff,
  Smartphone,
  Tablet,
  UserRound,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { StudioItem, StudioSection } from "../../data/demo";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type DeviceMode = "desktop" | "tablet" | "mobile";

export function MobilePreview({
  item,
  section,
}: {
  item: StudioItem;
  section: StudioSection;
}) {
  const [device, setDevice] = useState<DeviceMode>("mobile");
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">本地设计预览</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            HTML/CSS · JavaScript 已禁用
          </p>
        </div>
        <div className="flex rounded-lg bg-muted p-1">
          {[
            ["desktop", Monitor],
            ["tablet", Tablet],
            ["mobile", Smartphone],
          ].map(([mode, Icon]) => (
            <button
              key={mode as string}
              type="button"
              onClick={() => setDevice(mode as DeviceMode)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                device === mode
                  ? "bg-surface text-primary shadow-xs"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-preview-grid p-4">
        <article
          className={cn(
            "mx-auto overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-[max-width]",
            device === "desktop" && "max-w-full",
            device === "tablet" && "max-w-sm",
            device === "mobile" && "max-w-[260px]",
          )}
        >
          <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-semibold text-white">
                毓
              </span>
              <div>
                <p className="text-[11px] font-semibold text-slate-800">毓忻</p>
                <p className="text-[9px] text-slate-400">刚刚</p>
              </div>
            </div>
            <Badge variant="blue">静态</Badge>
          </header>
          <div className="space-y-3 p-3 text-[11px] leading-5 text-slate-700">
            <p>
              山风掠过檐角，细碎的铃音在暮色里荡开。她抬眼望向你，眸光里藏着一点未说出口的笑意。
            </p>
            {section === "regex" ? (
              <div className="overflow-hidden rounded-lg border border-blue-100 bg-blue-50/70">
                <div className="flex items-center justify-between border-b border-blue-100 px-3 py-2">
                  <div>
                    <p className="text-[8px] uppercase tracking-[0.14em] text-blue-500">
                      Next move
                    </p>
                    <p className="text-xs font-semibold text-slate-800">
                      狐策 · 行动选项
                    </p>
                  </div>
                  <WandSparkles className="size-4 text-blue-600" />
                </div>
                <div className="grid gap-1.5 p-2">
                  {["追问铃音的来历", "沿石阶进入庭院", "先观察她的神情"].map(
                    (text, index) => (
                      <button
                        key={text}
                        type="button"
                        className="flex items-center gap-2 rounded-md bg-white px-2.5 py-2 text-left text-[10px] text-slate-700 shadow-xs"
                      >
                        <span className="font-mono text-blue-500">0{index + 1}</span>
                        {text}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-400">
                  Source
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-slate-600">
                  {item.identifier}
                </p>
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="mt-4 flex gap-2 rounded-xl border border-border bg-muted/35 p-3 text-[11px] leading-5 text-muted-foreground">
        <ShieldOff className="mt-0.5 size-4 shrink-0" />
        script、inline handler 与 javascript: URL 不会在此执行。完整交互请进入 ST。
      </div>
    </main>
  );
}

export function MobileRuntime({ connected }: { connected: boolean }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-surface p-4">
      <div className="rounded-2xl border border-border bg-muted/35 p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-surface text-success shadow-xs">
            <Activity className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold">
                {connected ? "SillyTavern 已连接" : "SillyTavern 未连接"}
              </p>
              {connected && <Badge variant="green">1.18.0</Badge>}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              毓忻 · 2026-08-15 试运行
            </p>
          </div>
        </div>
        <Button
          className="mt-4 w-full"
          disabled={!connected}
          onClick={() =>
            toast.success("已向 ST 发送真实运行请求", {
              description: "项目 JavaScript 将只在 ST 页面内执行。",
            })
          }
        >
          <Play />
          在 ST 中真实运行
          <ExternalLink className="ml-auto" />
        </Button>
      </div>

      <section className="mt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">最近一次捕获</h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            17:08:42
          </span>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-editor">
          <RuntimeRow icon={Bot} role="SYSTEM" title="主提示词与规则汇总" tokens="4,832" />
          <RuntimeRow icon={UserRound} role="USER" title="最近一条用户消息" tokens="86" />
          <RuntimeRow icon={Bot} role="ASSISTANT" title="Start reply with" tokens="12" />
          <div className="grid grid-cols-3 border-t border-border bg-surface">
            <Metric label="输入" value="6,156" />
            <Metric label="预留输出" value="4,096" />
            <Metric label="上下文" value="10,252" />
          </div>
        </div>
      </section>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary"><Bot />消息树</Button>
        <Button variant="secondary"><Box />DOM 快照</Button>
      </div>
    </main>
  );
}

function RuntimeRow({ icon: Icon, role, title, tokens }: { icon: typeof Bot; role: string; title: string; tokens: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border p-3 last:border-b-0">
      <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] text-primary">{role}</span>
          <span className="font-mono text-[9px] text-muted-foreground">{tokens} tk</span>
        </div>
        <p className="truncate text-xs">{title}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-border px-2 py-2.5 text-center last:border-r-0">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-[11px] font-medium">{value}</p>
    </div>
  );
}
