# Preset Studio 工程后端

第一版工程后端使用 Node.js 原生 HTTP 与文件系统 API，不依赖数据库。它同时提供工程存储 API、生产前端静态文件，以及到用户已有 SillyTavern 的受限服务端 HTTP 客户端；连接不要求向 SillyTavern 安装任何额外组件。

## 启动

```bash
pnpm --dir server install
pnpm --dir server dev
```

默认只监听 `127.0.0.1:3001`。生产构建与启动：

```bash
pnpm --dir server build
pnpm --dir server start
```

工程根目录由 `PRESET_STUDIO_WORKSPACE` 指定；未设置时使用仓库根目录下的 `workspace-data/`。ZIP 工程包使用 `fflate`。

## 环境变量

### 服务与工程

- `PORT`：HTTP 端口，默认 `3001`。
- `HOST`：监听地址，默认 `127.0.0.1`。
- `PRESET_STUDIO_WORKSPACE`：工程工作区绝对或相对路径。
- `PRESET_STUDIO_STATIC_ROOT`：生产前端目录；默认自动寻找仓库根目录的 `dist/`。
- `PRESET_STUDIO_BODY_LIMIT_MIB`：JSON 请求体上限，默认 `64` MiB。
- `PRESET_STUDIO_ZIP_MAX_MIB`：ZIP 压缩体积上限，默认 `64` MiB。
- `PRESET_STUDIO_ZIP_UNPACKED_MIB`：ZIP 解压总大小上限，默认 `256` MiB。
- `PRESET_STUDIO_ZIP_FILE_MIB`：ZIP 单文件解压大小上限，默认 `128` MiB。
- `PRESET_STUDIO_ZIP_MAX_ENTRIES`：ZIP 文件和目录条目上限，默认 `10000`。
- `PRESET_STUDIO_ALLOWED_ORIGINS`：允许直接跨源访问 Studio API 的 HTTP(S) Origin，多个值用英文逗号分隔；默认空，只允许同源浏览器请求。
- `PRESET_STUDIO_EXPOSE_WORKSPACE_PATH`：设为 `true` 时才在 `/api/health` 返回工作区绝对路径，默认 `false`。
- `PRESET_STUDIO_PREVIEW_RUNTIME_ENABLED`：服务级动态预览总开关，默认 `true`；设为 `false`、`0`、`no` 或 `off` 后，配置的 Preview Host 仍作为隔离域保留，但所有路径统一返回 `404`，项目级开关保持不变，静态预览仍可用。兼容计划早期使用的别名 `PREVIEW_RUNTIME_ENABLED`，前者优先。
- `PRESET_STUDIO_PREVIEW_ORIGIN`：独立 JavaScript Preview Host 的公开 Origin；本机启动脚本默认 `http://localhost:<PORT>`。必须与 Studio UI 不同源。
- `PRESET_STUDIO_PREVIEW_PARENT_ORIGINS`：允许嵌入 Preview Host 并完成消息握手的 Studio Origin，逗号分隔。反向代理或 LAN 部署必须显式配置实际 UI Origin。

### SillyTavern 直连

- `PRESET_STUDIO_ST_TARGET_POLICY`：ST 目标策略，取值 `allowlist`、`private` 或 `any`，默认 `any`。
- `PRESET_STUDIO_ST_ALLOWED_ORIGINS`：精确允许的 ST HTTP(S) Origin，逗号分隔；默认空。
- `PRESET_STUDIO_ST_CONNECT_TIMEOUT_MS`：建立 ST 网络连接的超时，默认 `10000` ms。
- `PRESET_STUDIO_ST_REQUEST_TIMEOUT_MS`：单次 ST 请求的总超时，默认 `30000` ms。
- `PRESET_STUDIO_ST_RESPONSE_LIMIT_MIB`：单个 ST 响应体上限，默认 `64` MiB。
- `PRESET_STUDIO_ST_SESSION_IDLE_MINUTES`：内存连接会话空闲过期时间，默认 `480` 分钟。

目标策略的含义：

- `allowlist`：始终允许回环 Origin，并允许 `PRESET_STUDIO_ST_ALLOWED_ORIGINS` 中逐项精确匹配的 Origin。
- `private`：允许回环、IPv4 RFC1918 和 IPv6 ULA 目标，适合容器连接可信 LAN 中的 ST。
- `any`：允许任意 HTTP(S) Origin。这是默认值，只能在完全可信的网络中使用。

目标只接受规范化的 HTTP(S) Origin，不把路径、查询、片段或 URL 用户信息作为连接目标。`169.254/16`、`fe80::/10` 等 link-local、unspecified、multicast/reserved 和云 metadata 地址在所有策略（包括显式 allowlist 和 `any`）下始终拒绝。每次 ST 请求都重新解析 DNS、校验所有结果并把本次连接固定到已校验地址；任何重定向都拒绝。请求同时受连接超时、总超时和响应体大小限制。`private`/`any` 会扩大服务端请求能力；Preset Studio 自身又没有用户鉴权，因此不得直接暴露公网。

## Origin 与浏览器访问边界

服务端默认不发送通配 CORS，也不会回显任意 Origin：

- 没有 `Origin` 的 CLI、Docker healthcheck 和服务间请求保持可用。
- 浏览器访问生产服务时，只允许与有效请求 Host/Protocol 相同的 Origin。
- Vite 或同源反向代理转发时，浏览器仍通过 `/api` 同源访问，不需要额外 CORS 配置。
- 仅对无 ST 会话的工程 API/CLI 场景，如确需从另一个 Origin 直接请求 Studio API，可精确设置 `PRESET_STUDIO_ALLOWED_ORIGINS`，例如 `http://localhost:4174,https://studio.example.com`。
- 不可信 Origin 的普通请求、非简单请求和 preflight 均返回 `403 ORIGIN_NOT_ALLOWED`。不支持 `*`、路径、用户信息或非 HTTP(S) Origin。
- 反向代理终止 HTTPS 时应保留原始 `Host` 并设置 `X-Forwarded-Proto: https`，否则显式配置外部 Origin。

ST 会话 Cookie 是 `SameSite=Strict`，前端请求使用 `credentials: "same-origin"`；因此使用 ST 连接能力时，UI 与 `/api` 必须同源。开发环境通过 Vite `/api` proxy 满足这一点；生产分离托管时必须把 `/api` 反向代理到与 UI 相同的 Origin。CORS 白名单不能替代同源反代，也不能用于跨站携带 ST 会话。

`PRESET_STUDIO_ALLOWED_ORIGINS` 控制无会话 API 的浏览器跨源边界；`PRESET_STUDIO_ST_ALLOWED_ORIGINS` 控制 Studio Node 能连接哪些 ST。两者用途不同，不能互相替代。Origin 校验也不等同于用户认证。

### JavaScript Preview Host

同一个 Node 监听器按请求 `Host` 区分 Studio 与 Preview Host。匹配 `PRESET_STUDIO_PREVIEW_ORIGIN` 的请求只允许 `GET/HEAD /preview-runtime`、固定版本的 `/preview-assets/*`，以及 SPreset 引导所需的固定兼容入口 `/version`、`/script.js`、`/scripts/openai.js`；所有 `/api/*` 和其他路径均返回 `404`。Preview 响应不发送 `X-Frame-Options: SAMEORIGIN`，而使用 `frame-ancestors` 限制为 `PRESET_STUDIO_PREVIEW_PARENT_ORIGINS`。固定资源包括 jQuery、Lodash、js-yaml、Showdown、Toastr、Zod 和用于模板求值的 EJS `3.1.10`；两个模块入口只提供最小 ST 1.18 模块外形，不提供真实生成能力。

服务级开关关闭时也必须保留 `PRESET_STUDIO_PREVIEW_ORIGIN` 的 Host 路由：该 Host 的运行时、固定资源、`/api/*` 和任意其他路径全部返回 `404`，绝不能回落到 Studio 静态站点或 API。恢复开关不修改项目内的 `manifest.preview.javascriptEnabled`。反向代理应始终把两个域名的原始 `Host` 转发给同一 Node 服务。

Prompt/EJS 使用一次性 `sandbox="allow-scripts"` 子 frame 求值，不授予 `allow-same-origin`；其变量写入经过 Preview Host 的结构化消息回到内存 Preview State。消息链路顺序为“正则替换 → EJS → HTML 消息 frame”，Prompt `content.md` 则把 EJS 结果作为转义文本显示。EJS include 和 Prompt Template 扩展会返回明确的 capability 诊断，不会退回 Studio 或 Node 中执行。

Inspector 的“模拟生成管线”通过 `generation:simulate` 请求在 Preview Host 内近似组装 Chat Completion 消息，触发组合前后、prompt ready、`GENERATE_AFTER_DATA` 和发送设置事件，并把生成期 EJS 及监听器修改后的消息/设置快照经 `generation-status` 返回。它不访问模型 API、不写回聊天；为便于检查发送前插件，Studio 的 dry-run 会额外预演 `CHAT_COMPLETION_SETTINGS_READY`，因此监听器自身的网络或存储副作用仍会真实发生。

项目脚本小于 512 KiB 时直接发送；达到阈值后按约 256 KiB 源码片段编码，每块通过可转移 `ArrayBuffer` 发送，并等待 Preview Host ack 后再继续。Host 限制单块不超过 1 MiB、总块数不超过 128、单脚本不超过 16 MiB，并在 commit 前验证顺序、总字节数、UTF-8 和 SHA-256。停止、重启或传输失败会取消未完成传输。

Inspector 的“清空存储”通过同一 MessageChannel 请求 Preview Host 先销毁运行 frame，再清理该 Origin 的 localStorage、sessionStorage、IndexedDB 和 Cache Storage。此操作需要用户确认，不会自动执行，也不能撤销已完成的外部请求。

本机默认通过 `http://127.0.0.1:3001` 打开 Studio，并把 `http://localhost:3001` 留给 Preview Host。若从 LAN、HTTPS 域名或反向代理访问，`localhost` 会指向浏览器所在设备，必须把 Preview Origin 配成可从该浏览器访问的独立子域/端口，并把实际 Studio Origin 加入 parent 列表。不要把 Preview Origin 加入 `PRESET_STUDIO_ALLOWED_ORIGINS`，也不要给它代理 `/api`。

## REST API

### SillyTavern 会话与 presets

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/api/st/session` | 读取当前浏览器对应的内存 ST 会话摘要 |
| POST | `/api/st/session` | 验证目标、登录 ST 并创建/替换当前会话 |
| DELETE | `/api/st/session` | 删除当前会话，成功返回 `204` |
| POST | `/api/st/session/check` | 主动检查当前会话和 ST 兼容性 |
| GET | `/api/st/presets` | 列出 Chat Completion presets |
| POST | `/api/st/presets/read` | 读取 `{name}` 指定的完整 preset |
| POST | `/api/projects/create-from-st` | 从 `{presetName,name?,version?}` 创建一次性工程快照 |
| POST | `/api/projects/:projectId/push-preview` | 构建并预检 `{targetName,mode}`，其中 mode 为 `create` 或 `overwrite` |
| POST | `/api/projects/:projectId/push-preset` | 使用 `{previewToken}` 提交一次手动保存 |

创建会话请求：

```json
{
  "origin": "http://127.0.0.1:8000",
  "basicAuth": { "username": "可选", "password": "可选" },
  "accountAuth": { "handle": "可选", "password": "可选" }
}
```

`basicAuth` 用于 ST 启动时的 HTTP Basic Authentication；`accountAuth` 用于 ST 多用户登录。只提交目标实际需要的认证方式。成功返回 `{ "session": SessionInfo }`。读取接口返回 `{ "session": null }` 或同一摘要；`SessionInfo` 只包含：

```text
status, origin, version, branch?, userHandle?, authModes,
compatibility, capabilities, connectedAt, lastCheckedAt, targetPolicy
```

其中 `status` 为 `connected | unreachable | expired | unsupported`，`compatibility` 为 `supported | untested`，`authModes` 只会包含 `basic`/`account`，当前 capabilities 为 `preset.list`、`preset.read`、`preset.save`。

响应不会包含密码、Basic Authorization、ST Cookie 或 CSRF Token。Node 用 256-bit 随机标识在浏览器设置 `preset_studio_st_session` Cookie；它是 `HttpOnly`、`SameSite=Strict`、`Path=/api` 的会话 Cookie，在 HTTPS 下同时设置 `Secure`，不会存入浏览器 localStorage。

### ST 内部请求流程

Node 对 SillyTavern 1.18.x 使用以下服务端流程：

1. 校验并规范化目标 Origin，应用 target policy。
2. `GET /csrf-token`，在内存 Cookie jar 中接收 ST session Cookie，并取得 CSRF Token。
3. 如提供 `accountAuth`，调用 `POST /api/users/login`，body 为 `{handle,password}`；Basic 凭据按需附在每次 ST 请求上。
4. 再取得有效 CSRF Token，通过 `GET /version` 和 `POST /api/ping?extend=true` 检查版本/会话。
5. 目录或读取请求调用 `POST /api/settings/get`，从 `settings`、`openai_setting_names` 与 `openai_settings` 建立 Chat Completion preset 结果。
6. 手动提交时调用 `POST /api/presets/save`，body 为 `{apiId:"openai",name,preset}`。

Node 不读取 ST secret store 中的 LLM API Key，不调用 LLM，也不使用 `/api/settings/save` 覆盖整份设置。

Preset 目录响应为：

```json
{
  "presets": [{ "name": "My preset", "revision": "sha256", "size": 1234 }],
  "persistedSelectedPresetName": "My preset",
  "refreshedAt": "2026-08-16T12:00:00.000Z"
}
```

`persistedSelectedPresetName` 来自 ST 持久 settings，只用于提示，不等同于任一已打开标签页的实时选择。读取响应为 `{name,revision,size,preset}`；从 ST 创建工程返回 `{project,source:{presetName}}`，不建立后续同步。

### 会话和凭据生命周期

- 浏览器只持有 Preset Studio 的 opaque Cookie；ST Cookie/CSRF、Basic 凭据和必要的连接元数据只存在于 Node 内存。
- 账号密码只用于建立 ST 登录会话，不写磁盘、不写日志、不放入工程或浏览器持久存储。
- 服务重启、主动断开、会话 Cookie 丢失或空闲超时都会终止连接，需要重新输入目标和必要凭据。
- 单活动会话按浏览器 Cookie 隔离；API 不暴露 `connectionId`，也不提供持久连接档案。

### 推送预览与提交

`push-preview` 会先强制使用已落盘的工程构建结果，读取目标 ST preset，并根据 `mode` 校验目标：

- `create`：目标必须不存在，避免静默覆盖。
- `overwrite`：目标必须存在；预览返回远端/构建 revision、体积和总体 change，不声称提供字段级 diff。

预览成功后返回一个 256-bit 随机 token。token 仅在 Node 内存保存，默认 5 分钟有效，并绑定当前 ST 会话、projectId、targetName、mode、工程构建 revision/hash 和远端目标 hash。每次 `push-preset` 尝试都会先消费 token，包括远端请求失败的情况；工程、远端目标或会话变化后必须重新预览。这样确认动作不能被复用到另一份内容或另一个目标。

预览响应包含：

```json
{
  "previewToken": "opaque-secret",
  "expiresAt": "2026-08-16T12:05:00.000Z",
  "target": { "name": "Target", "exists": true, "revision": "sha256", "size": 1234 },
  "build": {
    "projectRevision": "manifest-updatedAt",
    "revision": "sha256",
    "size": 1234,
    "diagnostics": []
  },
  "change": "changed",
  "canCommit": true
}
```

提交成功响应为 `{presetName,revision,savedAt,outcome,requiresStReload:true,stUrl}`，其中 `outcome` 是 `created | overwritten | unchanged`。

保存成功只表示远端 `/api/presets/save` 已完成。官方服务端 REST API 不会控制已经打开的 ST 浏览器页面，因此该操作不会热切换/应用 preset。用户必须在 ST 中刷新 preset 列表并手动选择目标，再执行真实生成或 JavaScript/DOM 测试。

### 工程 API

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务和工作区状态 |
| GET | `/api/projects` | 工程摘要列表 |
| POST | `/api/projects` | 新建空白工程，body 为 `{name?,version?}` |
| POST | `/api/projects/import/json` | 从 preset 创建工程 |
| POST | `/api/projects/import/archive` | 上传 Preset Studio ZIP 工程包 |
| GET | `/api/projects/:id` | 读取 manifest |
| PATCH | `/api/projects/:id` | 使用 `ifProjectRevision` 更新名称、版本和默认 ST 目标 |
| DELETE | `/api/projects/:id` | 永久删除服务器工程 |
| GET | `/api/projects/:id/archive` | 下载完整 ZIP 工程包 |
| GET | `/api/projects/:id/files` | 读取扁平文件树 |
| GET | `/api/projects/:id/files/*` | 读取 UTF-8 文件内容和 revision |
| PUT | `/api/projects/:id/files/*` | 原子保存 `{content,ifRevision?}` |
| GET/PUT | `/api/projects/:id/source-json` | 读取或显式应用完整 `preset.json` |
| GET | `/api/projects/:id/structure` | 一次读取三类条目摘要和 Prompt Order |
| POST | `/api/projects/:id/structure/mutations` | 带 `ifRevision` 的原子结构变更 |
| GET/POST | `/api/projects/:id/snapshots` | 列出或创建手动快照 |
| POST | `/api/projects/:id/snapshots/:snapshotId/restore` | 恢复快照并先自动备份当前状态 |
| DELETE | `/api/projects/:id/snapshots/:snapshotId` | 永久删除单个快照 |
| POST | `/api/projects/:id/build` | 构建 JSON；`validateOnly` 时只返回摘要和诊断 |
| POST | `/api/projects/:id/export` | 构建并写入 output，返回下载地址 |
| GET | `/api/projects/:id/outputs` | 导出文件列表 |
| GET | `/api/projects/:id/outputs/:filename` | 下载导出 JSON |

JSON 导入主格式是 `{ "name":"工程名", "version":"可选版本", "preset":{} }`。它也支持 `multipart/form-data`，文件字段名为 `file`，并可提交 `name`、`version` 和 `sourcePresetName`；直接发送 preset 时可用 `X-Project-Name`、`X-Project-Version` 提供工程信息。

错误统一返回：

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Project file changed since it was opened",
    "details": {}
  }
}
```

ST 直连的主要错误类别：

- `ST_TARGET_INVALID` / `ST_TARGET_NOT_ALLOWED`：URL 或 target policy 拒绝。
- `ST_BASIC_AUTH_REQUIRED|FAILED`、`ST_ACCOUNT_AUTH_REQUIRED|FAILED`、`ST_SESSION_REQUIRED|EXPIRED`：需要重新提供对应认证或重连。
- `ST_VERSION_UNSUPPORTED`、`ST_ENDPOINT_UNAVAILABLE`、`ST_RESPONSE_INVALID`：ST 版本或 wire contract 不兼容。
- `ST_PRESET_NOT_FOUND`、`ST_PRESET_TARGET_EXISTS`、`ST_PRESET_CONFLICT`：读取/目标存在性或远端 revision 冲突。
- `ST_PREVIEW_INVALID|EXPIRED|NOT_COMMITTABLE`、`ST_PROJECT_CHANGED`：必须重新生成推送预览。
- `ST_DNS_FAILED`、`ST_TLS_ERROR`、`ST_UNREACHABLE`、`ST_CONNECT_TIMEOUT`、`ST_TIMEOUT`、`ST_REDIRECT_REJECTED`、`ST_RESPONSE_TOO_LARGE`：目标网络或响应边界错误。
- `ST_SAVE_VERIFY_FAILED`：ST 返回保存成功但重新读取的 revision 不一致。

## ZIP 工程包

上传接口接受 `multipart/form-data`、`application/zip` 或 `application/octet-stream`。ZIP 根目录必须直接包含 `project.json`，不能多包一层目录。服务端始终生成新项目 ID，并把来源设为 `project-package`，不会信任或复用包内 ID。

导入先解压到工作区内随机 staging 目录，完整验证 manifest、受管索引和构建结果后，才通过同文件系统目录重命名提交。安全检查包括：

- 拒绝绝对路径、`..`、反斜杠路径、Windows 设备名和非法文件名。
- 拒绝大小写或 Unicode 归一化后碰撞的重复路径。
- 拒绝文件/目录父子冲突；只创建普通文件，不恢复符号链接。
- 限制压缩大小、解压总大小、单文件大小和条目数。
- 要求根 `project.json` 为 schema 2，并验证所有受管拆分文件能够重新构建 preset。

下载接口返回 `application/zip` 和 RFC 5987 `Content-Disposition` 文件名。工程包包含 manifest、拆分源码、snapshot、recovery、output 和其他普通工程文件，不包含符号链接或原子写入临时文件。

## 工程格式

导入器生成 `project.json`、`preset.settings.json`、`preset.prompt-fields.json`、`extensions/`、`prompts/`、`regex/`、`scripts/`、`snapshots/`、`recovery/` 和 `output/`。

- Prompt 元数据和正文分别保存为 `meta.json`、`content.md`。
- Regex 元数据、查找式和替换 HTML 分别保存为 `meta.json`、`find.txt`、`replace.html`。
- Tavern Helper 脚本元数据和源码分别保存为 `meta.json`、`content.js`。
- `preset.settings.json` 保存请求参数、基本配置以及未由专用编辑器管理的顶层字段，不包含 `extensions`。
- `preset.prompt-fields.json` 保存 `impersonation_prompt`、`new_chat_prompt`、`wi_format` 等顶层提示词与标签字段。
- `extensions/ext-<base64url(extension-key)>.json` 每个文件直接对应完整预设中的一个 `extensions[extensionKey]`。
- 示例中的三个一致 Regex 镜像被识别为一个逻辑集合，构建时写回三个目标。
- 冲突的 Regex 镜像不会静默合并，而会完整保留在对应的扩展配置文件中。
- `snapshots/index.json` 记录手动和自动快照；自动快照最多保留最近 20 个，手动快照不自动清理。

结构 mutation 只接受一次单操作，并在工程锁内复制受管源码到 `.staging`、执行变更、完整构建验证、按需创建快照，最后通过带回滚的目录交换提交。名称不参与物理路径拼接；属性表单只 patch 白名单字段，未知 `meta.json` 字段保持不变。

写文件使用同目录临时文件、`fsync` 和 `rename`；manifest 最后提交。文件 API 拒绝绝对路径、父目录跳转、NUL 和符号链接逃逸。`ifRevision` 使用 SHA-256 做乐观并发控制。

## 测试

```bash
pnpm --dir server test
```

自动测试应覆盖工程语义 round-trip、未知字段、Regex 镜像、脚本拆分、原子保存、revision 冲突、路径与 ZIP 安全、工程包往返、multipart 上传、Origin/CORS 和 health 隐私，以及 ST target policy、CSRF/Cookie jar、Basic/账号认证、会话隔离与过期、preset 目录/读取、从 ST 创建工程、推送 preview token 绑定/过期/单次消费、远端冲突、超时、响应限额和敏感字段不回显。

真实 ST 1.18.x 手动验收至少包括：

1. 无认证、本机 ST 建立/检查/断开会话。
2. Basic Authentication、多用户登录及两者组合。
3. Docker 容器按白名单或 `private` 策略连接 LAN 中的 ST。
4. 列出 preset、读取指定 preset，并从它创建一次性工程快照。
5. `create` 拒绝已有目标，`overwrite` 拒绝缺失目标；工程或远端变化使旧 preview token 失效。
6. 提交后 ST 磁盘中出现/更新 preset；刷新 ST 页面并手动选择后内容正确。
7. 错误密码、CSRF 失效、ST 停止、超时和超大响应给出可操作错误，日志不包含密码、Authorization、Cookie、CSRF 或完整 preset。

容器内的 `127.0.0.1` 是容器本身。ST 运行在宿主机时，应使用容器可达的 LAN 地址；Docker Desktop 可使用 `host.docker.internal`，Linux 可使用宿主机 LAN 地址或由部署者显式配置 `host-gateway`。无论采用哪种地址，都要配置精确 Origin 白名单或 `private` 策略。

## Docker 健康检查与工作区权限

镜像和 Compose 使用 `/api/health`。响应包含 `{ "ok":true, "previewRuntime":{...} }`，其中 `previewRuntime` 用于告诉前端独立预览 Host 是否启用及其 Origin。仅当 `PRESET_STUDIO_EXPOSE_WORKSPACE_PATH=true` 时才额外返回工作区绝对路径。

容器使用非 root UID/GID，Compose 默认 `1000:1000`，移除 Linux capabilities 并启用 `no-new-privileges`。bind mount 目录必须允许该 UID/GID 读写；若宿主机使用其他所有者，可在 `.env` 配置 `PRESET_STUDIO_UID`、`PRESET_STUDIO_GID`。工程写入容器 `/app/workspace-data`，由 `PRESET_STUDIO_WORKSPACE_HOST` 映射到宿主机。

## 直接部署构建产物

`dist/` 只包含前端静态资源，单独部署它只能显示 UI，不能保存工程或连接 ST。完整部署必须同时包含：

```text
dist/
server/dist/
server/package.json
server/node_modules/
```

随后设置 `PRESET_STUDIO_STATIC_ROOT` 和 `PRESET_STUDIO_WORKSPACE`，运行 `node server/dist/index.js`。若前端静态文件与 API 分离托管，必须由 UI Origin 同源反向代理 `/api`；单独配置 CORS 不能满足 ST 会话 Cookie 的安全约束。
