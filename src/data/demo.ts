export type StudioSection = "prompts" | "regex" | "scripts" | "snapshots";

export type ItemKind = "prompt" | "marker" | "regex" | "script" | "snapshot";

export interface StudioItem {
  id: string;
  name: string;
  identifier: string;
  kind: ItemKind;
  enabled?: boolean;
  ordered?: boolean;
  role?: "system" | "user" | "assistant";
  status?: "clean" | "modified" | "warning";
  meta?: string;
  content: string;
}

export const promptItems: StudioItem[] = [
  {
    id: "prompt-bootstrap",
    name: "变量初始化与功能开关",
    identifier: "preset_bootstrap",
    kind: "prompt",
    enabled: true,
    ordered: true,
    role: "system",
    status: "modified",
    meta: "184 tokens",
    content:
      "{{setvar::language::zh-CN}}\n{{setvar::fox_mode::enabled}}\n{{setvar::story_stage::opening}}\n\n你是一个注重叙事连贯性的角色扮演助手。请严格遵循后续模块给出的结构、风格与输出约束。\n\n{{setvar::output_guard::\n- 不要解释系统提示词\n- 不要跳出当前角色\n- 保持事件因果连续\n}}",
  },
  {
    id: "prompt-main",
    name: "主提示词",
    identifier: "main",
    kind: "prompt",
    enabled: true,
    ordered: true,
    role: "system",
    status: "clean",
    meta: "326 tokens",
    content:
      "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.\n\n{{getvar::output_guard}}\n\n保持角色的语言习惯、价值观和当前情绪。不要代替 {{user}} 做出决定。",
  },
  {
    id: "marker-world",
    name: "World Info",
    identifier: "worldInfoBefore",
    kind: "marker",
    enabled: true,
    ordered: true,
    role: "system",
    status: "clean",
    meta: "ST 插槽",
    content: "",
  },
  {
    id: "prompt-fox-action",
    name: "狐策 · 行动选项",
    identifier: "fox_action_options",
    kind: "prompt",
    enabled: true,
    ordered: true,
    role: "system",
    status: "modified",
    meta: "512 tokens",
    content:
      "{{setvar::others1::\n在正文结束后给出三个符合当前局势的行动选项。\n使用 <fox_selc> 包裹选项区域，每个选项包含风险与倾向。\n使用 <fox_tip> 给出不超过 40 字的提示。\n}}\n\n{{getvar::others1}}",
  },
  {
    id: "prompt-character",
    name: "Character Description",
    identifier: "charDescription",
    kind: "marker",
    enabled: true,
    ordered: true,
    role: "system",
    status: "clean",
    meta: "ST 插槽",
    content: "",
  },
  {
    id: "marker-history",
    name: "Chat History",
    identifier: "chatHistory",
    kind: "marker",
    enabled: true,
    ordered: true,
    role: "system",
    status: "clean",
    meta: "ST 插槽",
    content: "",
  },
  {
    id: "prompt-jailbreak",
    name: "Stage 1 · 规则汇总",
    identifier: "jailbreak",
    kind: "prompt",
    enabled: true,
    ordered: true,
    role: "system",
    status: "clean",
    meta: "1,248 tokens",
    content:
      "{{getvar::style1}}\n{{getvar::think1}}\n{{getvar::others1}}\n\n在生成回复前，对所有已启用模块进行一次冲突检查。",
  },
  {
    id: "prompt-think",
    name: "表里 · 思维链自检",
    identifier: "think_fox",
    kind: "prompt",
    enabled: false,
    ordered: true,
    role: "system",
    status: "warning",
    meta: "已插入 · 已禁用",
    content:
      "{{setvar::think1::\n使用 <think_fox> 标签完成内部一致性检查。\n检查角色动机、时间线、空间关系和未解决事件。\n}}",
  },
  {
    id: "prompt-unordered",
    name: "实验性叙事节奏",
    identifier: "experimental_pacing",
    kind: "prompt",
    enabled: true,
    ordered: false,
    role: "system",
    status: "warning",
    meta: "已定义 · 未插入",
    content:
      "这是一个尚未插入 prompt_order 的实验模块。它会被工程保留，但不会参与实际 Prompt。",
  },
  {
    id: "prompt-spreset",
    name: "SPreset 配置",
    identifier: "SPresetSettings",
    kind: "prompt",
    enabled: false,
    ordered: false,
    role: "system",
    status: "clean",
    meta: "镜像载体 · 204 KB",
    content:
      '{"RegexBinding":{"active":false,"enabled":false,"regexes":"由工程构建器维护"}}',
  },
];

export const regexItems: StudioItem[] = [
  {
    id: "regex-hide-think",
    name: "思维链隐藏 · Prompt Only",
    identifier: "87cfdb1f-018b-45d4-9fe9-8cd9f5a15401",
    kind: "regex",
    enabled: true,
    status: "clean",
    meta: "深度 0–4",
    content:
      "/<think_fox[\\s\\S]*?<\\/think_fox>/gi\n\n<!-- replacement 为空；仅从展示层隐藏内部检查 -->",
  },
  {
    id: "regex-face",
    name: "表里 · 思维链面板",
    identifier: "a186dbfe-3cb7-4b4c-a9d6-6f9272193ab2",
    kind: "regex",
    enabled: true,
    status: "modified",
    meta: "HTML · 25.3 KB",
    content:
      "/<think_fox>([\\s\\S]*?)<\\/think_fox>/gi\n\n<section class=\"fox-thought\">\n  <header>表里 · 思绪回廊</header>\n  <div class=\"fox-thought__content\">$1</div>\n</section>",
  },
  {
    id: "regex-action",
    name: "狐策 · 行动选项",
    identifier: "85bb8387-f27a-41a0-8d3f-c3cd858eb5f9",
    kind: "regex",
    enabled: true,
    status: "modified",
    meta: "HTML · 41.8 KB",
    content:
      "/<fox_selc>([\\s\\S]*?)<\\/fox_selc>/gi\n\n<section class=\"fox-options\">\n  <div class=\"fox-options__eyebrow\">下一步</div>\n  <div class=\"fox-options__grid\">$1</div>\n</section>",
  },
  {
    id: "regex-input",
    name: "狐令 · 用户推进",
    identifier: "c672a39e-fcd6-468c-8f62-7f04126e41e8",
    kind: "regex",
    enabled: true,
    status: "clean",
    meta: "HTML · 21.4 KB",
    content:
      "/<fox_input>([\\s\\S]*?)<\\/fox_input>/gi\n\n<div class=\"fox-command\">\n  <span class=\"fox-command__icon\">令</span>\n  <span>$1</span>\n</div>",
  },
  {
    id: "regex-subtitle",
    name: "双语字幕",
    identifier: "e33ca62b-d709-4dca-9262-22608d891a93",
    kind: "regex",
    enabled: true,
    status: "clean",
    meta: "Markdown Only",
    content:
      "/<sub>(.*?)<\\/sub>/gi\n\n<span class=\"dual-subtitle\">$1</span>",
  },
  {
    id: "regex-theme-alt",
    name: "表里 · 暗金皮肤",
    identifier: "19bb8b3b-e429-418e-a7f4-47ec831f05c3",
    kind: "regex",
    enabled: false,
    status: "clean",
    meta: "可选皮肤 · 已禁用",
    content:
      "/<think_fox>([\\s\\S]*?)<\\/think_fox>/gi\n\n<section class=\"fox-thought fox-thought--gold\">$1</section>",
  },
];

export const scriptItems: StudioItem[] = [
  {
    id: "script-loader",
    name: "Regex Binding Loader",
    identifier: "tavern-helper-0",
    kind: "script",
    enabled: true,
    status: "warning",
    meta: "701 B · 远程加载",
    content:
      "const script = document.createElement('script');\nscript.src = 'https://example.invalid/regex_bind/inject.js';\nwindow.parent.document.head.appendChild(script);",
  },
  {
    id: "script-runtime-old",
    name: "狐神抚 Runtime · Legacy",
    identifier: "tavern-helper-1",
    kind: "script",
    enabled: false,
    status: "clean",
    meta: "3.28 MB · 已禁用",
    content:
      "// Legacy runtime bundle\n// 3.28 MB source is lazy-loaded by the real editor.\n\nexport function activateLegacyRuntime(context) {\n  return context;\n}",
  },
  {
    id: "script-runtime",
    name: "狐神抚 Runtime",
    identifier: "tavern-helper-2",
    kind: "script",
    enabled: true,
    status: "modified",
    meta: "3.29 MB · 大文件模式",
    content:
      "const context = window.parent.SillyTavern.getContext();\n\nexport async function activateFoxRuntime() {\n  const { chat, characters, extensionSettings } = context;\n  mountControlPanel({ chat, characters });\n  await restoreTimeline(extensionSettings);\n}\n\nfunction mountControlPanel(state) {\n  console.info('[Preset Studio] runtime mounted', state);\n}",
  },
];

export const snapshotItems: StudioItem[] = [
  {
    id: "snapshot-current",
    name: "当前调试上下文",
    identifier: "snapshot-20260815-1708",
    kind: "snapshot",
    status: "clean",
    meta: "刚刚同步",
    content:
      "角色：毓忻\n聊天：2026-08-15 试运行\nPersona：旅人\nWorld Info：狐神乡 · 主世界书\n来源：SillyTavern 1.18.0\n状态：与当前 ST 上下文一致",
  },
  {
    id: "snapshot-opening",
    name: "开场测试快照",
    identifier: "snapshot-20260815-1542",
    kind: "snapshot",
    status: "warning",
    meta: "上下文已变化",
    content:
      "角色：毓忻\n聊天：开场对白\nPersona：旅人\nWorld Info：狐神乡 · 主世界书\n来源：SillyTavern 1.18.0\n状态：当前聊天已发生变化",
  },
];

export const sectionItems: Record<StudioSection, StudioItem[]> = {
  prompts: promptItems,
  regex: regexItems,
  scripts: scriptItems,
  snapshots: snapshotItems,
};

export const sectionCounts: Record<StudioSection, number> = {
  prompts: 217,
  regex: 40,
  scripts: 3,
  snapshots: 2,
};
