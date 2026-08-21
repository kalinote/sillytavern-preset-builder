import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

type JsonObject = Record<string, unknown>;

interface ConfigFormProps {
  content: string;
  onChange: (content: string) => void;
}

const PRESET_PROMPT_FIELDS = [
  { key: "impersonation_prompt", label: "角色扮演提示词", description: "继续对话时要求模型扮演用户的提示词" },
  { key: "new_chat_prompt", label: "新对话提示词", description: "开始普通新对话时附加" },
  { key: "new_group_chat_prompt", label: "新群聊提示词", description: "开始群组对话时附加" },
  { key: "new_example_chat_prompt", label: "示例对话提示词", description: "示例消息区段使用的提示词" },
  { key: "continue_nudge_prompt", label: "继续生成提示词", description: "请求模型从截断处继续生成" },
  { key: "group_nudge_prompt", label: "群聊角色提示词", description: "指定群聊中的下一位回复角色" },
  { key: "send_if_empty", label: "空输入替代文本", description: "用户输入为空时发送给模型的内容" },
] as const;

const PRESET_FORMAT_FIELDS = [
  { key: "wi_format", label: "世界信息标签", description: "世界书内容的包装格式，使用 {0} 作为内容占位符" },
  { key: "scenario_format", label: "场景标签", description: "场景内容的包装格式，可使用 {{scenario}}" },
  { key: "personality_format", label: "性格标签", description: "角色性格的包装格式，可使用 {{personality}}" },
] as const;

const PRESET_PREFILL_FIELDS = [
  { key: "assistant_prefill", label: "Assistant Prefill", description: "普通回复前预填的 assistant 内容" },
  { key: "assistant_impersonation", label: "扮演模式 Prefill", description: "扮演用户时预填的 assistant 内容" },
  { key: "continue_postfix", label: "继续生成后缀", description: "继续生成请求附加的文本" },
] as const;

export function RequestConfigForm({ content, onChange }: ConfigFormProps) {
  const parsed = useMemo(() => parseObject(content), [content]);
  if (!parsed.value) return <InvalidJsonState error={parsed.error} />;

  const config = parsed.value;
  const source = stringValue(config.chat_completion_source);
  const modelKey = source ? `${source}_model` : "";
  const update = (key: string, value: unknown) => {
    onChange(updateObject(content, (next) => {
      next[key] = value;
    }));
  };

  return (
    <FormScroller title="请求参数与基本配置" description="常用请求字段以表单呈现；提示词、标签和 extensions 不会出现在这个板块中。">
      <FormSection title="模型与来源" description="模型字段会跟随当前 Chat Completion 来源。">
        <div className="grid gap-4 md:grid-cols-2">
          <TextSetting
            key={`source:${source}`}
            label="Chat Completion 来源"
            description="对应 chat_completion_source"
            value={source}
            placeholder="例如 openai、openrouter、deepseek"
            onCommit={(value) => update("chat_completion_source", value)}
          />
          {modelKey ? (
            <TextSetting
              key={`${modelKey}:${stringValue(config[modelKey])}`}
              label="模型"
              description={`对应 ${modelKey}`}
              value={stringValue(config[modelKey])}
              placeholder="模型 ID"
              onCommit={(value) => update(modelKey, value)}
            />
          ) : null}
          <SelectSetting
            label="推理强度"
            description="对应 reasoning_effort"
            value={stringValue(config.reasoning_effort)}
            options={["auto", "none", "minimal", "low", "medium", "high"]}
            onChange={(value) => update("reasoning_effort", value)}
          />
        </div>
      </FormSection>

      <FormSection title="生成限制" description="上下文长度和最大输出均以 token 为单位。">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <NumberSetting
            key={`context:${numberValue(config.openai_max_context)}`}
            label="上下文长度"
            description="对应 openai_max_context"
            value={numberValue(config.openai_max_context)}
            min={1}
            integer
            placeholder="例如 128000"
            onCommit={(value) => update("openai_max_context", value)}
          />
          <NumberSetting
            key={`tokens:${numberValue(config.openai_max_tokens)}`}
            label="最大输出"
            description="对应 openai_max_tokens"
            value={numberValue(config.openai_max_tokens)}
            min={1}
            integer
            placeholder="例如 8192"
            onCommit={(value) => update("openai_max_tokens", value)}
          />
          <NumberSetting
            key={`n:${numberValue(config.n)}`}
            label="候选回复数"
            description="对应 n"
            value={numberValue(config.n)}
            min={1}
            integer
            placeholder="1"
            onCommit={(value) => update("n", value)}
          />
          <NumberSetting
            key={`seed:${numberValue(config.seed)}`}
            label="随机种子"
            description="对应 seed，-1 通常表示随机"
            value={numberValue(config.seed)}
            integer
            placeholder="-1"
            onCommit={(value) => update("seed", value)}
          />
          <BooleanSetting
            label="流式输出"
            description="对应 stream_openai"
            checked={booleanValue(config.stream_openai)}
            onCheckedChange={(checked) => update("stream_openai", checked)}
          />
          <BooleanSetting
            label="解锁上下文上限"
            description="对应 max_context_unlocked"
            checked={booleanValue(config.max_context_unlocked)}
            onCheckedChange={(checked) => update("max_context_unlocked", checked)}
          />
        </div>
      </FormSection>

      <FormSection title="采样参数" description="这些参数会直接影响输出的随机性与重复程度。">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <NumberSetting label="Temperature" field="temperature" value={numberValue(config.temperature)} onCommit={(value) => update("temperature", value)} />
          <NumberSetting label="Top P" field="top_p" value={numberValue(config.top_p)} min={0} onCommit={(value) => update("top_p", value)} />
          <NumberSetting label="Top K" field="top_k" value={numberValue(config.top_k)} min={0} integer onCommit={(value) => update("top_k", value)} />
          <NumberSetting label="Top A" field="top_a" value={numberValue(config.top_a)} min={0} onCommit={(value) => update("top_a", value)} />
          <NumberSetting label="Min P" field="min_p" value={numberValue(config.min_p)} min={0} onCommit={(value) => update("min_p", value)} />
          <NumberSetting label="频率惩罚" field="frequency_penalty" value={numberValue(config.frequency_penalty)} onCommit={(value) => update("frequency_penalty", value)} />
          <NumberSetting label="存在惩罚" field="presence_penalty" value={numberValue(config.presence_penalty)} onCommit={(value) => update("presence_penalty", value)} />
          <NumberSetting label="重复惩罚" field="repetition_penalty" value={numberValue(config.repetition_penalty)} min={0} onCommit={(value) => update("repetition_penalty", value)} />
        </div>
      </FormSection>

      <FormSection title="请求能力">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BooleanSetting
            label="函数调用"
            description="对应 function_calling"
            checked={booleanValue(config.function_calling)}
            onCheckedChange={(checked) => update("function_calling", checked)}
          />
          <BooleanSetting
            label="联网搜索"
            description="对应 enable_web_search"
            checked={booleanValue(config.enable_web_search)}
            onCheckedChange={(checked) => update("enable_web_search", checked)}
          />
          <BooleanSetting
            label="显示推理内容"
            description="对应 show_thoughts"
            checked={booleanValue(config.show_thoughts)}
            onCheckedChange={(checked) => update("show_thoughts", checked)}
          />
        </div>
      </FormSection>
    </FormScroller>
  );
}

export function PromptFieldsConfigForm({ content, onChange }: ConfigFormProps) {
  const parsed = useMemo(() => parseObject(content), [content]);
  if (!parsed.value) return <InvalidJsonState error={parsed.error} />;

  const config = parsed.value;
  const update = (key: string, value: string) => {
    onChange(updateObject(content, (next) => {
      next[key] = value;
    }));
  };

  const renderFields = (fields: typeof PRESET_PROMPT_FIELDS | typeof PRESET_FORMAT_FIELDS | typeof PRESET_PREFILL_FIELDS) => (
    <div className="grid gap-4 lg:grid-cols-2">
      {fields.map((field) => (
        <TextareaSetting
          key={`${field.key}:${stringValue(config[field.key])}`}
          label={field.label}
          description={`${field.description} · ${field.key}`}
          value={stringValue(config[field.key])}
          onCommit={(value) => update(field.key, value)}
        />
      ))}
    </div>
  );

  return (
    <FormScroller title="预设提示词与标签" description="集中编辑 SillyTavern 顶层提示词、包装标签与预填内容；此板块不包含 extensions。">
      <FormSection title="对话提示词" description="控制新对话、继续生成和角色扮演等请求附加内容。">
        {renderFields(PRESET_PROMPT_FIELDS)}
      </FormSection>
      <FormSection title="内容包装与标签" description="保留模板变量和占位符，构建时会原样写回预设。">
        {renderFields(PRESET_FORMAT_FIELDS)}
      </FormSection>
      <FormSection title="预填与后缀">
        {renderFields(PRESET_PREFILL_FIELDS)}
      </FormSection>
    </FormScroller>
  );
}

export function ProjectConfigForm({ content, onChange }: ConfigFormProps) {
  const parsed = useMemo(() => parseObject(content), [content]);
  if (!parsed.value) return <InvalidJsonState error={parsed.error} />;

  const config = parsed.value;
  const source = objectValue(config.source);
  const preview = objectValue(config.preview);
  const update = (mutate: (next: JsonObject) => void) => {
    onChange(updateObject(content, (next) => {
      mutate(next);
      next.updatedAt = new Date().toISOString();
    }));
  };

  return (
    <FormScroller title="工程配置" description="编辑工程身份和运行设置；内部标识与来源信息保持只读。">
      <FormSection title="基本信息">
        <div className="grid gap-4 md:grid-cols-2">
          <TextSetting
            key={`name:${stringValue(config.name)}`}
            label="工程名称"
            description="对应 name"
            value={stringValue(config.name)}
            required
            onCommit={(value) => update((next) => { next.name = value; })}
          />
          <TextSetting
            key={`version:${stringValue(config.version)}`}
            label="版本"
            description="对应 version"
            value={stringValue(config.version)}
            placeholder="例如 1.0.0"
            onCommit={(value) => update((next) => { next.version = value; })}
          />
          <TextSetting
            key={`target:${stringValue(config.targetPresetName)}`}
            label="默认 SillyTavern 预设名"
            description="构建或推送时使用的默认目标名称"
            value={stringValue(config.targetPresetName)}
            required
            onCommit={(value) => update((next) => { next.targetPresetName = value; })}
          />
        </div>
      </FormSection>

      <FormSection title="预览运行">
        <BooleanSetting
          label="允许动态 JavaScript 预览"
          description="开启后可手动运行已启用的脚本；脚本可能联网并产生外部副作用。"
          checked={booleanValue(preview.javascriptEnabled)}
          warning
          onCheckedChange={(checked) => update((next) => {
            next.preview = { ...objectValue(next.preview), javascriptEnabled: checked };
          })}
        />
      </FormSection>

      <FormSection title="只读元数据" description="如需排查兼容问题，可在这里核对工程来源与规则版本。">
        <dl className="grid gap-x-6 gap-y-3 text-xs md:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Metadata label="工程 ID" value={stringValue(config.id)} code />
          <Metadata label="Schema" value={String(config.schemaVersion ?? "—")} />
          <Metadata label="来源类型" value={stringValue(source.type) || "—"} />
          <Metadata label="来源预设" value={stringValue(source.presetName) || "—"} />
          <Metadata label="SillyTavern 版本" value={stringValue(source.stVersion) || "—"} />
          <Metadata label="构建规则" value={String(config.buildRulesVersion ?? "—")} />
          <Metadata label="创建时间" value={formatDate(config.createdAt)} />
          <Metadata label="更新时间" value={formatDate(config.updatedAt)} />
          <Metadata label="原始 SHA-256" value={stringValue(config.originalJsonSha256) || "—"} code />
        </dl>
      </FormSection>
    </FormScroller>
  );
}

function FormScroller({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-editor">
      <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-xs">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="mt-1 text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function TextSetting({
  label,
  description,
  value,
  placeholder,
  required,
  onCommit,
}: {
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = required ? draft.trim() : draft;
    if ((required && !next) || next === value) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };
  return (
    <label className="block space-y-1.5 text-xs font-medium">
      <span>{label}</span>
      {description ? <span className="block text-[10px] font-normal text-muted-foreground">{description}</span> : null}
      <Input
        value={draft}
        placeholder={placeholder}
        required={required}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function TextareaSetting({
  label,
  description,
  value,
  onCommit,
}: {
  label: string;
  description?: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="block space-y-1.5 text-xs font-medium">
      <span>{label}</span>
      {description ? <span className="block text-[10px] font-normal text-muted-foreground">{description}</span> : null}
      <textarea
        className="min-h-32 w-full resize-y rounded-lg border border-input bg-surface px-3 py-2 font-mono text-xs leading-5 text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-ring/20"
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function NumberSetting({
  label,
  field,
  description,
  value,
  min,
  integer,
  placeholder,
  onCommit,
}: {
  label: string;
  field?: string;
  description?: string;
  value: number | null;
  min?: number;
  integer?: boolean;
  placeholder?: string;
  onCommit: (value: number) => void;
}) {
  const original = value === null ? "" : String(value);
  const [draft, setDraft] = useState(original);
  const commit = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || (min !== undefined && parsed < min)) {
      setDraft(original);
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <label className="block space-y-1.5 text-xs font-medium">
      <span>{label}</span>
      <span className="block text-[10px] font-normal text-muted-foreground">{description ?? `对应 ${field}`}</span>
      <Input
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        step={integer ? 1 : "any"}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(original);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function SelectSetting({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const allOptions = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <label className="block space-y-1.5 text-xs font-medium">
      <span>{label}</span>
      {description ? <span className="block text-[10px] font-normal text-muted-foreground">{description}</span> : null}
      <select
        className="flex h-9 w-full rounded-lg border border-input bg-surface px-3 text-sm text-foreground shadow-xs outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-ring/20"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        {!value ? <option value="">未设置</option> : null}
        {allOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function BooleanSetting({
  label,
  description,
  checked,
  warning,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  warning?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className={`flex min-h-20 items-start justify-between gap-4 rounded-lg border p-3 ${warning ? "border-warning/25 bg-warning-soft/35" : "border-border bg-muted/20"}`}>
      <div>
        <p className="text-xs font-medium">{label}</p>
        {description ? <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</p> : null}
        <p className={`mt-1 text-[10px] font-medium ${checked ? "text-primary" : "text-muted-foreground"}`}>{checked ? "已启用" : "已禁用"}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

function Metadata({ label, value, code }: { label: string; value: string; code?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 truncate ${code ? "font-mono text-[10px]" : ""}`} title={value}>{value}</dd>
    </div>
  );
}

function InvalidJsonState({ error }: { error?: string }) {
  return (
    <div className="m-auto flex max-w-lg items-start gap-3 rounded-xl border border-destructive/20 bg-destructive-soft p-4 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">无法打开表单</p>
        <p className="mt-1 text-xs">当前内容不是有效的 JSON 对象，请切换到 JSON 模式修复后再返回表单。</p>
        {error ? <p className="mt-2 font-mono text-[10px] opacity-80">{error}</p> : null}
      </div>
    </div>
  );
}

function parseObject(content: string): { value: JsonObject | null; error?: string } {
  try {
    const value = objectValueOrNull(JSON.parse(content) as unknown);
    if (!value) return { value: null, error: "JSON 顶层必须是对象" };
    return { value };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function updateObject(content: string, mutate: (value: JsonObject) => void) {
  const parsed = JSON.parse(content) as JsonObject;
  mutate(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function objectValueOrNull(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function objectValue(value: unknown): JsonObject {
  return objectValueOrNull(value) ?? {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toLocaleString();
}
