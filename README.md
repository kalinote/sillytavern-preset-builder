# SillyTavern Preset Studio

面向 SillyTavern Chat Completion preset 的可视化工程工作台。Preset JSON 会被拆成可维护的多文件工程，日常修改只自动保存到服务端工作区；导出或手动推送时才重新构建 JSON。

## 当前能力

- 导入 Chat Completion preset JSON、导入/下载工程 ZIP、创建空白工程和切换多个工程。
- 拆分并重建 Prompt、Regex、Tavern Helper 脚本及未知字段；保持 JSON 语义一致。
- 桌面与横屏平板使用 Monaco，手机使用 CodeMirror 6；大文件按需加载。
- 850ms 防抖自动保存；切换文件、编辑器失焦、构建、导出和推送前强制写盘。
- Revision 乐观并发控制、原子写入、路径穿越/符号链接逃逸防护，以及受限的 ZIP 导入。
- HTML/CSS 无脚本静态预览；iframe 不授予脚本权限，项目 JavaScript 不会在工具中执行。
- 构建、带版本和时间戳的 JSON 导出，以及 Docker 工作区持久化。
- Node 服务直接连接已有的 SillyTavern 1.18.x，不需要安装 ST 扩展；可列出/读取 Chat Completion presets，并从所选 preset 创建一次性工程快照。
- 推送前生成绑定当前工程和远端目标的短时预览，用户确认后手动保存 preset 到 ST。

Prompt/Regex 的完整结构化工作台、上下文快照、最终 Prompt/token/DOM 捕获和 PWA 仍属于后续阶段。没有 ST 页面扩展时，工具不能读取已打开页面的 DOM/Console，也不能让该页面热切换 preset；界面不会用模拟结果冒充真实 ST 运行数据。

## 连接 SillyTavern

1. 启动一个用户已有的 SillyTavern，并确认 Preset Studio 的 Node 容器能够访问其 HTTP(S) Origin。
2. 在连接页填写 ST Origin，例如 `http://192.168.1.20:8000`。如果 ST 开启了 Basic Authentication 或多用户登录，只在本次连接中填写相应凭据。
3. Node 通过 ST 的 CSRF、登录、settings 和 preset HTTP API 建立内存会话；浏览器只得到 Preset Studio 自己的 opaque HttpOnly 会话 Cookie。
4. 连接后选择一个 Chat Completion preset 创建工程，或在工程中先执行“推送预览”，再明确确认保存。

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

`pnpm dev` 会同时启动 Vite 前端和 Node 工程服务。Vite 默认尝试 `4173`，端口被占用时会选择下一个端口；API 默认监听 `127.0.0.1:3001`，前端通过同源 `/api` 代理访问。直连 ST 的请求始终由 Node 发出，浏览器不直接持有 ST 登录会话。生产分离托管时也必须由 UI Origin 同源反向代理 `/api`，不能只靠 CORS 跨站携带会话。

常用命令：

```bash
pnpm build       # 构建前端和服务端
pnpm test        # 后端单元/集成测试
pnpm check       # 完整构建后运行测试
pnpm start       # 生产方式启动已构建的单进程应用
```

## Docker Compose

```bash
docker compose up --build
```

默认访问地址是 `http://127.0.0.1:3001`，工程写入仓库下的 `workspace-data/`。可复制 `.env.example` 后调整：

```dotenv
PRESET_STUDIO_WORKSPACE_HOST=./workspace-data
PRESET_STUDIO_BIND=127.0.0.1
PRESET_STUDIO_PORT=3001

# 默认只允许回环 ST；连接局域网 ST 时可改为 private，或配置精确 Origin 白名单。
PRESET_STUDIO_ST_TARGET_POLICY=allowlist
PRESET_STUDIO_ST_ALLOWED_ORIGINS=http://192.168.1.20:8000
```

ST 目标策略：

- `allowlist`（默认）：允许回环目标以及 `PRESET_STUDIO_ST_ALLOWED_ORIGINS` 中的精确 Origin。
- `private`：额外允许 IPv4 RFC1918 与 IPv6 ULA，适合 Docker 连接可信 LAN 中的 ST。
- `any`：允许任意 HTTP(S) 目标；必须显式启用，只能用于完全可信的网络。

连接远端目标会使 Node 发起服务端网络请求。link-local（如 `169.254/16`、`fe80::/10`）、unspecified、multicast/reserved 和云 metadata 地址在所有策略下始终拒绝；每次请求都会重新解析 DNS 并固定到当次已校验的地址，重定向也始终拒绝。不要把 `private` 或 `any` 与无鉴权公网部署组合使用；如果必须对公网开放 Preset Studio，请在反向代理增加 HTTPS 和独立访问控制。第一版自身没有用户系统。

## 工程数据

默认工作区是 `workspace-data/`。每个工程有独立目录：

```text
project.json
preset.base.json
prompts/<uid>/{meta.json,content.md}
regex/<uid>/{meta.json,find.txt,replace.html}
scripts/<uid>/{meta.json,content.js}
snapshots/
recovery/
output/
```

文件名使用工具生成的稳定 UID，原始 identifier、显示名、顺序和未知字段保留在元数据与 manifest 中。无损定义为 JSON 语义一致，不要求字节、缩进或属性顺序一致。

详细设计见 [实施方案](./docs/SillyTavern预设开发工具-实施方案.md) 和 [UI 设计说明](./docs/SillyTavern预设开发工具-UI设计说明.md)，后端协议见 [server/README.md](./server/README.md)。
