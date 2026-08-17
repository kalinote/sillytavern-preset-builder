# SillyTavern 预设开发工具实施方案

> 文档状态：第一版需求基线  
> 编制日期：2026-08-15  
> 第一版目标 SillyTavern：最新稳定版 release；编制时为 1.18.0  
> 测试基准文件：[主预设] V18 狐神抚 · 毓忻.json  
> 产品暂用名：Preset Studio

## 0. 当前实施进度（2026-08-16）

当前版本已经完成可运行的“工程内核 + 真实源码编辑器 + 基础静态预览 + Node 直连 ST preset”纵切片，但尚未达到本文定义的完整第一版。原 Bridge UI Extension 方案已经废止：用户不需要向 SillyTavern 安装额外扩展，Preset Studio Node 直接使用 ST 1.18.x 的服务端 HTTP API。

已接通的能力：

- Node 服务端多工程工作区、Chat Completion preset JSON 导入拆分、语义 round-trip 校验、按文件自动保存和 revision 冲突检测。
- Prompt、Regex、Tavern Helper Script 的拆分源码编辑；样本中的一致 Regex 三镜像识别为一个逻辑源码并在构建时回填。
- 带 version 与时间戳的 JSON 构建/导出、工程 ZIP 下载与新 ID 导入、`output/` 历史产物。
- 桌面与常规横屏平板 Monaco、手机与矮横屏设备 CodeMirror 6；大文件模式、按需加载、选择与滚动位置的会话内恢复。
- HTML/CSS 无脚本静态预览，含 320ms 刷新防抖、桌面/平板/手机画布、缩放、空 sandbox、CSP 和 no-referrer。
- Dockerfile、Compose、工作区 volume、非 root runtime、healthcheck；API Origin 白名单与健康接口隐私边界。
- 单活动 ST 内存会话、目标地址策略、Basic/账号认证、Cookie jar、CSRF、版本/兼容性检查与连接门禁。
- 列出并读取已连接 ST 的 Chat Completion presets，从用户选定的 preset 手动创建新工程；快照只单向写入新工程，不建立持续同步。
- 推送前构建、目标存在性检查和短时确认 token；用户确认后只把 preset 保存到 ST，不操作已经打开的 ST 页面。

尚未接通的第一版核心能力：

- 角色、聊天、Persona、World Info 一次性只读快照。没有页面扩展时，服务端 API 无法可靠表达某个已打开浏览器标签页的“当前上下文”，需另行设计。
- Prompt 三态、顺序、字段表单和宏分析等结构化工作台。
- Regex 结构化编辑、顺序测试、逐步 diff、静态诊断和镜像冲突处理 UI。
- 最终 Prompt/token/裁剪/usage、ST DOM 快照和运行事件捕获。直连 HTTP API 不提供已打开 ST 页面的 DOM、Console 或 Prompt 事件流。
- PWA manifest、Service Worker 和完整第一版验收。

自动验证基线包括前后端生产构建、工程后端测试和 ST 直连客户端的隔离测试。Docker 配置已完成，但仍需在安装 Docker CLI 的环境中执行真实镜像构建、volume 重启和容器到 LAN ST 的网络验收；真实 ST 1.18.x 仍需覆盖无认证、Basic、多用户登录、preset 读取和手动保存。

## 1. 文档目的

本文档汇总并固化当前已经确认的全部产品需求、技术边界和实施规则，用作第一版的产品设计、技术设计、开发拆分、联调与验收依据。

本文档中的内容分为三类：

- **已确认需求**：已经由需求方明确确认，第一版必须遵守。
- **实施默认**：为使需求可以落地而确定的工程实现方式；若后续没有新的变更，开发按本文执行。
- **第一版非目标**：明确不在第一版实现，避免开发范围膨胀。

## 2. 项目背景

SillyTavern 的 Chat Completion preset 本质上是可由酒馆界面直接导入、导出的 JSON 运行配置。普通作者可以直接在酒馆 UI 中编写 Prompt 并导出 JSON；复杂作者则可能把 Prompt 宏、Regex、HTML/CSS、Tavern Helper JavaScript 和扩展私有数据全部嵌入同一个 JSON。

本项目要解决的问题是：

- 大型 preset JSON 不适合直接人工编辑。
- Prompt 定义、排列顺序和启用状态分散在不同结构中。
- Regex replacement 中可能包含大量 HTML/CSS/JavaScript，缺少面向设计和调试的编辑体验。
- 一个 preset 可能同时包含多份强关联的扩展数据镜像。
- 最终 Prompt 的装配、宏展开、上下文裁剪和真实前端运行依赖 SillyTavern 本身，独立工具难以完全复刻。
- 示例 preset 体积约 8.8 MB，并包含两个约 3.29 MB 的大型 Tavern Helper 脚本，需要工程拆分、按文件编辑和大文件优化。

因此，第一版产品定位为：

> 一个必须连接真实 SillyTavern 的、以服务端拆分工程为数据源的 Chat Completion preset 开发 IDE。

## 3. 第一版总体目标

第一版最重要的能力依次为：

1. Prompt 的结构化编辑、排序、启用和静态分析。
2. 将 preset JSON 拆成可维护的多文件工程，并自动保存工程。
3. Regex 的结构化编辑、静态测试和 HTML/CSS 设计预览。
4. 把构建后的 preset 手动保存到真实 SillyTavern，再由用户在 ST 页面中选择并查看真实前端展示。
5. 在工具中编辑 Tavern Helper 等 JavaScript 源码，但只在真实 ST 中执行。
6. 从真实 ST 单向拉取用户明确选择的 preset；角色、聊天、Persona 和 World Info 同步留待后续接口设计。
7. 将工具中的 preset 工程手动构建、校验、导出，或手动推送到真实 ST。
8. 提供蓝白主题、现代化、适配桌面、平板和手机的 Web/PWA 界面。

## 4. 已确认的核心原则

### 4.1 工程是唯一编辑源

- 导入的 preset JSON 只用于创建工程。
- 日常编辑只修改拆分工程中的文件。
- 编辑过程中不持续修改原始 JSON。
- 最终 JSON 仅在导出或推送到 ST 时构建。
- 自动保存永远只写工程文件，不会自动写入 ST。

### 4.2 工作区位于服务器

- 所有平台均不使用浏览器本地文件夹持续写回。
- 工程统一保存在 Node/Docker 服务端工作区。
- Docker 工作区通过 bind mount 或 named volume 持久化。
- 浏览器通过上传、下载和服务端 API 管理工程。
- 不依赖 showDirectoryPicker、OPFS 或客户端本地工程目录。

### 4.3 必须连接真实 ST

- 第一版使用工具前必须连接一个已经运行且 Node 网络可达的 SillyTavern。
- 第一版不内置或额外启动 SillyTavern 容器。
- 连接目标是用户已有的最新稳定版 ST。
- 未连接 ST 时只显示连接入口，不开放完整工程编辑和调试界面。
- ST 页面负责所有动态运行逻辑；工具不实现完整的 ST Prompt/运行时模拟器，也不尝试通过服务端 REST 控制已打开的页面。

### 4.4 只有 preset 可以写回 ST

- preset 工程可以保存、导出 JSON，并手动推送到真实 ST。
- 后续若加入角色、聊天、Persona、World Info，仍只允许从 ST 单向拉取并作为只读数据。
- 第一版不提供这些内容的上传或写回。
- 第一版不做持续同步、双向同步或冲突合并。

### 4.5 动态执行交给 ST

- 项目 JavaScript 只在真实 SillyTavern 中执行。
- 工具不执行 Tavern Helper、inline handler 或其他项目脚本。
- 工具只提供 HTML/CSS 和无 JavaScript 原生交互的静态预览。
- JavaScript 驱动的按钮、粒子、动态面板、网络、存储和 ST API 行为，必须在用户刷新 preset 列表、手动选择目标后进入真实 ST 查看。

## 5. 第一版范围

### 5.1 支持的 preset 类型

第一版只支持：

- SillyTavern Chat Completion preset。
- 以示例 preset 为基准的 prompts、prompt_order 和 extensions 结构。
- 示例中出现的 Regex、SPreset、Tavern Helper 数据。

第一版不支持：

- Text Completion preset。
- Kobold preset。
- NovelAI preset。
- Instruct、Context、Reasoning 等独立模板格式。
- 其他与样本结构无关的 preset 类型。

### 5.2 支持的工程来源

第一版支持以下方式创建或打开工程：

1. 从真实 ST 中用户选择的 Chat Completion preset 创建新工程。
2. 上传 Chat Completion preset JSON 创建新工程。
3. 上传 Preset Studio 工程压缩包恢复工程。
4. 在已连接 ST 的前提下创建空白 Chat Completion preset 工程。
5. 打开服务器工作区中已有的工程。

### 5.3 支持的工程输出

第一版支持：

- 自动保存拆分工程到 Docker 工作区。
- 下载完整工程压缩包。
- 构建并下载标准 preset JSON。
- 将构建后的 preset 先预览、确认，再手动保存到 ST。
- 将导出的 JSON 同时保存到工程的 output 目录。

## 6. 第一版非目标

第一版明确不实现：

- 浏览器本地工程目录持续读写。
- 离线编辑模式。
- 多用户、账号、登录、权限和租户系统。
- 工具侧 ST 用户名或密码保存。
- 工具侧 LLM API Key、提供商或模型配置。
- 工具侧 OpenAI-compatible 请求客户端或中继。
- 完整复刻 SillyTavern 的宏、World Info、token 裁剪和动态运行时。
- 控制已打开的 ST 浏览器页面、自动切换当前 preset 或声称“已应用”。
- 捕获 ST 页面的最终 Prompt、真实 token、DOM、Console 或生成事件。
- 角色、聊天、Persona、World Info 的“当前页面上下文”同步；服务端 REST 无法可靠定位某个浏览器标签页的当前状态。
- 工具内项目 JavaScript 执行。
- 角色卡 JSON/PNG 上传。
- 聊天 JSONL 上传。
- World Info JSON 上传。
- 手工 Persona 输入。
- 角色、聊天、Persona、World Info 写回 ST。
- 双向实时同步和同步冲突解决。
- Git 或其他版本管理。
- 同时打开多个 preset 工程组成 multi-root 工作区。
- 暗色主题。
- 国际化。
- 第一版专项无障碍适配。
- 对旧版 ST 或 staging 分支的兼容承诺。

## 7. 总体系统架构

### 7.1 组件

系统由三个主要部分组成：

1. **Preset Studio Web/PWA**
   - 提供编辑器、项目管理、静态预览和 ST 连接 UI。
   - 桌面与横屏平板使用 Monaco。
   - 手机使用 CodeMirror 6。

2. **Preset Studio Node 服务**
   - 保存拆分工程。
   - 提供项目、文件、导入、导出和构建 API。
   - 作为受限 HTTP 客户端直接连接用户已有的 ST Server。
   - 在内存中维护 ST Cookie jar、CSRF Token 和连接所需的 Basic 凭据；不持久化账号密码或会话秘密。
   - 不保存或使用 LLM API Key。

3. **用户已有的 SillyTavern Server 与页面**
   - Server 提供 CSRF、用户登录、settings 和 preset REST API。
   - 页面仍由用户直接使用，承担 LLM 生成、JavaScript 执行和真实渲染。
   - 第一版不安装 Preset Studio 扩展，也不向已打开页面注入代码。

### 7.2 逻辑架构

~~~mermaid
flowchart LR
    U[浏览器用户] --> W[Preset Studio Web/PWA]
    W <--> N[Preset Studio Node 服务]
    N --> V[(Docker 持久化工作区)]

    N <-->|受限 HTTP API| SS[SillyTavern Server]
    U --> SUI[已有 SillyTavern 页面]
    SUI <--> SS
    SS --> LLM[ST 当前配置的 LLM 提供商]

    SS -->|所选 preset 单向快照| N
    N -->|用户确认后保存 preset| SS
~~~

### 7.3 运行职责

| 能力 | 工具 | SillyTavern |
|---|---:|---:|
| 工程拆分和保存 | 是 | 否 |
| Prompt/Regex/脚本编辑 | 是 | 否 |
| 静态 HTML/CSS 预览 | 是 | 否 |
| 项目 JavaScript 执行 | 否 | 是 |
| 宏展开和变量运行 | 否 | 是 |
| World Info 激活 | 否 | 是 |
| token 预算和上下文裁剪 | 否 | 是 |
| LLM API Key 与生成请求 | 否 | 是 |
| 真实 Regex/Markdown/DOM 渲染 | 否 | 是 |
| preset 手动保存 | 构建、预览、发起 | 持久化 |
| 当前页面切换 preset | 否 | 用户在 ST 页面手动执行 |
| 角色/聊天/Persona/WI 快照 | 第一版暂缓 | 后续来源 |

## 8. 技术实现基线

以下为满足已确认需求的实施默认。

### 8.1 前端

- React。
- TypeScript。
- Vite。
- PWA 应用壳。
- Tailwind CSS。
- 可配合无样式或 headless 组件库构建表单、弹窗、抽屉和菜单。
- 桌面/平板代码编辑器：Monaco Editor。
- 手机代码编辑器：CodeMirror 6。
- 大文件解析、token 静态分析、JSON 构建和 Regex 测试优先放入 Web Worker。

### 8.2 服务端

- Node.js。
- TypeScript。
- pnpm 管理依赖。
- HTTP REST API，以及带目标策略、Cookie jar 和 CSRF 管理的 ST HTTP 客户端。
- 文件系统作为第一版工程存储。
- 不引入数据库作为第一版必要依赖。

### 8.3 部署

- Dockerfile。
- docker-compose.yml。
- 单个 Preset Studio 服务。
- 工作区挂载到固定数据目录 `/app/workspace-data`。
- 推荐宿主机映射：

~~~yaml
services:
  preset-studio:
    volumes:
      - ./workspace-data:/app/workspace-data
~~~

- 远程或跨设备访问时使用 HTTPS。
- ST 会话依赖 SameSite=Strict、HttpOnly Cookie，UI 和 `/api` 必须同源；分离托管时由 UI Origin 反向代理 `/api`，不能只配置 CORS。
- Docker 连接宿主机或 LAN ST 时，需要保证容器网络可达，并用 `PRESET_STUDIO_ST_ALLOWED_ORIGINS` 精确授权，或显式选择 `private`。
- ST 网络请求由 Node/容器发出，不能把浏览器能够打开某地址等同于容器能够访问。
- 因第一版无鉴权，部署定位为 localhost、可信局域网或 VPN；不支持直接暴露公网。

## 9. ST 直连与会话

### 9.1 连接原则

- 浏览器只连接 Preset Studio Node；Node 直接请求用户指定的 ST HTTP(S) Origin。
- ST 无认证时只填写 Origin；开启 Basic Authentication 或多用户登录时，用户在连接时实时输入对应凭据。
- 凭据不写入磁盘、工程、日志、localStorage 或可被前端 JavaScript 读取的 Cookie。
- Node 只在内存中保存 ST Cookie、CSRF Token、Basic 凭据和连接状态；重启、断开或空闲过期后必须重新连接。
- 使用 256-bit opaque HttpOnly Cookie 把浏览器绑定到单个内存 ST 会话；API 不暴露 connectionId。
- ST 页面登录与工具 Node 会话彼此独立；在一个页面中登录不会自动授权 Node。

### 9.2 连接流程

1. 用户启动 Preset Studio，在连接页填写 ST Origin。
2. 如目标要求认证，用户实时填写 Basic 或 ST 账号登录信息。
3. Node 校验目标策略，只接受允许的 HTTP(S) Origin。
4. Node 获取 `/csrf-token` 和 ST session Cookie。
5. 如提供 ST 账号，Node 调用 `/api/users/login`；Basic 凭据按需附在每个请求上。
6. Node 调用 `/version` 和 `/api/ping?extend=true` 检查版本与会话；目录请求再通过 `/api/settings/get` 读取 Chat Completion presets。
7. Node 创建内存会话，并向浏览器设置 Preset Studio 自己的 HttpOnly 会话 Cookie。
8. 前端显示会话摘要并进入工作台。

Node 不把自己变成无限制的 URL 代理：默认 target policy 只允许回环 Origin 和精确白名单。容器连接可信 LAN 中的 ST 时，部署者必须显式配置精确 Origin 或 `private`；`any` 仅限完全可信网络。

### 9.3 版本握手

第一版目标为编制时最新稳定版 ST 1.18.0。

连接检查至少报告：

- ST 版本。
- release/staging 分支标识，如可获得。
- preset 读取/保存能力。
- 目标策略和实际认证方式。
- ST 服务端公开的兼容性信息。

处理规则：

- 目标版本匹配：正常连接。
- 比目标版本更新：提示“未经验证”，允许进入兼容尝试模式。
- 比目标版本更旧：提示升级，默认不进入完整调试。
- staging：显示不受支持提示。

### 9.4 连接状态

工作台应持续显示：

- 未连接/连接中/已连接/检查失败。
- ST 地址或实例标签。
- ST 版本。
- 登录 handle（如 ST 返回）。
- 可用认证方式、兼容性、最近检查时间和 target policy。

断线后：

- 停止所有新的 ST 操作。
- 中止等待中的 ST HTTP 操作并清除敏感内存状态。
- 保留已经写入服务端的工程内容。
- 返回连接恢复界面。

### 9.5 会话接口和 ST wire contract

Studio 对前端提供单活动会话接口：

- `GET/POST/DELETE /api/st/session`。
- `POST /api/st/session/check`。
- `GET /api/st/presets`。
- `POST /api/st/presets/read`，body 为 `{name}`。

Node 对 ST 1.18.x 使用 `/csrf-token`、`/api/users/login`、`/api/settings/get` 和 `/api/presets/save`。它解析 `settings` JSON 字符串、`openai_setting_names` 与 `openai_settings`，只管理 `apiId: "openai"` 的 Chat Completion presets。第一版不调用 `/api/settings/save`，避免覆盖整个用户设置；也不访问 secret store 或 LLM API。

服务端请求不跟随跨目标重定向，并限制连接时间、总请求时间和响应体大小。日志和 API 响应必须清除 Authorization、账号密码、Cookie、CSRF Token 以及完整 preset 内容。

## 10. 工程生命周期

### 10.1 从 ST 所选 preset 创建工程

1. 用户连接 ST。
2. 工具列出 Chat Completion presets，由用户明确选择来源。
3. 工具显示来源名称、ST 版本和基本统计。
4. 用户填写工程名称，可填写或留空工程 version。
5. Node 创建新的项目 ID 和工作区目录。
6. 导入器拆分 preset。
7. 写入来源信息和源数据哈希。
8. 打开工程编辑页面。

拉取动作只发生一次；工程创建后不会自动跟随 ST preset 变化。

### 10.2 从 JSON 创建工程

1. 用户上传 preset JSON。
2. Node 校验 JSON 和基本 Chat Completion preset 结构。
3. 用户填写工程名称和可选 version。
4. Node 创建工程并拆分。
5. 工程来源记录为 uploaded-json。

### 10.3 创建空白工程

- 仅在已连接 ST 时开放。
- 创建最小可用 Chat Completion preset。
- 自动生成工程 manifest 和必要目录。
- 不自动推送到 ST。

### 10.4 上传和下载工程

- 工程上传格式为 ZIP 压缩包。
- ZIP 根目录必须包含 project.json。
- 服务端解压时拒绝绝对路径、父目录跳转和符号链接逃逸。
- 工程下载时由服务端即时打包。
- 下载工程包含源码、只读快照、输出文件和 manifest。Node 连接时使用的登录密码、Basic 凭据、ST Cookie 和 CSRF Token 只存在于内存会话，不进入工程包；但完整 preset 自身可能保存 `proxy_password`、`reverse_proxy`、自定义请求头等连接字段，这些字段会随语义无损工程进入 ZIP 与导出 JSON，必须按敏感配置管理。

### 10.5 工程打开规则

- 服务端可以保存多个工程目录。
- 单个编辑器会话一次只打开一个工程。
- 一个工程只对应一个 preset JSON 的拆分结果。
- 一个工程内部可包含多个 Prompt、Regex 和脚本文件。

## 11. 工程目录格式

建议第一版工程结构如下：

~~~text
project-root/
├─ project.json
├─ preset.base.json
├─ prompts/
│  ├─ index.json
│  ├─ prompt-order.json
│  └─ <prompt-uid>/
│     ├─ meta.json
│     └─ content.md
├─ regex/
│  ├─ index.json
│  └─ <regex-uuid>/
│     ├─ meta.json
│     ├─ find.txt
│     └─ replace.html
├─ scripts/
│  ├─ index.json
│  └─ <script-uid>/
│     ├─ meta.json
│     └─ content.js
├─ snapshots/
│  └─ <snapshot-id>/
│     ├─ snapshot.json
│     ├─ character.json
│     ├─ chat.jsonl
│     ├─ persona.json
│     └─ world-info/
├─ recovery/
└─ output/
~~~

### 11.1 project.json

至少包含：

- 工程 schema 版本。
- 工程 ID。
- 工程名称。
- 可选 version。
- 创建和更新时间。
- 来源类型：ST、JSON、空白或工程包。
- 来源 ST 版本。
- 来源 preset 名称。
- 当前映射的 ST 目标 preset 名称。
- 原始 JSON 内容哈希。
- 构建规则版本。
- Regex 镜像绑定信息。
- 未知字段保留策略。

### 11.2 preset.base.json

- 保存未被专用编辑器拆出的顶层数据和未知扩展数据。
- 构建时以它作为基础对象。
- 工具只替换明确由工程管理的路径。
- 未知字段不得因为导入、编辑或构建而消失。

### 11.3 文件命名

- 不直接使用 Prompt name 或 identifier 作为真实文件名。
- 使用内部稳定 UID 或原始 UUID。
- 避免 Windows 保留名、非法字符、大小写冲突和路径过长。
- 显示名称保存在 meta.json 和 index.json 中。

## 12. 语义无损规则

第一版只要求 JSON 语义无损，不要求：

- 字节一致。
- 原缩进一致。
- 属性顺序一致。
- 原始空白一致。

必须保证：

- 所有已知和未知字段的值保留。
- false、0、null、空字符串、空数组和空对象不被误删。
- 字符串换行和转义语义正确。
- 未修改工程执行“导入 → 构建”后，与源 JSON 深度语义相等。
- 示例 preset 必须成为 golden round-trip 测试。

## 13. 自动保存与一致性

### 13.1 自动保存范围

自动保存只写服务端工程文件，不会：

- 导出 JSON。
- 推送 ST。
- 修改 ST 当前 preset。
- 修改任何 ST 上下文数据。

### 13.2 自动保存时机

- 用户输入立即更新前端内存状态。
- 500～1000ms 防抖后写入发生变化的小文件。
- 编辑器失焦时强制 flush。
- 切换文件时强制 flush。
- 切换工程时强制 flush。
- 导出 JSON 前强制 flush。
- 推送 ST 前强制 flush。

### 13.3 写入一致性

- 同一工程使用串行写入队列。
- 每个文件保存 revision/hash。
- 使用临时文件加原子 rename。
- manifest/index 最后提交。
- 多标签页打开同一工程时使用项目写锁或租约，避免 last-writer-wins。
- recovery 目录只用于崩溃恢复，不作为用户版本管理功能。

## 14. Prompt 数据模型与编辑器

### 14.1 Prompt 三种状态

工具必须区分：

1. **定义存在**：对象存在于 prompts。
2. **已插入顺序**：identifier 存在于 prompt_order 的 order 中。
3. **已启用**：order 项或兼容字段标记为 enabled。

这三种状态不能合并为一个开关。

示例 preset 中：

- prompts 共 217 项。
- prompt_order 中有 212 项。
- 有 5 个 Prompt 定义不在 order 中。
- 其中仍有定义级 enabled 为 true 的对象。
- 8 个 marker 没有 content，这是合法结构。

### 14.2 Prompt 编辑能力

第一版至少支持：

- Prompt 列表、搜索和过滤。
- 按 order 显示。
- 拖拽排序。
- 添加 Prompt。
- 删除 Prompt。
- 插入到 order。
- 从 order 移除但保留定义。
- 启用和禁用。
- 编辑 name、identifier、role。
- 编辑 marker、system_prompt。
- 编辑 injection_position、injection_depth、injection_order、injection_trigger。
- 编辑 forbid_overrides。
- 编辑未知元字段的 JSON 高级视图。
- 编辑 Prompt 内容。
- 复制 Prompt。
- UUID/稳定 ID 生成。

### 14.3 Marker

marker 是由 ST 在最终 Prompt 构建时填入角色信息、聊天历史、World Info 等数据的插槽。工具应：

- 在列表中使用不同图标和样式显示 marker。
- 允许无 content。
- 不把空 content 判定为错误。
- 在真实 ST 调试结果中显示 marker 最终展开位置。

### 14.4 宏静态分析

工具可静态识别并展示：

- user、char 等基础宏。
- setvar、getvar 等变量宏。
- 变量定义和引用关系。
- 未定义引用。
- 定义但未读取的变量。
- 常见宏格式错误。

宏静态分析只用于辅助编辑；真实展开结果以 ST 为准。

## 15. 真实 ST 手动调试

最终 Prompt 和项目 JavaScript 不由工具模拟，必须使用真实 ST。由于第一版不安装页面扩展，Node 直连 REST 无法捕获已打开 ST 标签页的最终 messages、token 裁剪、Console 或 DOM；第一版只负责把待测 preset 安全保存到 ST，并把用户引导到 ST 页面完成观察。

调试流程：

1. 工具 flush 当前工程。
2. 在内存中构建并校验 preset JSON。
3. 用户执行推送预览，确认 create/overwrite 目标和差异。
4. 用户提交保存；工具明确提示“尚未应用到当前 ST 页面”。
5. 用户打开 ST，刷新 preset 列表并手动选择保存的目标。
6. ST 使用当前角色、聊天、Persona、World Info 和连接配置执行生成。
7. 用户在 ST 自身界面或已有的第三方调试能力中查看 Prompt、token、Console 和渲染结果。

工具不把“保存成功”描述为“已应用”或“已运行”。若后续需要把最终 Prompt 或 DOM 回传到工作台，必须单独选择经用户授权的页面集成方案，不能假定服务端 preset API 具备页面控制能力。

## 16. Token 预算

- 真实 token 计算由 ST 页面和当前模型配置负责。
- 工具不自行选择模型 tokenizer。
- 第一版直连 API 不回传页面运行时 token 统计、上下文裁剪或生成 usage。
- 静态编辑视图可提供字符数和近似提示，但必须标记为估算；真实结果在 ST 中查看。

## 17. Regex 工程模型

### 17.1 Regex 字段

示例 Regex 至少包含：

- id。
- scriptName。
- disabled。
- runOnEdit。
- findRegex。
- trimStrings。
- replaceString。
- placement。
- substituteRegex。
- minDepth。
- maxDepth。
- markdownOnly。
- promptOnly。

### 17.2 Regex 编辑器

第一版至少支持：

- 列表、搜索、过滤和分组。
- 启用/禁用。
- 拖拽排序。
- 新建、复制、删除。
- 表达式编辑。
- replacement HTML 编辑。
- placement/depth/promptOnly/markdownOnly 等字段表单。
- 原始 JSON 高级编辑。
- 单条规则测试。
- 多条规则按顺序测试。
- 每一步的输入、输出、差异、匹配次数和耗时。
- 静态错误提示。

本地 Regex 测试是设计辅助工具，不宣称完全等同于 ST 运行结果。真实结果以 ST 为准。

### 17.3 示例 preset 的三份 Regex 镜像

示例中的同一组 40 条 Regex 被完整存储三次：

1. extensions.regex_scripts。
2. extensions.SPreset.RegexBinding.regexes。
3. prompts[215].content 中解析后的 RegexBinding.regexes。

第三处 Prompt：

- identifier 为 SPresetSettings。
- name 为 SPreset配置。
- 未启用。
- 不在 prompt_order 中。
- content 是整个 extensions.SPreset 的精确 JSON 序列化副本。

三组 Regex 的顺序、40 个 UUID 和所有字段完全一致，因此属于一个逻辑集合的三个存储镜像。

### 17.4 Regex 联动规则

- 工程中每个 Regex UUID 只保存一份。
- project.json 记录三个 mirror target。
- 编辑逻辑对象时，工程源码只修改一份。
- 构建时重建 extensions.regex_scripts。
- 构建时重建 extensions.SPreset.RegexBinding.regexes。
- 构建时重新序列化整个 extensions.SPreset 并写入 SPresetSettings Prompt content。
- SPreset 容器级 active、enabled 等状态独立保留。

### 17.5 不允许的自动去重

40 条 Regex 集合内部没有真正重复项。

即使多条规则具有相同 findRegex，它们也可能用于：

- 不同美化皮肤。
- 隐藏与显示两个阶段。
- 不同消息深度。
- promptOnly 与 markdownOnly。
- 不同 placement。

因此不得根据名称、findRegex 或 replacement 相似度自动合并集合内部规则。

### 17.6 镜像冲突

如果其他 preset 的镜像不一致：

- 不静默覆盖。
- 显示三方差异。
- 默认把 extensions.regex_scripts 标记为“建议运行时权威源”。
- 允许用户选择 A/B/C 来源或拆成独立副本。
- 缺少镜像时不自动创建，除非该 preset 的兼容规则明确要求。

## 18. HTML/CSS 静态预览

### 18.1 预览目标

工具中的预览用于设计：

- Regex replacement 生成的 HTML 结构。
- CSS 布局和视觉效果。
- 桌面、平板和手机尺寸。
- 蓝白工作台中的独立预览画布。
- CSS 动画和无 JavaScript 原生交互。

### 18.2 允许的行为

- HTML。
- CSS。
- CSS animation/transition。
- hover、focus、checked 等 CSS 状态。
- details/summary。
- 普通表单控件。
- 静态图片、字体和样式资源，遵循浏览器网络策略。

### 18.3 禁止的行为

工具预览不执行：

- script 标签。
- inline onclick/onchange 等事件处理器。
- javascript: URL。
- Tavern Helper JavaScript。
- parent/top 访问。
- SillyTavern.getContext()。
- 项目网络和存储逻辑。

### 18.4 iframe

- 使用 sandbox iframe。
- 默认不添加 allow-scripts。
- 预览辅助控件放在 iframe 外。
- 如需工具自有的 iframe 辅助代码，必须先移除项目脚本和事件处理器，再只注入工具受控代码。
- 工具不提供复杂权限模型；这里只负责确保项目 JS 不在工具内执行。

### 18.5 预览标识

工具必须清晰区分：

- **本地设计预览**：HTML/CSS，非 ST 权威结果。
- **在 ST 中查看**：完整 JavaScript 和真实交互。

## 19. ST 静态 DOM 快照

第一版直连方案不提供 ST 静态 DOM 快照。ST 的 preset REST API 只负责读取/保存配置，不能读取某个已打开浏览器页面的 DOM 或 computed styles。

工具保留本地无脚本 HTML/CSS 预览；真实渲染、事件监听器、定时器、网络、存储和 Tavern Helper 交互全部在 ST 页面中查看。后续若重新引入页面侧集成，DOM 快照必须作为独立可选能力设计，并清楚区分静态副本与可交互页面。

## 20. JavaScript 编辑

### 20.1 编辑器选择

- 桌面：Monaco Editor。
- 横屏平板：Monaco Editor。
- 手机竖屏：CodeMirror 6。

### 20.2 大文件优化

- 编辑器和语言服务懒加载。
- Monaco worker 独立打包。
- 启用 largeFileOptimizations。
- 限制超长单行语法分析。
- 默认关闭大型脚本 minimap。
- 大型脚本延迟格式化。
- 列表使用虚拟滚动。
- 切换文件时释放不再使用的 model。

### 20.3 执行规则

- 工具只编辑、搜索、格式化和静态检查脚本。
- 工具不执行项目脚本。
- 用户保存 preset 后，在 ST 页面手动选择目标并运行。
- 第一版工具不捕获 ST 页面的 Console 或错误堆栈。

## 21. 上下文快照

### 21.1 快照来源

该能力在第一版直连重构中暂缓。以下是未来可能从 ST 单向拉取的对象：

- 当前角色。
- 当前聊天。
- 当前 Persona。
- 当前角色 World Info。
- 当前聊天 World Info。
- 当前 Persona World Info。
- 当前选中的全局 World Info。
- 当前 ST 版本和相关源标识。

服务端 REST 会话无法可靠表示某个已打开 ST 标签页的“当前角色/聊天/Persona”，因此不能把 settings 响应误当作页面上下文。第一版不展示伪造的当前上下文。

### 21.2 未来快照属性

- 单向拉取。
- 一次性。
- 只读。
- 不自动刷新。
- 不同步回 ST。
- 不参与冲突合并。
- 可以创建多个带时间戳的快照。

### 21.3 未来上下文变化

快照应记录源对象标识和内容哈希。

真实调试前，工具比较：

- 当前角色。
- 当前聊天。
- 当前 Persona。
- 当前 World Info 组合。

如与选中快照不一致，显示“ST 当前上下文已变化”，用户可以：

- 继续使用当前真实上下文运行。
- 重新拉取一个新快照。

由于第一版禁止把快照写回 ST，旧快照不能被用于恢复旧 ST 上下文。

## 22. Preset 手动推送

### 22.1 推送原则

- 推送永远由用户手动触发。
- 自动保存不会触发推送。
- 导出 JSON 不会触发推送。
- 打开或关闭工程不会触发推送。

### 22.2 推送流程

1. 强制完成工程自动保存。
2. 构建 preset JSON。
3. 执行 schema、Prompt 引用、Regex 镜像和 JSON 校验。
4. 获取目标 ST 当前对应 preset。
5. 展示 created/changed/unchanged、工程与远端 revision/体积和构建 diagnostics；字段级 Diff Viewer 可后续增强。
6. 用户选择保存目标。
7. 用户明确确认。
8. Node 使用 `/api/presets/save` 在 ST 中保存或更新 preset。
9. 回传保存结果和 ST 端最终名称，并提示用户刷新 ST 列表、手动选择。

### 22.3 默认目标

- 从 ST preset 创建的工程，默认映射回来源 preset。
- 从 JSON 或空白创建的工程，默认目标名为 [Preset Studio] {projectName}。
- project.json 保存 ST 目标名称。
- create 模式要求目标不存在；overwrite 模式要求目标已存在。模式与目标不匹配时拒绝，不静默改变语义。

### 22.4 推送操作

界面只提供语义准确的 **保存到 ST**：保存远端 preset，但不切换任何已打开页面的当前 preset。目标操作由用户在预览时明确选择：

- **创建新 preset**：目标必须不存在。
- **覆盖已有 preset**：目标必须存在，并显示远端 revision 与总体变化；不得在没有字段级比较时声称已展示完整 diff。

预览返回的 256-bit token 仅在 Node 内存保存，5 分钟有效，绑定会话、工程、目标名、模式、工程构建 hash/revision 和远端 hash。每次提交尝试都会消费 token；任一绑定条件变化都要求重新预览。

## 23. JSON 构建与导出

### 23.1 构建过程

1. 读取 preset.base.json。
2. 深拷贝基础对象。
3. 重建 prompts。
4. 重建 prompt_order。
5. 重建 Regex 逻辑集合及镜像。
6. 重建 Tavern Helper scripts。
7. 写回工具明确管理的扩展路径。
8. 保留未知顶层和扩展字段。
9. 执行语义无损检查。
10. 输出格式化 JSON。

### 23.2 导出命名

- version 非空：

~~~text
{name}-{version}-{YYYYMMDD-HHmmss}.json
~~~

- version 为空：

~~~text
{name}-{YYYYMMDD-HHmmss}.json
~~~

- timestamp 使用文件系统安全格式，不包含冒号。

### 23.3 输出位置

- 写入工程 output 目录。
- 同时返回浏览器下载。
- 不覆盖以前输出；时间戳用于区分。

## 24. UI 与交互

### 24.1 视觉

- 蓝白主题。
- 第一版仅亮色。
- 现代、简洁、内容密度适合工程工具。
- 状态颜色至少区分成功、警告、错误、未连接和未保存。

### 24.2 桌面布局

推荐三栏：

1. 左栏：工程文件树和功能导航。
2. 中栏：Prompt/Regex/脚本编辑器。
3. 右栏：属性、静态预览、ST 调试结果。

### 24.3 平板布局

- 横屏尽量保留分栏。
- 可折叠左侧树和右侧检查器。
- 使用 Monaco。
- 支持触控拖拽和较大命中区域。

### 24.4 手机布局

- 单栏。
- 底部导航或顶部标签切换：结构、编辑、预览、ST。
- 属性面板使用全屏抽屉。
- CodeMirror 6 替代 Monaco。
- 拖拽排序提供触控手柄及上移/下移替代按钮。
- 真实交互通过“在 ST 中查看”跳转。

### 24.5 关键状态

界面持续显示：

- ST 连接状态。
- 工程自动保存状态。
- 当前工程名和可选 version。
- 当前编辑文件。
- JSON 构建状态。
- 当前 ST preset 映射。
- 是否存在未推送修改。

“未推送修改”与“未保存工程”是两个独立状态。

## 25. 服务端 API 建议

第一版 REST API 可按以下资源组织：

### 25.1 项目

- GET /api/projects
- POST /api/projects
- GET /api/projects/:projectId
- DELETE /api/projects/:projectId
- POST /api/projects/import/json
- POST /api/projects/import/archive
- GET /api/projects/:projectId/archive

### 25.2 文件

- GET /api/projects/:projectId/files
- GET /api/projects/:projectId/files/*
- PUT /api/projects/:projectId/files/*
- POST /api/projects/:projectId/flush

### 25.3 构建与导出

- POST /api/projects/:projectId/build
- POST /api/projects/:projectId/export
- GET /api/projects/:projectId/outputs
- GET /api/projects/:projectId/outputs/:filename

### 25.4 ST 直连

- GET /api/st/session
- POST /api/st/session
- DELETE /api/st/session
- POST /api/st/session/check
- GET /api/st/presets
- POST /api/st/presets/read，body 为 `{name}`
- POST /api/projects/create-from-st，body 为 `{presetName,name?,version?}`
- POST /api/projects/:projectId/push-preview，body 为 `{targetName,mode:"create"|"overwrite"}`
- POST /api/projects/:projectId/push-preset，body 为 `{previewToken}`

浏览器只通过 HttpOnly Cookie 选择当前内存会话，不传 connectionId。push 必须先 preview，服务端不接受绕过预览直接提交 preset JSON。

## 26. 校验与诊断

### 26.1 导入校验

- JSON 语法。
- Chat Completion preset 基本结构。
- prompts 类型。
- prompt_order 引用。
- identifier 重复或缺失。
- Prompt 定义未进入 order。
- order 引用不存在的 Prompt。
- Regex UUID 冲突。
- Regex 三镜像一致性。
- Tavern Helper 脚本结构。
- 未知扩展报告。

### 26.2 构建校验

- 所有工程索引指向存在的文件。
- 所有 Prompt meta/content 可读取。
- prompt_order 可重建。
- Regex mirror target 可重建。
- SPresetSettings 序列化正确。
- JSON 可被重新解析。
- 与未修改源进行语义 round-trip 比较。

### 26.3 静态诊断

- Prompt 宏格式。
- setvar/getvar 关系。
- Regex 语法。
- Regex 无匹配或过宽匹配提示。
- replacement HTML 基本解析。
- Script 语法检查。
- 大文件和超长单行提示。

静态诊断不负责证明项目安全。

## 27. 性能要求

第一版必须以示例 8.8 MB preset 为基准：

- 导入不导致浏览器长时间无响应。
- Prompt 列表使用虚拟滚动。
- Regex 列表使用虚拟滚动。
- 大脚本按需加载。
- 不一次性把全部大型脚本装入所有编辑器 model。
- 自动保存只写变化文件，不序列化整个工程。
- JSON 构建放在 Node 或 Worker 中。
- UI 主线程的长任务应可观测。

建议目标：

- 普通 Prompt 输入响应保持流畅。
- 自动保存状态在防抖结束后及时更新。
- 大脚本首次打开可以出现加载提示，但不能导致页面崩溃。
- 移动端默认不自动打开 3 MB 级脚本。

## 28. 安全与信任边界

### 28.1 已确认立场

- 产品是工具，不承担判断第三方 preset JavaScript 是否安全的责任。
- 不实现复杂的项目脚本权限或能力系统。
- 项目 JavaScript 只在用户自己的真实 ST 中执行。

### 28.2 工具侧最低边界

- 静态预览不执行项目 JS。
- 工程上传 ZIP 防止路径穿越。
- Node 文件 API 限制在工作区根目录。
- 连接时可以接收 ST 账号密码或 Basic 凭据，但只用于建立/维持内存会话；不得写入磁盘、工程、日志、localStorage 或前端可读 Cookie。
- ST Cookie、CSRF Token 和必要的 Basic 凭据只保存在 Node 内存，重启、断开或空闲超时即失效；浏览器只得到 256-bit opaque HttpOnly、SameSite=Strict 会话 Cookie。
- 不访问 ST secret store 或 LLM API Key。
- 完整 preset 自身携带的代理密码、连接地址或自定义请求头属于 preset 数据，会进入工程；界面必须在从 ST 拉取、下载 ZIP 和导出时提示敏感配置边界。
- 日志不主动记录这些秘密。
- ST target policy 默认只允许回环 Origin 与精确白名单；`private` 仅增加 IPv4 RFC1918 与 IPv6 ULA，`any` 必须显式启用。link-local（包括 `169.254/16`、`fe80::/10`）、unspecified、multicast/reserved、云 metadata 和非 HTTP(S) 目标在所有策略下始终拒绝。
- 每次 ST 请求重新解析 DNS、校验全部结果并固定本次已校验地址；任何重定向都拒绝，同时限制连接超时、总请求时间和响应体大小。
- 推送确认 token 为 256-bit 随机值、5 分钟有效、单次尝试消费，并绑定会话/工程/目标/模式/构建 hash 与远端 hash。

### 28.3 部署边界

第一版没有用户和鉴权系统，因此：

- 默认只面向 localhost、可信 LAN 或 VPN。
- 不承诺公网安全部署。
- 如果部署者要暴露公网，应在外部反向代理层自行增加 HTTPS 和访问控制。
- `private`/`any` 会扩大 Node 可访问的 ST 目标；不得让不可信用户控制连接或推送接口。

### 28.4 ST 执行边界

在真实 ST 中运行的项目脚本可能访问 ST 页面、聊天、预设、localStorage、IndexedDB 和网络。工具不会改变这一权限模型。

## 29. 日志与可观测性

服务端日志至少包含：

- 工程创建、打开、保存、构建和导出。
- ST 会话建立、检查、断开、目标 Origin 和版本。
- preset 目录、读取、推送预览和保存结果。
- 构建和校验错误。

日志不得主动记录：

- ST 登录密码；preset 自身连接字段的值也不得写入日志。
- Cookie。
- CSRF Token。
- LLM API Key。

前端调试台至少显示：

- ST 会话状态、兼容性和 target policy。
- 请求 ID。
- 当前调试步骤。
- ST 回传错误。
- 构建错误。
- 自动保存错误。

## 30. 测试策略

### 30.1 单元测试

- JSON 导入和拆分。
- Prompt 三状态转换。
- prompt_order 重建。
- Regex 镜像识别和重建。
- SPresetSettings 序列化。
- 工程路径和安全文件名。
- 输出文件命名。
- 自动保存 revision。
- ZIP 安全解压。
- ST Origin 规范化、target policy、link-local/metadata 拒绝和 redirect 拒绝。
- Cookie jar、CSRF、Basic/账号认证以及内存会话隔离/过期。
- push preview token 的绑定、超时、单次消费与远端冲突。

### 30.2 Golden 测试

使用示例 preset 执行：

1. 导入。
2. 不做修改。
3. 构建。
4. 深度比较源 JSON 与输出 JSON。

必须验证：

- 217 个 Prompt 保留。
- 212 个 order 项保留。
- 未进入 order 的 Prompt 保留。
- 40 个 Regex 保留。
- 三份 Regex 镜像一致。
- SPresetSettings 内容正确重建。
- 3 个 Tavern Helper 脚本保留。
- 大型脚本内容哈希不变。
- 未知字段不丢失。

### 30.3 集成测试

- Docker volume 持久化。
- JSON 上传创建工程。
- 工程 ZIP 上传和下载。
- 自动保存后重启容器恢复。
- ST 1.18.x 无认证、Basic、多用户登录及组合认证直连。
- 列出/读取所选 ST preset 并创建一次性工程快照。
- create/overwrite 目标规则、revision/总体变化预览与确认 token。
- 手动保存 preset 后，在 ST 刷新并手动选择验证结果。
- Node 重启、主动断开和空闲过期后敏感会话清除。
- 工具中项目 JS 不执行。
- 项目 JS 在 ST 中按真实环境执行。

### 30.4 响应式测试

- 桌面 Chrome/Edge/Firefox/Safari 的现代版本。
- Android 和 iOS 的现代浏览器。
- 桌面 Monaco。
- 横屏平板 Monaco。
- 手机 CodeMirror 6。
- 竖屏窄宽度下无关键操作丢失。

## 31. 第一版验收标准

满足以下条件时第一版可验收：

1. Docker Compose 可启动工具并通过 volume 保留工程。
2. 工具必须连接 ST 1.18.0 才能进入完整工作台。
3. 目标需要认证时可实时输入 ST 账号或 Basic 凭据，但工具不持久化、不回显、不记录这些信息。
4. 可列出 ST Chat Completion presets，并从用户选择的 preset 创建工程。
5. 可从示例 JSON 创建工程。
6. 可创建空白工程。
7. 可上传和下载工程 ZIP。
8. Prompt 定义、插入和启用状态被正确区分。
9. 可编辑、排序、添加、删除、插入和移除 Prompt。
10. Regex 可结构化编辑和静态测试。
11. 示例 Regex 三镜像被识别为一个逻辑集合。
12. 集合内部相似规则不被自动合并。
13. Tavern Helper 脚本可用 Monaco/CodeMirror 编辑。
14. 工具内不执行项目 JavaScript。
15. 工具可进行 HTML/CSS 静态预览。
16. 保存 preset 后可在 ST 中手动选择它，进行真实 JavaScript 和前端运行测试。
17. 工具不把 REST 连接冒充页面运行时，不伪造最终 Prompt、token、DOM 或当前上下文捕获。
18. 工具不提供角色、聊天、Persona、World Info 文件上传或写回。
19. 自动保存只修改工程。
20. preset 只能通过手动操作保存到 ST，不自动切换已打开的 ST 页面。
21. 保存前构建、校验、显示目标 revision/总体变化，并使用短时单次确认 token 防止内容/目标变化。
22. 可导出带可选 version 和时间戳的 JSON。
23. 未修改示例可完成语义无损 round-trip。
24. 工具不保存 LLM API Key，也不实现模型请求客户端。
25. 桌面、横屏平板和手机布局可用。

## 32. 实施阶段

### 阶段 0：技术验证

- 验证 ST 1.18.x `/csrf-token`、用户登录、settings 和 preset API。
- 验证无认证、Basic、多用户登录及组合认证。
- 验证 Chat Completion preset 目录、指定读取和保存。
- 验证 target policy、redirect、超时、响应体限额和敏感日志清理。
- 验证 Cookie/CSRF 内存生命周期与手机浏览器的 HttpOnly 会话绑定。

阶段 0 是后续开发的前置门槛。

### 阶段 1：工程内核

- Node/Vite/React 基础工程。
- Docker 和 volume。
- 项目 API。
- JSON 导入。
- 工程 ZIP。
- 拆分格式。
- 自动保存。
- 构建与语义 round-trip。

### 阶段 2：Prompt 工作台

- Prompt 三状态列表。
- 拖拽排序。
- 内容和元数据编辑。
- 宏静态分析。
- marker 显示。
- 移动端布局。

### 阶段 3：Regex 与脚本

- Regex 结构化编辑。
- 三镜像联动。
- 静态 Regex 流水线。
- HTML/CSS 静态预览。
- Monaco/CodeMirror 脚本编辑。
- 大文件优化。

### 阶段 4：ST 联调

- 强制连接入口。
- ST 内存会话、认证、兼容性和版本检查。
- 从 ST preset 创建工程。
- preset 目录和指定读取。
- 保存后引导用户在 ST 中刷新、手动选择和查看。

### 阶段 5：推送、验收与交付

- create/overwrite 手动保存。
- revision/总体变化确认和单次 preview token。
- 示例 golden 测试。
- Docker Compose 文档。
- ST 直连、凭据生命周期和目标策略文档。
- 使用手册。
- 性能和响应式验收。

## 33. 主要风险与应对

| 风险 | 影响 | 第一版应对 |
|---|---|---|
| ST release 更新导致内部 API 变化 | preset 目录/保存失效 | 固定 1.18.x 基线、版本检查、wire contract 测试 |
| Node 直连任意 URL 形成 SSRF | 内网服务或 metadata 暴露 | 默认回环+精确白名单；private 仅 RFC1918/ULA；始终拒绝 link-local/metadata；禁跨目标 redirect |
| ST 凭据或会话泄露 | 账号或配置暴露 | 只存 Node 内存、opaque HttpOnly Cookie、日志/响应脱敏、空闲过期 |
| 已有 ST 扩展环境差异 | 渲染结果不同 | 以用户在真实 ST 页面看到的结果为权威 |
| 3 MB 级脚本编辑性能 | 页面卡顿或崩溃 | 懒加载、Worker、大文件模式、移动端 CodeMirror |
| 8.8 MB JSON 整体序列化 | 导入/构建延迟 | Node/Worker 构建、进度状态、只保存变化文件 |
| Regex 镜像不一致 | 导出覆盖数据 | 冲突诊断，不静默联动 |
| 无鉴权部署在公网 | 数据泄露或被修改 | 明确仅可信网络，公网由部署者外加访问控制 |
| REST 无法读取已打开页面上下文/DOM | 工具内无法捕获真实运行结果 | 第一版明确只保存 preset，并引导用户在 ST 手动运行；不伪造数据 |
| 工具静态预览与 ST 渲染差异 | 用户误判 | 明确标记本地预览非权威，以 ST 页面结果为准 |

## 34. 后续版本方向

第一版之后可以考虑：

- 直接保存到更多 ST 内容类型。
- 角色、聊天、Persona、World Info 双向同步。
- 同步冲突解决。
- 多 ST 实例和多连接管理。
- 版本管理、历史、分支和差异恢复。
- 暗色主题。
- 国际化。
- 无障碍完善。
- 更多 preset 类型。
- 可选的 ST 页面集成、最终 Prompt/DOM/Console 捕获与网络面板。
- 受控的 JavaScript 沙箱和权限报告。
- 多用户、鉴权和公网部署。
- 专用测试 ST 容器。

这些内容不进入第一版排期。

## 35. 参考资料

- SillyTavern 源码：https://github.com/SillyTavern/SillyTavern
- SillyTavern 官方文档：https://docs.sillytavern.app/
- Chat Completion 文档：https://docs.sillytavern.app/usage/api-connections/openai/
- Tokenizer 文档：https://docs.sillytavern.app/usage/prompts/tokenizer/
- World Info 文档：https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- Chat 文件文档：https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/
- SillyTavern 1.18.0：https://github.com/SillyTavern/SillyTavern/releases/tag/1.18.0
- 参考 VSCode 插件：https://github.com/Mooooooon/SillyTavern-Preset-Editor

---

本实施方案作为第一版开发基线。后续需求变更应明确修改对应章节，并同步更新验收标准和阶段范围。
