# SillyTavern Preset Studio

面向 SillyTavern Chat Completion preset 的可视化工程工作台。Preset JSON 会被拆成可维护的多文件工程，日常修改只自动保存到服务端工作区；导出或手动推送时才重新构建 JSON。

## 当前能力

- 导入 Chat Completion preset JSON、导入/下载工程 ZIP、创建空白工程和切换多个工程。
- 拆分并重建 Prompt、Regex、Tavern Helper 脚本及未知字段；保持 JSON 语义一致。
- 桌面与横屏平板使用 Monaco，手机使用 CodeMirror 6；大文件按需加载。
- 850ms 防抖自动保存；切换文件、编辑器失焦、构建、导出和推送前强制写盘。
- Revision 乐观并发控制、原子写入、路径穿越/符号链接逃逸防护，以及受限的 ZIP 导入。
- HTML/CSS 静态预览，以及由项目开关和手动启动控制的独立 Origin 动态 HTML/JavaScript 预览。
- 构建、带版本和时间戳的 JSON 导出，以及 Docker 工作区持久化。
- Node 服务直接连接已有的 SillyTavern 1.18.x，不需要安装 ST 扩展；可列出/读取 Chat Completion presets，并从所选 preset 创建一次性工程快照。
- 可选的 Preset Studio Live Bridge 只面向后续真实 ST 页面调试；基础 preset 检查、同步和推送始终不依赖该扩展。当前 `0.1.x` 仅打通扩展检测、安装、更新和卸载链路，尚未提供实时调试能力。
- 推送前生成绑定当前工程和远端目标的短时预览，用户确认后手动保存 preset 到 ST。
- 在目录树中创建、复制、重命名、删除和排序 Prompt、Regex、Script；物理目录继续使用稳定 UUID。
- 在检查器中局部维护高频安全属性，并用结构化 Prompt Order 编辑器维护运行时引用与启用状态。
- 手动/自动快照、恢复与保留策略；删除条目、应用完整 JSON 和恢复前自动建立恢复点。
- 工程设置、validate-only 构建诊断及文件定位；阻断性错误会阻止 JSON 导出与 ST 推送。

真实 ST 上下文快照、token/DOM 捕获和 PWA 仍属于后续阶段。Preset Studio 现在可以生成明确标注为 dry-run 的本地最终 Prompt 快照，但它不是已打开 ST 页面或真实模型请求的捕获。没有 ST 页面扩展时，工具不能读取已打开页面的 DOM/Console，也不能让该页面热切换 preset。

### 动态 JavaScript 与 EJS 预览

- 新建、JSON/ST 导入时可选择是否允许动态 JavaScript；ZIP 可保留包内设置或在导入时强制关闭。旧工程缺少该设置时默认关闭。
- 允许后仍需在检查器“预览”页签手动点击“启动”。HTML 中的 `<script>`、inline handler 和标准浏览器 API 会在独立 Preview Origin 中执行；停止或关闭开关会销毁运行时。
- 动态脚本能够联网、写入 Preview Origin 存储并产生外部副作用。只运行可信代码；停止不会撤销已经完成的请求、下载或远端写入。
- Preview Host 不能访问 Studio `/api`、Cookie 或 DOM。配置错误时不会降级为同源执行。
- 已启用的 `scripts/*/content.js` 会按预设顺序执行一次；消息 HTML、内联事件、外链/模块脚本、项目正则替换和基础 `TavernHelper`/`SillyTavern` 兼容层可在同一会话中协作。
- 提供样本所需的 SPreset/RegexBinding 引导兼容，包括 `chatCompletionSettings`、可重排事件源、`setPreset('in_use', patch)` 深层合并、ST 1.18 版本探测和固定模块入口；这与 Prompt Template 的 EJS 扩展是两条独立兼容链路。
- 大于等于 512 KiB 的项目脚本使用带逐块确认、取消和 SHA-256 校验的 MessagePort 分块传输；单脚本上限为 16 MiB。
- Preview Host 若启动握手失败、运行中意外重载或通信解码失败，会销毁失效运行时并显示“运行失败”；可直接再次点击“启动”，不会复用旧通道。
- Prompt `content.md` 和正则结果支持锁定版本 EJS `3.1.10` 的 EJS-1 子集，包括转义/原始输出、控制流、注释、async、变量、消息、角色和渲染/生成场景。模板在一次性无同源权限 frame 中求值。
- “模拟生成管线”会按当前 preset `prompt_order` 和 Preview Context 组装消息，依次触发生成开始、组合前后、Chat Completion prompt、`GENERATE_AFTER_DATA` 与发送设置事件，运行生成期 EJS，并展示脚本改写后的最终消息和设置。它不会请求模型或写回聊天；事件监听器本身仍会真实执行。
- 当前不实现真实模型生成、精确 ST token/世界书/角色上下文组装、世界书持久化、斜杠命令或真实 ST DOM，也不支持 Prompt Template 的 include、装饰器和完整插件扩展。详见[动态预览实现与兼容状态](./docs/Preset-Studio-动态预览实现与兼容状态.md)。

## 连接 SillyTavern

1. 启动一个用户已有的 SillyTavern，并确认 Preset Studio 的 Node 容器能够访问其 HTTP(S) Origin。
2. 在连接页填写 ST Origin，例如 `http://192.168.1.20:8000`。如果 ST 开启了 Basic Authentication 或多用户登录，只在本次连接中填写相应凭据。
3. Node 通过 ST 的 CSRF、登录、settings 和 preset HTTP API 建立内存会话；浏览器只得到 Preset Studio 自己的 opaque HttpOnly 会话 Cookie。
4. 连接后选择一个 Chat Completion preset 创建工程，或在工程中先执行“推送预览”，再明确确认保存。

只有在未来使用真实 ST 页面调试功能时才需要按界面提示安装 Live Bridge。扩展是可选组件，不会在普通连接、preset 同步或保存流程中强制安装；当前 `0.1.x` 版本只用于验证扩展检测、安装、更新和卸载。它没有 ST 设置面板；安装后请在 ST 的“管理扩展”列表查看，并刷新 ST 页面加载或卸载代码，无需重启服务。

Docker 中的 `127.0.0.1` 指向 Preset Studio 容器自身，不是宿主机。ST 在宿主机运行时，请使用容器可达的 LAN 地址，或在支持的平台使用 `host.docker.internal`；该 Origin 仍需满足下述 target policy。

账号密码、Basic 凭据、ST Cookie 和 CSRF Token 不会写入工程、日志或浏览器持久存储，服务重启、主动断开或空闲超时后需要重新连接。独立保存在 ST secret store 中的 LLM API Key 不会被读取。

完整 preset 可能自身包含 `proxy_password`、`reverse_proxy`、`custom_include_headers` 或扩展私有秘密。这些字段属于 preset 数据，会进入工程目录、工程 ZIP 和导出 JSON；请把这些产物视为敏感配置。

### 推送的准确语义

“保存到 ST”只调用 ST 的 preset 保存接口并写入远端 preset 文件，不会控制已经打开的 ST 浏览器页面，也不会自动把它设为该页面当前 preset。保存成功后，请刷新 ST 的 preset 列表并手动选择目标 preset，再在 ST 中测试 JavaScript、真实生成和前端交互。

## 本地开发

要求 Node.js 22.18+ 与 pnpm 10。

```bash
pnpm install
pnpm --dir server install
pnpm dev
```

`pnpm dev` 会同时启动 Vite 前端和 Node 工程服务。Vite 固定使用 `4173`，API 默认监听 `127.0.0.1:3001`，前端通过同源 `/api` 代理访问；动态预览使用 `http://localhost:3001`，因此请通过 `http://localhost:4173` 打开开发 UI。直连 ST 的请求始终由 Node 发出，浏览器不直接持有 ST 登录会话。生产分离托管时也必须由 UI Origin 同源反向代理 `/api`，不能只靠 CORS 跨站携带会话。

常用命令：

```bash
pnpm build       # 构建前端和服务端
pnpm test        # 后端单元/集成测试
pnpm check       # 完整构建后运行测试
pnpm start       # 生产方式启动已构建的单进程应用
```

### Live Bridge 发布

Live Bridge 的发布源文件位于 [`packages/st-live-bridge`](./packages/st-live-bridge)，可用 `pnpm check:live-bridge` 单独校验。合入 `main` 后，[发布工作流](./.github/workflows/publish-live-bridge.yml)会把该目录镜像到 `kalinote/SPB-live-bridge` 的 `master` 分支。

跨仓库发布使用专用 Deploy Key：在目标仓库添加公钥并允许写入，在本仓库的 Actions secrets 中把对应私钥保存为 `SPB_LIVE_BRIDGE_DEPLOY_KEY`。应用运行时不需要这个密钥或任何新增环境变量。

## Docker Compose

```bash
docker compose up --build
```

默认访问地址是 `http://127.0.0.1:3001`，工程写入仓库下的 `workspace-data/`。可复制 `.env.example` 后调整：

```dotenv
PRESET_STUDIO_WORKSPACE_HOST=./workspace-data
PRESET_STUDIO_BIND=127.0.0.1
PRESET_STUDIO_PORT=3001

# 本机通过 http://127.0.0.1:3001 打开 Studio，localhost:3001 专用于动态预览。
PRESET_STUDIO_PREVIEW_RUNTIME_ENABLED=true
PRESET_STUDIO_PREVIEW_ORIGIN=http://localhost:3001
PRESET_STUDIO_PREVIEW_PARENT_ORIGINS=http://127.0.0.1:3001,http://localhost:3001

# 默认允许连接任意 HTTP(S) ST；如需收紧范围，可改为 private 或 allowlist。
PRESET_STUDIO_ST_TARGET_POLICY=any
PRESET_STUDIO_ST_ALLOWED_ORIGINS=
```

服务级预览开关关闭后，项目中的 JavaScript 允许设置不会被改写；配置的 Preview Host 会继续作为保留隔离域存在，但运行时、固定资源、`/api/*` 和其他路径都会返回 `404`。因此反向代理在开关关闭时也不能把预览子域回退到 Studio 站点。

ST 目标策略：

- `allowlist`：允许回环目标以及 `PRESET_STUDIO_ST_ALLOWED_ORIGINS` 中的精确 Origin。
- `private`：额外允许 IPv4 RFC1918 与 IPv6 ULA，适合 Docker 连接可信 LAN 中的 ST。
- `any`（默认）：允许任意 HTTP(S) 目标，只能用于完全可信的网络。

连接远端目标会使 Node 发起服务端网络请求。link-local（如 `169.254/16`、`fe80::/10`）、unspecified、multicast/reserved 和云 metadata 地址在所有策略下始终拒绝；每次请求都会重新解析 DNS 并固定到当次已校验的地址，重定向也始终拒绝。不要把 `private` 或 `any` 与无鉴权公网部署组合使用；如果必须对公网开放 Preset Studio，请在反向代理增加 HTTPS 和独立访问控制。第一版自身没有用户系统。

## 工程数据

默认工作区是 `workspace-data/`。每个工程有独立目录：

```text
project.json
preset.settings.json
preset.prompt-fields.json
extensions/ext-<base64url(extension-key)>.json
prompts/<uid>/{meta.json,content.md}
regex/<uid>/{meta.json,find.txt,replace.html}
scripts/<uid>/{meta.json,content.js}
snapshots/index.json
snapshots/<uid>/{meta.json,preset.json}
recovery/
output/
```

文件名使用工具生成的稳定 UID，原始 identifier、显示名、顺序和未知字段保留在元数据与 manifest 中。无损定义为 JSON 语义一致，不要求字节、缩进或属性顺序一致。

v0.2.0 的目标与事务约束见 [实施计划](./docs/Preset-Studio-v0.2.0-实施计划.md)，动态脚本能力见 [动态 JavaScript 预览实施计划](./docs/Preset-Studio-动态-JavaScript-预览实施计划.md)和[实现与兼容状态](./docs/Preset-Studio-动态预览实现与兼容状态.md)，后端协议见 [server/README.md](./server/README.md)。

动态预览浏览器测试使用 Playwright。首次运行先执行 `pnpm test:e2e:install` 安装浏览器，然后用 `pnpm test:e2e` 构建并运行 Chromium、Firefox、WebKit 生产矩阵及 React StrictMode 开发构建专项；只跑生产 Chromium 可使用 `pnpm test:e2e:chromium`，只跑 StrictMode 可使用 `pnpm test:e2e:strict`。`pnpm test:e2e:full-sample` 会导入仓库中的 8.7 MB 样本并在 Chromium 中验证其远程 SPreset/RegexBinding 引导及 dry-run 生成事件链；该专项需要能够访问样本引用的第三方资源，因此不放入默认离线矩阵。
