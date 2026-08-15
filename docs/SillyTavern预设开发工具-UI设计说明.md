# SillyTavern Preset Studio UI 设计说明

> 本文是《SillyTavern预设开发工具-实施方案》的 UI 落地补充。当前工作区已经接入真实工程文件 API、Monaco、CodeMirror 6、自动保存、HTML/CSS 静态预览，以及 Bridge v1 连接门禁和当前 preset 快照拉取；Prompt/Regex 结构化工作台、上下文快照、真实运行捕获与推送仍是后续阶段，界面不会用演示数据冒充真实运行结果。

## 1. 设计目标

第一版界面围绕三个核心任务设计：

1. 快速定位和编辑 Prompt、Regex 与 Tavern Helper Script。
2. 明确区分“工程已保存”“已导出 JSON”“已推送到 ST”三种状态。
3. 在工具中完成安全的 HTML/CSS 静态设计预览，将 JavaScript 真实执行交给 SillyTavern。

界面不复刻 SillyTavern 原有设置页，而采用 IDE 工作台模型，降低大型预设中长列表、巨型脚本和多层配置的操作成本。

## 2. 技术与组件体系

| 层级 | 第一版选择 | 用途 |
| --- | --- | --- |
| 应用框架 | React + TypeScript + Vite | 工作台状态、组件组合和快速构建 |
| CSS 框架 | Tailwind CSS v4 | 响应式布局、设计令牌和原子样式 |
| UI 原语 | Radix UI | Dialog、Dropdown、Tabs、Switch、Tooltip 等可组合组件 |
| 组件封装 | shadcn 风格本地组件 | 组件源码保留在工程内，方便后续按产品需要修改 |
| 图标 | Lucide React | 统一的 16/20px 线性图标体系 |
| 消息反馈 | Sonner | 自动保存、导出、推送、真实运行等操作反馈 |
| 桌面编辑器 | Monaco Editor | Prompt、Regex、JavaScript 等工程源码编辑 |
| 手机编辑器 | CodeMirror 6 | 更适合移动浏览器的触控编辑 |

当前工作台使用真实拆分工程文件。两个编辑器按统一断点懒加载；超过 1 MB 的文件进入保守的大文件模式，减少语言服务、装饰与折叠等高成本能力。Prompt/Markdown 默认软换行，代码、JSON、Regex、HTML 和 CSS 默认保留水平滚动。

## 3. 视觉语言

### 3.1 颜色

主题采用蓝白配色，蓝色只用于主操作、选中态和可交互强调，避免整个 IDE 长时间使用时产生视觉压力。

| 令牌 | 色值 | 用途 |
| --- | --- | --- |
| `primary` | `#2563EB` | 主按钮、当前模块、活动控件 |
| `primary-soft` | `#EAF2FF` | 选中行、信息提示、图标底色 |
| `background` | `#F4F7FB` | 页面背景 |
| `surface` | `#FFFFFF` | 顶栏、面板、弹窗、卡片 |
| `sidebar` | `#F8FAFF` | 结构导航区域 |
| `editor` | `#FBFCFE` | 编辑区背景 |
| `foreground` | `#172033` | 主文本 |
| `muted-foreground` | `#667085` | 辅助文本和未激活状态 |
| `success` | `#15805F` | 已保存、连接正常、校验通过 |
| `warning` | `#A96500` | 未插入、大文件、上下文变化 |
| `destructive` | `#D92D45` | 断开连接、危险和错误状态 |

第一版只提供亮色主题，但所有色值均已抽成语义令牌，后续增加暗色主题时不需要重写组件。

### 3.2 字体与密度

- UI 字体使用 Inter / Segoe UI / 苹方 / 微软雅黑的系统回退链。
- 源码使用 Cascadia Code / JetBrains Mono / Consolas 回退链。
- 工作台正文以 12–14px 为主，标题以 14–20px 为主。
- 常用桌面控件高度为 32–36px；手机底部导航的单项触控区域大于 44px。
- 面板边界使用 1px 冷灰线，卡片以轻阴影辅助分层，不使用大面积渐变。

## 4. 总体信息架构

### 4.1 强制连接门禁

工具未连接 ST 时不进入项目工作台，展示连接门禁页：

- 说明工具与 ST 的职责边界。
- 引导用户在已登录的 ST 页面中打开 Bridge 并输入一次性连接码。
- 强调工具不访问 ST 登录凭据、Cookie 或 secrets/API Key 存储；同时警告完整 preset 自身的代理密码、自定义请求头等连接字段会进入工程。
- 连接成功后才能从 ST 当前 preset 创建工程、拉取只读测试快照或运行真实调试。

当前实现默认展示真实连接门禁；Bridge 握手成功后才进入工作台。顶部连接按钮展示 Bridge 实际上报的 ST/Bridge 版本、当前 preset 与上下文摘要，并可重新生成配对码。

### 4.2 桌面与横屏平板

宽屏桌面采用三栏布局；宽度 768–1279px 且高度至少 500px 的横屏平板/窄桌面保留结构树与 Monaco，并通过右下角按钮打开键盘和触控可用的检查器抽屉。高度不足 500px 的矮横屏设备使用手机单栏布局和 CodeMirror 6。

```text
┌────────────────────────── 顶部全局工具栏 ──────────────────────────┐
├───────────┬───────────────────────────────┬────────────────────────┤
│ 工程结构树 │ Monaco / 文件编辑区            │ 属性 / 预览 / ST 调试   │
│ 288px     │ 自适应                         │ 360px                  │
└───────────┴───────────────────────────────┴────────────────────────┘
```

- 左栏负责工程、模块、搜索、过滤、Prompt 顺序和文件选择。
- 中栏只承担当前对象的高专注编辑；顶部提供角色、启用状态、插入状态、格式化等高频操作。
- 右栏通过 Tabs 切换属性、静态预览与 ST 真实调试，防止同时展示过多信息。
- 低于 `xl` 的中等宽度屏幕默认收起右侧检查器，保证编辑器可用宽度。
- 顶栏按钮可独立收起结构栏和检查器。

### 4.3 手机竖屏

手机不压缩三栏，而改成四个全屏工作视图：

1. **结构**：工程模块、搜索、过滤和文件列表。
2. **编辑**：当前文件编辑器与必要工具栏。
3. **预览**：HTML/CSS 静态设计预览和设备宽度切换。
4. **ST 调试**：连接状态、真实运行入口、Prompt 捕获与 token 摘要。

底部导航固定显示，结构列表选择文件后自动返回编辑视图。顶部将导出、推送和连接等低频操作收进更多菜单。

## 5. 关键界面与交互

### 5.1 顶部工具栏

顶栏从左到右为：产品标识、工程名称与版本、自动保存状态、ST 连接状态、导出、推送至 ST、面板开关。

状态语义必须稳定：

- “工程已保存”仅表示 Docker 工作区已落盘。
- “导出 JSON”是显式构建操作，不改变 ST。
- “推送至 ST”是显式远端操作，不开启后续自动同步。

### 5.2 工程结构树

模块分为 Prompts、Regex、Scripts、快照四类，并显示真实对象总数。Prompt 行需要同时表达：

- 已定义；
- 是否存在于 `prompt_order`；
- 是否启用。

因此列表使用“未插入”“关”和状态圆点表达，而不是把所有状态压成单个启用开关。Marker 使用独立图标，打开后展示插槽说明，不伪造可编辑 content。

### 5.3 Prompt 编辑

Prompt 编辑器由以下区域组成：

- 文件标签；
- 面包屑；
- Role、已插入、已启用等快捷属性；
- Monaco / CodeMirror 编辑主体；
- 语法、编码、行数、字符数和保存目标状态栏。

右侧属性面板提供 identifier、position、depth、order、宏定义和引用统计。属性修改与源码修改使用同一套 500–1000ms 防抖自动保存状态。

### 5.4 Regex 编辑与镜像

样本中的 Regex 集合在三个位置逐字段完全一致，因此 UI 将其识别为一个逻辑集合，并显示三个镜像目标：

- `extensions.regex_scripts`
- `extensions.SPreset.RegexBinding.regexes`
- `prompts/SPresetSettings.content` 中的 SPreset 序列化镜像

编辑时只操作逻辑对象，导出时重建三份镜像。如果未来导入的三份数据不一致，界面应进入冲突诊断状态，而不是静默覆盖。

Regex 静态预览只执行匹配与安全的 HTML/CSS 展示，不执行 replacement 中的 JavaScript。

### 5.5 Script 编辑

脚本编辑器必须明确展示两条边界：

- 工具内可编辑和静态分析 JavaScript，但不会执行项目 JavaScript。
- 只有点击“在 ST 中真实运行”后，脚本才在 ST 的真实扩展环境中执行。

3MB 级脚本进入大文件模式，关闭 minimap、全文件实时语义检查和自动格式化，避免桌面卡顿；手机端使用 CodeMirror 6，仍应对超大单文件给出性能提示。

### 5.6 静态预览

预览包含桌面、平板、手机三个画布宽度，支持：

- HTML 与 CSS；
- CSS 动画；
- `details`、表单等不依赖 JS 的浏览器原生交互；
- 设备框、缩放和预览区滚动。

明确禁用：`script`、inline handler、`javascript:` URL、Tavern Helper、`parent/top` 与 ST API。完整交互使用“在 ST 中真实运行”。

### 5.7 ST 真实调试

ST 调试面板展示：

- ST 与 Bridge 版本、当前角色和聊天；
- 真实运行按钮；
- 最近一次捕获的 Prompt 消息时间线；
- 输入 token、预留输出与总上下文；
- 最终消息树和 DOM 快照入口。

这部分只展示 Bridge 回传的真实运行数据，不在工具内重新实现 ST 的 Prompt 组装、Markdown 或 JavaScript 运行时。

### 5.8 手动推送确认

推送弹窗在真正写入 ST 前展示：

- ST 当前版本与工程构建版本；
- Prompt、Regex、Script 差异摘要；
- Regex 镜像和未知字段校验；
- “仅推送保存”与“推送并应用”两个明确操作。

完成推送后，后续编辑仍只自动保存工程，不自动同步到 ST。

## 6. 组件清单

当前原型已包含以下本地组件：

- Button：default、secondary、ghost、subtle、destructive。
- Badge：neutral、blue、green、amber、red。
- Input、Switch、Tabs、Dialog、DropdownMenu、Tooltip。
- TopBar、Sidebar、EditorPane、Inspector。
- ConnectionGate、ConnectionDialog、PushDialog。
- MobileNav、MobilePreview、MobileRuntime。

正式开发阶段建议继续补充：Command Palette、Tree Virtualizer、Resizable Panels、Split Editor、Empty State、Validation Drawer、Diff Viewer、Token Budget Bar、Regex Pipeline Stepper。

## 7. 响应式规则

| 视口 | 布局策略 | 编辑器 |
| --- | --- | --- |
| `< 768px` | 单视图 + 底部四项导航 | CodeMirror 6 |
| `768–1279px` | 结构栏 + 编辑器；检查器默认隐藏 | 横屏平板使用 Monaco |
| `≥ 1280px` | 完整三栏工作台 | Monaco |

移动端 Prompt/Markdown 默认软换行；代码、JSON、Regex、HTML、CSS 与大文件默认水平滚动。其他页面不得产生页面级横向滚动。底部导航使用 `safe-area-inset-bottom` 适配带 Home Indicator 的设备。

## 8. 当前原型验证结果

- TypeScript 与 Vite 生产构建通过。
- npm 依赖审计未发现漏洞。
- 1280×720：结构栏 288px、检查器 360px，页面无横向或纵向溢出。
- 390×844：连接门禁、结构、编辑和预览布局无横向溢出；ST 调试入口明确显示尚未实现，不展示模拟结果。
- 手机底部导航单项约 96×63px，满足触控操作空间。
- 推送确认弹窗在 1280×720 视口完整显示。
- 浏览器控制台没有 error 或 warning。

## 9. 下一步接入顺序

1. 接入 Prompt 三态模型、Marker、顺序编辑和宏变量静态分析。
2. 接入 Regex 结构化编辑、逻辑镜像、静态流水线与逐步差异。
3. 扩展 Bridge：角色/聊天/Persona/World Info 只读快照，以及最终 Prompt/token/DOM 快照捕获。
4. 实现 preset 手动推送、推送前构建校验与差异确认。
5. 完成 PWA、Docker 实镜像、真实 ST 1.18.0 和多视口性能验收。
