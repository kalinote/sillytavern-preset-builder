# Preset Studio 工程后端

第一版工程内核使用 Node.js 原生 HTTP、WebSocket 与文件系统 API，不依赖数据库。ZIP 工程包使用无传递依赖的 `fflate`，SillyTavern Bridge 使用 `ws`。工程根目录由 `PRESET_STUDIO_WORKSPACE` 指定；未设置时使用仓库根目录下的 `workspace-data/`。

## 启动

~~~bash
pnpm --dir server install
pnpm --dir server dev
~~~

默认只监听 `127.0.0.1:3001`。第一版没有鉴权，不会在裸 Node 启动时默认暴露到局域网；Docker 部署应显式设置 `HOST=0.0.0.0`。生产构建与启动：

~~~bash
pnpm --dir server build
pnpm --dir server start
~~~

可用环境变量：

- `PORT`：HTTP 端口，默认 `3001`。
- `HOST`：监听地址，默认 `127.0.0.1`。
- `PRESET_STUDIO_WORKSPACE`：工程工作区绝对或相对路径。
- `PRESET_STUDIO_BODY_LIMIT_MIB`：请求体上限，默认 `64` MiB。
- `PRESET_STUDIO_STATIC_ROOT`：生产前端目录；默认自动寻找仓库根目录的 `dist/`。
- `PRESET_STUDIO_ZIP_MAX_MIB`：ZIP 压缩体积上限，默认 `64` MiB。
- `PRESET_STUDIO_ZIP_UNPACKED_MIB`：ZIP 解压总大小上限，默认 `256` MiB。
- `PRESET_STUDIO_ZIP_FILE_MIB`：ZIP 单文件解压大小上限，默认 `128` MiB。
- `PRESET_STUDIO_ZIP_MAX_ENTRIES`：ZIP 文件和目录条目上限，默认 `10000`。
- `PRESET_STUDIO_ALLOWED_ORIGINS`：允许直接跨源访问 API 的 HTTP(S) Origin，多个值用英文逗号分隔；默认空，仅允许同源浏览器请求。
- `PRESET_STUDIO_EXPOSE_WORKSPACE_PATH`：设为 `true` 时才在 `/api/health` 返回工作区绝对路径，默认 `false`。
- `PRESET_STUDIO_PAIRING_TTL_SECONDS`：Bridge 一次性配对码有效期，默认 `300` 秒。
- `PRESET_STUDIO_BRIDGE_RESUME_TTL_SECONDS`：Bridge 断线后可恢复时长，默认 `1800` 秒。
- `PRESET_STUDIO_BRIDGE_HELLO_TIMEOUT_SECONDS`：WebSocket 首包等待时间，默认 `10` 秒。
- `PRESET_STUDIO_BRIDGE_HEARTBEAT_SECONDS`：Bridge JSON 心跳间隔，默认 `15` 秒。
- `PRESET_STUDIO_BRIDGE_HEARTBEAT_TIMEOUT_SECONDS`：无有效 pong 的断线判定时间，默认 `45` 秒。
- `PRESET_STUDIO_BRIDGE_RPC_TIMEOUT_SECONDS`：`preset.pull` 调用超时，默认 `30` 秒。
- `PRESET_STUDIO_BRIDGE_MAX_MESSAGE_MIB`：单条 WebSocket 消息上限，默认 `32` MiB。

生产依赖 `fflate` 与 `ws`；开发阶段另需 `tsx`、`typescript`、`@types/node` 与 `@types/ws`，均已列在 `server/package.json`。容器运行编译后的 `server/dist` 时也必须复制生产 `server/node_modules`，不能只复制 JavaScript 输出。

## Origin 与本地访问边界

服务端默认不发送通配 CORS，也不会回显任意 Origin：

- 没有 `Origin` 的 CLI、Docker healthcheck 和服务间请求保持可用。
- 浏览器直接访问生产服务时，只允许与有效请求 Host/Protocol 相同的 Origin。
- Vite 或同源反向代理转发时，浏览器的 `Sec-Fetch-Site: same-origin` 可证明该请求对浏览器仍是同源；因此使用 `/api` 代理的 4173/4174 开发页面不需要额外 CORS 配置。
- 必须从另一个 Origin 直接请求 API 时，应精确配置 `PRESET_STUDIO_ALLOWED_ORIGINS`，例如：

~~~text
PRESET_STUDIO_ALLOWED_ORIGINS=http://localhost:4174,https://studio.example.com
~~~

- 不可信 Origin 的普通请求、非简单请求和 preflight 均返回 `403 ORIGIN_NOT_ALLOWED`。不支持 `*`、路径、用户信息或非 HTTP(S) Origin。
- 反向代理终止 HTTPS 时应保留原始 `Host` 并设置 `X-Forwarded-Proto: https`；否则应显式配置外部 Origin。

Origin 校验是本地无鉴权版本的浏览器侧最低边界，不等同于账号认证。服务仍不应直接暴露公网。

## API

| 方法 | 路由 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务和工作区状态 |
| POST | `/api/st/pairing` | 生成一次性 Bridge 配对码 |
| GET | `/api/st/extension/archive` | 下载可手动安装的 Bridge 扩展 ZIP |
| GET | `/api/st/connections` | 读取当前及短时可恢复的 ST 连接 |
| GET | `/api/projects` | 工程摘要列表 |
| POST | `/api/projects` | 新建空白工程，body 为 `{name?, version?}` |
| POST | `/api/projects/create-from-st` | 从指定 ST 连接拉取当前 preset 并创建工程 |
| POST | `/api/projects/import/json` | 从 preset 创建工程 |
| POST | `/api/projects/import/archive` | 上传 Preset Studio ZIP 工程包 |
| GET | `/api/projects/:id` | 读取 manifest |
| GET | `/api/projects/:id/archive` | 下载完整 ZIP 工程包 |
| GET | `/api/projects/:id/files` | 读取扁平文件树 |
| GET | `/api/projects/:id/files/*` | 读取 UTF-8 文件内容和 revision |
| PUT | `/api/projects/:id/files/*` | 原子保存 `{content, ifRevision?}` |
| POST | `/api/projects/:id/build` | 在内存中构建 JSON，不写 output |
| POST | `/api/projects/:id/export` | 构建并写入 output，返回下载地址 |
| GET | `/api/projects/:id/outputs` | 导出文件列表 |
| GET | `/api/projects/:id/outputs/:filename` | 下载导出 JSON |

JSON 导入的主格式是：

~~~json
{
  "name": "工程名",
  "version": "可选版本",
  "preset": {}
}
~~~

同时兼容 `multipart/form-data`：文件字段名为 `file`，另可提交 `name`、`version` 和 `sourcePresetName`；也兼容直接以 preset 作为请求体并通过 `X-Project-Name`、`X-Project-Version` 提供工程信息。

### ZIP 工程包

上传使用：

~~~text
POST /api/projects/import/archive
Content-Type: multipart/form-data

file=<project.zip>
name=<可选覆盖工程名>
version=<可选覆盖版本>
~~~

也可以直接发送 `application/zip` 或 `application/octet-stream`，并通过 `X-Project-Name`、`X-Project-Version` 提供覆盖值。成功返回：

~~~json
{
  "project": {},
  "import": {
    "originalProjectId": "project-old-id",
    "idRegenerated": true
  }
}
~~~

工程包根目录必须直接包含 `project.json`，不能多包一层目录。服务端永远生成新的项目 ID，并将来源设为 `project-package`；即使工作区中不存在 ID 冲突，也不会信任或复用包内 ID，因此不会覆盖已有工程。

下载接口返回 `application/zip` 和 RFC 5987 `Content-Disposition` 附件文件名。工程包包含 manifest、拆分源码、快照、recovery、output 和其他工程内文件；符号链接和原子写入遗留的临时文件不会进入包中。

ZIP 导入先解压到工作区内的随机 staging 目录，完整验证 `project.json`、受管索引及构建结果后，才通过同文件系统目录重命名提交。失败时删除 staging，不留下可见的半成品工程。安全检查包括：

- 拒绝绝对路径、`..`、反斜杠路径、Windows 设备名和非法文件名。
- 拒绝大小写或 Unicode 归一化后碰撞的重复路径。
- 拒绝文件与目录父子冲突；解压始终创建普通文件，不恢复符号链接。
- 限制压缩大小、解压总大小、单文件大小和文件/目录条目数。
- 要求根 `project.json` 为 schema 1，并验证所有受管拆分文件可以重新构建 preset。

错误统一返回：

~~~json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Project file changed since it was opened",
    "details": {}
  }
}
~~~

## SillyTavern Bridge v1

Bridge 只负责把已运行的 SillyTavern 当前 preset 一次性拉入工程；配对码、恢复令牌、连接状态和待处理 RPC 全部只保存在服务端内存中，重启即失效。Bridge 不访问 SillyTavern 的登录凭据、Cookie、secret/API Key 存储，也不会把这些会话信息写入 Studio。

不过，`preset.pull` 为保证语义一致会传输完整 preset。SillyTavern 允许用户把 `proxy_password`、`reverse_proxy`、`custom_include_headers` 等连接信息直接保存在 preset 内；未知扩展字段也可能包含敏感内容。这些字段属于 preset 本身，会被保留到工程、快照、导出 JSON 和工程 ZIP 中。Studio 不会自动脱敏，用户应保护工作区和下载的工程文件；独立保存在 ST secret store 中的供应商 API Key 不会被读取。

### 扩展下载与手动安装

~~~text
GET /api/st/extension/archive
~~~

成功时返回 `application/zip`、`Cache-Control: no-store` 和附件文件名 `preset-studio-bridge.zip`。ZIP 顶层固定为 `preset-studio-bridge/`，且只包含经过白名单固定的 `manifest.json`、`index.js`、`style.css`、`README.md`。服务端不接受文件名或目录参数；镜像中任一文件缺失时返回 `503 EXTENSION_ARCHIVE_UNAVAILABLE`，不会生成残缺安装包。

解压后，将整个 `preset-studio-bridge/` 目录复制到当前 ST 用户数据目录的 `data/<user-handle>/extensions/` 下，刷新 SillyTavern，然后在扩展设置中找到 **Preset Studio Bridge**。该包不是独立 Git 仓库，因此不能作为 SillyTavern 的“从 Git URL 安装”地址。

连接流程：

1. Studio 调用 `POST /api/st/pairing` 创建配对码。
2. 用户把配对码和 Studio 地址交给安装在 SillyTavern 中的 Bridge 扩展。
3. 扩展连接 `ws://<studio-host>/bridge`；若 Studio 使用 HTTPS，则必须使用 `wss://`。
4. 扩展用配对码发送 hello，收到 ack 后保存内存中的恢复令牌。
5. Studio 可从 `/api/st/connections` 选择连接，再调用 `/api/projects/create-from-st`。

配对响应为顶层对象，`expiresAt` 是 ISO 8601 时间：

~~~json
{
  "pairingCode": "96-bit-base64url",
  "expiresAt": "2026-08-15T12:00:00.000Z",
  "bridgePath": "/bridge"
}
~~~

WebSocket 首包必须恰好提供 `pairingCode` 或 `resumeToken` 之一：

~~~json
{
  "type": "bridge.hello",
  "protocolVersion": 1,
  "pairingCode": "96-bit-base64url",
  "bridgeVersion": "1.0.0",
  "st": {
    "version": "1.14.0",
    "branch": "release",
    "url": "http://127.0.0.1:8000/"
  },
  "capabilities": ["preset.pull"],
  "context": {
    "currentPresetName": "My preset",
    "characterName": "Alice",
    "chatId": "chat-id",
    "personaName": "Default"
  }
}
~~~

`context` 是可选的通用 JSON 对象；上述 key 是第一版建议值，不是必填 schema。若提供 `st.url`，其 Origin 必须与浏览器 WebSocket Upgrade 携带的 Origin 一致。服务端 ack 为：

~~~json
{
  "type": "bridge.ack",
  "connectionId": "uuid",
  "resumeToken": "256-bit-base64url",
  "heartbeatIntervalMs": 15000
}
~~~

恢复连接时以新的 hello 携带 `resumeToken`，并且必须来自原 Origin。每次 ack 都轮换令牌，旧令牌立即失效；恢复成功保留 `connectionId`。断开的连接会在恢复期限内以 `status: "disconnected"` 保留，连接列表按 `lastSeenAt` 降序返回：

~~~json
{
  "connections": [
    {
      "connectionId": "uuid",
      "status": "connected",
      "protocolVersion": 1,
      "bridgeVersion": "1.0.0",
      "st": { "version": "1.14.0" },
      "capabilities": ["preset.pull"],
      "context": { "currentPresetName": "My preset" },
      "connectedAt": "2026-08-15T11:00:00.000Z",
      "lastSeenAt": "2026-08-15T11:30:00.000Z",
      "resumableUntil": "2026-08-15T12:00:00.000Z"
    }
  ]
}
~~~

RPC 使用以下 envelope；第一版唯一方法是 `preset.pull`：

~~~json
{"type":"rpc.request","id":"uuid","method":"preset.pull","params":{}}
~~~

~~~json
{"type":"rpc.response","id":"uuid","ok":true,"result":{"name":"My preset","preset":{}}}
~~~

失败响应为 `{"type":"rpc.response","id":"uuid","ok":false,"error":{"code":"...","message":"...","details":{}}}`。心跳为 `{"type":"ping","timestamp":123}` / `{"type":"pong","timestamp":123}`。认证或协议失败时，服务端先发送 `{"type":"bridge.error","code":"...","message":"..."}`，再以 WebSocket policy close `1008` 关闭；服务端内部故障使用 `1011`。

从 ST 创建工程的请求与成功响应：

~~~json
{"connectionId":"uuid","name":"可选工程名","version":"可选版本"}
~~~

~~~json
{
  "project": {},
  "source": { "connectionId": "uuid", "presetName": "ST 中的 preset 名" }
}
~~~

该操作只拉取当次快照，不建立持续同步。未连接返回 `409 BRIDGE_DISCONNECTED`，RPC 中途断线返回 `503 BRIDGE_DISCONNECTED`，远端拒绝返回 `502 RPC_REMOTE_ERROR`，超时返回 `504 RPC_TIMEOUT`；都沿用统一 REST 错误 envelope。

Upgrade 只接受精确的 `/bridge` 路径、文本 JSON、有效的 HTTP(S) Origin 和受限消息大小；无 Origin 的 WebSocket 客户端会被拒绝。反向代理必须转发 WebSocket Upgrade 与原始 Origin。裸 Node 默认只监听回环地址；第一版无账号系统，配对机制不能替代公网访问控制，请勿把服务直接暴露到公网。

## 工程格式

导入器生成实施方案约定的 `project.json`、`preset.base.json`、`prompts/`、`regex/`、`scripts/`、`snapshots/`、`recovery/` 和 `output/`。

- Prompt 的元数据与正文分别保存为 `meta.json`、`content.md`。
- Regex 的元数据、查找式、替换 HTML 分别保存为 `meta.json`、`find.txt`、`replace.html`。
- Tavern Helper 脚本的元数据和源码分别保存为 `meta.json`、`content.js`。
- `preset.base.json` 保留所有不由专用编辑器管理的已知和未知字段。
- 示例采用的三个一致 Regex 镜像被识别为一个逻辑集合，构建时写回三个目标。
- 冲突的 Regex 镜像不会被静默合并，而是完整保留在 `preset.base.json`。

写文件使用同目录临时文件、`fsync` 和 `rename`；manifest 最后提交。文件 API 拒绝绝对路径、父目录跳转、NUL 和符号链接逃逸。`ifRevision` 使用 SHA-256 实现乐观并发控制。

## 测试

~~~bash
pnpm --dir server test
~~~

测试使用 `node:test` 和小型内存构造 fixture，不读取或复制仓库中的 8.8 MB 样本。覆盖语义 round-trip、未知字段、Regex 镜像、脚本拆分、原子保存、revision 冲突、普通路径穿越、ZIP Slip、ZIP 根 manifest、各项解压限额、工程包往返、ID 重生成、multipart HTTP 上传、ZIP 下载、同源/白名单/拒绝 Origin、preflight、health 隐私，以及 Bridge 扩展固定白名单打包/缺件错误、默认单位、一次性配对、hello/ack、Origin 拒绝、连接列表、ping/pong、preset RPC、工程往返、恢复令牌轮换、错误和 RPC 断线清理。

## Docker 健康检查与工作区权限

镜像和 Compose 都使用 `/api/health` 进行健康检查。该接口默认只返回：

~~~json
{"ok":true}
~~~

运行时使用非 root UID/GID，默认是 Node Alpine 的 `1000:1000`，并移除 Linux capabilities、启用 `no-new-privileges`。Compose 使用宿主机目录挂载工作区；Linux 主机必须确保该目录对运行 UID 可写：

~~~bash
mkdir -p workspace-data
sudo chown -R 1000:1000 workspace-data
docker compose up --build
~~~

如果宿主机用户不是 UID/GID 1000，可以在启动时匹配宿主机身份：

~~~bash
PRESET_STUDIO_UID=$(id -u) PRESET_STUDIO_GID=$(id -g) docker compose up --build
~~~

Windows/macOS Docker Desktop 通常由文件共享层处理 UID 映射。若显式挂载其他目录，仍需确认容器进程对其有创建目录、写临时文件和 rename 的权限。不要为了绕过权限问题把容器改回 root；应修正宿主目录所有权或配置 UID/GID。
