# SillyTavern Preset Studio

面向 SillyTavern Chat Completion preset 的可视化工程工作台。当前实现把原生 preset JSON 拆成可维护的多文件工程，在服务端工作区自动保存，最终再构建并导出语义一致的 JSON。

## 当前已实现

- 导入 Chat Completion preset JSON、导入/下载工程 ZIP、创建空白工程和多工程切换。
- Prompt、Regex、Tavern Helper 脚本及未知字段的拆分保存与重建。
- 桌面/横屏平板使用 Monaco；手机使用 CodeMirror 6。
- 850ms 防抖自动保存，切换文件、编辑器失焦、构建与导出前强制写盘。
- Revision 乐观并发控制、原子文件写入、路径穿越与符号链接逃逸防护。
- HTML/CSS 静态预览；iframe 不含 `allow-scripts`，项目 JavaScript 不在工具内执行。
- 构建、带版本与时间戳的 JSON 导出，以及工程工作区持久化。
- 工程 ZIP 导入始终生成新 ID，经过 Zip Slip、路径碰撞、大小/条目限制和完整构建校验后才提交。
- Bridge v1 一次性配对、版本/能力握手、心跳与会话内恢复；未连接真实 ST 时不会进入完整工作台。
- 可安装的 ST 1.18.0 UI Extension，以及“从 ST 当前 Chat Completion preset 创建工程”的单向快照流程。
- Docker Compose 单容器部署，工作区通过 volume/bind mount 持久化。

手动推送到 ST、角色/世界书/聊天/Persona 快照、最终 Prompt/token/DOM 捕获、Prompt/Regex 结构化工作台与 PWA 仍属于后续阶段。相关入口会如实显示“尚未实现”，不会用模拟结果冒充真实 ST 运行数据。

## 连接 SillyTavern

1. 打开 Preset Studio，在连接门禁中下载 `preset-studio-bridge.zip` 并生成一次性配对码。
2. 将 ZIP 中的 `preset-studio-bridge/` 安装到 ST 当前用户的 `data/<user-handle>/extensions/`，或按 [扩展安装说明](./sillytavern-extension/README.md) 使用开发目录链接。
3. 刷新 ST 1.18.0，在扩展设置中填写 Studio 显示的 WebSocket URL 与配对码，然后连接。
4. 回到 Studio，在项目管理中选择“从 ST 当前 preset 创建工程”。当前只支持 ST 正在使用 Chat Completion API 的情况。

开发目录里的扩展不会自动安装到真实 ST；`GET /api/st/extension/archive` 只提供下载包，不执行远程安装或修改 ST。

Bridge 不访问 ST 登录凭据、Cookie、CSRF Token 或 secrets/API Key 存储。但它按要求拉取完整 preset：若 preset 自身保存了 `proxy_password`、`reverse_proxy`、`custom_include_headers` 或其他敏感连接字段，这些值会进入工程目录、工程 ZIP 和导出 JSON。请将这些产物按敏感配置管理。

## 本地开发

要求 Node.js 22.18+ 与 pnpm 10。

```bash
pnpm install
pnpm --dir server install
pnpm dev
```

`pnpm dev` 会同时启动 Vite 前端和 Node 工程服务。Vite 默认尝试 `4173`，端口占用时会自动选择下一个端口；API 默认监听 `127.0.0.1:3001`，前端通过 `/api` 代理访问。

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

默认访问地址为 `http://127.0.0.1:3001`，工程写入仓库下的 `workspace-data/`。可先复制 `.env.example` 并修改映射路径：

```dotenv
PRESET_STUDIO_WORKSPACE_HOST=./workspace-data
PRESET_STUDIO_BIND=127.0.0.1
PRESET_STUDIO_PORT=3001
```

第一版没有账号、登录或鉴权。需要从手机访问时，可以把 `PRESET_STUDIO_BIND` 改为 `0.0.0.0`，但只能在可信局域网/VPN中使用，不能直接暴露到公网。

## 工程数据

默认工作区是 `workspace-data/`。每个工程具有独立目录，核心结构包括：

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

文件名使用工具生成的稳定 UID，原始 identifier、显示名、顺序与未知字段都保留在元数据和 manifest 中。无损定义为 JSON 语义一致，而不是字节、缩进或属性顺序一致。

工程格式和设计边界详见 [实施方案](./SillyTavern预设开发工具-实施方案.md)，界面规范见 [UI 设计说明](./SillyTavern预设开发工具-UI设计说明.md)，后端协议见 [server/README.md](./server/README.md)。
