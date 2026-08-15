# Preset Studio Bridge（SillyTavern UI 扩展）

这个扩展把正在运行的 SillyTavern 与 Preset Studio 后端连接起来。Preset Studio 可以通过一次性配对读取当前 **Chat Completion preset** 的完整 JSON；模型请求、API Key 和账号会话仍完全由 SillyTavern 管理。

> 当前目录是主工程的一部分，不是可由 SillyTavern“从 Git URL 安装”的独立扩展仓库。第一版请按下面的方式手动复制或建立开发链接。

## 兼容性与官方依据

实现按 SillyTavern 最新稳定版 **1.18.0**（release commit `51ad27f`）核对，扩展 manifest 要求最低客户端版本也是 `1.18.0`。

- [官方 UI Extensions 文档](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [SillyTavern 1.18.0 release](https://github.com/SillyTavern/SillyTavern/releases/tag/1.18.0)
- [官方 `SillyTavern.getContext()` 实现](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)
- [官方 Preset Manager 实现](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/preset-manager.js)
- [官方 Chat Completion preset 导出实现](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/openai.js)

读取预设时优先调用官方上下文 API：

1. `SillyTavern.getContext().getPresetManager('openai')`
2. `manager.getSelectedPresetName()`
3. `manager.getCompletionPresetByName(name)`
4. 复制并验证为可序列化 JSON 后，返回 `{ name, preset }`

这与 SillyTavern 自身导出“已保存预设”的语义一致。只有 SillyTavern 当前主 API 为 `openai`（即 Chat Completion）时才允许拉取，避免在 Text Completion 模式误取上一次使用的 Chat Completion preset。若你刚在 SillyTavern 中改了设置，请先在 SillyTavern 保存该预设，再从 Studio 拉取。兼容适配器仅在上述管理器 API 不可用时读取官方上下文中的 `chatCompletionSettings`，不会查询内部 DOM。

## 手动安装（当前用户）

1. 停止 SillyTavern，或准备在复制后刷新页面。
2. 在 SillyTavern 数据目录中创建：

   ```text
   SillyTavern/data/<user-handle>/extensions/preset-studio-bridge/
   ```

3. 把本目录里的 `manifest.json`、`index.js`、`style.css` 和 `README.md` 复制进去。
4. 启动或刷新 SillyTavern，在“扩展”设置中找到 **Preset Studio Bridge**。

`<user-handle>` 是你实际的 SillyTavern 用户数据目录名；它不是登录密码。

## 开发安装（所有用户）

官方开发挂载位置是 `public/scripts/extensions/third-party`。可以复制整个目录，也可以建立目录链接。

Linux / macOS：

```bash
ln -s /absolute/path/to/preset-studio/sillytavern-extension \
  /absolute/path/to/SillyTavern/public/scripts/extensions/third-party/preset-studio-bridge
```

Windows PowerShell（目录联接通常不要求开发者模式）：

```powershell
New-Item -ItemType Junction `
  -Path 'C:\path\to\SillyTavern\public\scripts\extensions\third-party\preset-studio-bridge' `
  -Target 'G:\path\to\preset-studio\sillytavern-extension'
```

刷新 SillyTavern 后即可加载变更。本工程不会自动执行上述复制或链接，也不会改动你的真实 SillyTavern 安装。

## 使用方法

1. 在 Preset Studio 的“连接 SillyTavern”界面生成一次性配对码。
2. 在 SillyTavern 的扩展设置中填写 Studio WebSocket 地址，默认形式为 `ws://<studio-host>:3001/bridge`。
3. 输入一次性配对码并点击“连接”。
4. 连接成功后，在 Studio 发起“从 ST 当前 preset 创建新工程”或刷新快照。

若 SillyTavern 页面通过 HTTPS 打开，浏览器会阻止明文 WebSocket，此时 Studio 必须提供 `wss://`。经反向代理部署时，还要让代理把 `/bridge` 的 WebSocket `Upgrade` 请求转发到 Studio 后端。

## 数据与安全边界

- 不访问 SillyTavern 的用户认证接口、API Key/secret 存储或 Cookie，也不会把这些信息作为 Bridge 设置。
- 持久设置中只保存 Studio WebSocket 地址。
- 一次性配对码只存在于当前页面输入框/内存中，服务端确认后立即清空。
- `resumeToken` 只存于当前标签页的 `sessionStorage`；若浏览器禁用它，则仅存内存。它不会写入工程、SillyTavern 扩展设置或长期存储。
- 握手上下文只发送可选的 `currentPresetName`、`characterName`、`chatId`、`personaName`、`mainApi`，不发送聊天正文或角色卡正文。
- 第一版只有 `preset.pull`（ST → Studio）。不会自动推送或改写 SillyTavern 中的预设。

`preset.pull` 按协议返回完整 preset。SillyTavern 允许用户把 `proxy_password`、`reverse_proxy`、`custom_include_headers` 等连接字段直接保存在 preset 中；如果当前 preset 包含这些字段，它们也属于完整快照并会发送给 Studio。若不希望它们进入工程，请先在 SillyTavern 的预设中移除。扩展不会读取单独保存在 SillyTavern secret store 中的供应商 API Key。

配对、协议版本、来源或会话凭据无效时，扩展会停止自动重连并提示重新配对。普通网络中断会指数退避重试，最长约 30 秒。

## Bridge v1 摘要

首包：

```json
{
  "type": "bridge.hello",
  "protocolVersion": 1,
  "pairingCode": "<一次性配对码，或改用 resumeToken>",
  "bridgeVersion": "0.1.0",
  "st": {
    "version": "1.18.0",
    "branch": "release",
    "url": "http://127.0.0.1:8000"
  },
  "capabilities": ["preset.pull"],
  "context": {
    "currentPresetName": "当前预设名",
    "characterName": "当前角色名",
    "chatId": "当前聊天 ID",
    "personaName": "当前 Persona 名",
    "mainApi": "openai"
  }
}
```

`pairingCode` 与 `resumeToken` 严格二选一。服务端 RPC `preset.pull` 成功响应为：

```json
{
  "type": "rpc.response",
  "id": "request-id",
  "ok": true,
  "result": {
    "name": "当前预设名",
    "preset": {}
  }
}
```

## 静态校验

扩展不需要 npm 依赖。仓库根目录可运行：

```bash
node --check sillytavern-extension/index.js
node -e "JSON.parse(require('node:fs').readFileSync('sillytavern-extension/manifest.json', 'utf8'))"
```
