const MODULE_NAME = 'preset_studio_bridge';
const BRIDGE_VERSION = '0.1.0';
const PROTOCOL_VERSION = 1;
const CAPABILITIES = Object.freeze(['preset.pull']);
const SETTINGS_CONTAINER_SELECTOR = '#extensions_settings2';
const PANEL_ID = 'preset-studio-bridge-settings';
const SESSION_TOKEN_PREFIX = 'preset-studio-bridge:resume:';
const MAX_RECONNECT_DELAY_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 12_000;

const FATAL_BRIDGE_CODES = new Set([
    'HELLO_REQUIRED',
    'INVALID_HELLO',
    'PROTOCOL_VERSION_UNSUPPORTED',
    'PAIRING_CODE_REQUIRED',
    'PAIRING_CODE_INVALID',
    'PAIRING_CODE_EXPIRED',
    'RESUME_TOKEN_INVALID',
    'ORIGIN_MISMATCH',
    'MESSAGE_TOO_LARGE',
]);

const state = {
    context: null,
    ui: null,
    socket: null,
    socketGeneration: 0,
    auth: null,
    serverUrl: '',
    wantConnected: false,
    blocked: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    handshakeTimer: null,
    heartbeatTimer: null,
    heartbeatIntervalMs: 0,
    lastTrafficAt: 0,
    appReadyEvent: null,
    appReadyHandler: null,
    initTimer: null,
    initAttempts: 0,
};

const memoryResumeTokens = new Map();

function getContext() {
    const getStContext = globalThis.SillyTavern?.getContext;
    if (typeof getStContext !== 'function') {
        throw new BridgeRpcError('ST_CONTEXT_UNAVAILABLE', 'SillyTavern context API is unavailable.');
    }

    return getStContext();
}

function defaultServerUrl() {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${window.location.hostname}:3001/bridge`;
}

function normalizeServerUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new Error('请输入 Preset Studio 的 WebSocket 地址。');
    }

    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('WebSocket 地址格式无效。');
    }

    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('WebSocket 地址必须使用 ws:// 或 wss://。');
    }

    if (window.location.protocol === 'https:' && url.protocol !== 'wss:') {
        throw new Error('HTTPS 页面只能连接 wss:// 地址。');
    }

    url.hash = '';
    url.search = '';
    if (!url.pathname || url.pathname === '/') {
        url.pathname = '/bridge';
    }

    return url.toString().replace(/\/$/, '');
}

function ensureSettings(context) {
    if (!context.extensionSettings || typeof context.extensionSettings !== 'object') {
        throw new Error('SillyTavern extension settings API is unavailable.');
    }

    const existing = context.extensionSettings[MODULE_NAME];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        context.extensionSettings[MODULE_NAME] = {};
    }

    const settings = context.extensionSettings[MODULE_NAME];
    if (typeof settings.serverUrl !== 'string' || !settings.serverUrl.trim()) {
        settings.serverUrl = defaultServerUrl();
    }

    return settings;
}

function saveServerUrl(value) {
    const context = state.context ?? getContext();
    const settings = ensureSettings(context);
    if (settings.serverUrl === value) {
        return;
    }

    settings.serverUrl = value;
    context.saveSettingsDebounced?.();
}

function sessionTokenKey(serverUrl) {
    return `${SESSION_TOKEN_PREFIX}${serverUrl}`;
}

function getResumeToken(serverUrl) {
    const key = sessionTokenKey(serverUrl);
    try {
        const token = window.sessionStorage.getItem(key);
        if (token) {
            memoryResumeTokens.set(key, token);
            return token;
        }
    } catch (error) {
        console.debug(`[${MODULE_NAME}] sessionStorage is unavailable; using memory only.`, error);
    }

    return memoryResumeTokens.get(key) ?? null;
}

function setResumeToken(serverUrl, token) {
    const key = sessionTokenKey(serverUrl);
    memoryResumeTokens.set(key, token);
    try {
        window.sessionStorage.setItem(key, token);
    } catch (error) {
        console.debug(`[${MODULE_NAME}] Could not persist the session credential; using memory only.`, error);
    }
}

function clearResumeToken(serverUrl) {
    const key = sessionTokenKey(serverUrl);
    memoryResumeTokens.delete(key);
    try {
        window.sessionStorage.removeItem(key);
    } catch (error) {
        console.debug(`[${MODULE_NAME}] Could not clear sessionStorage.`, error);
    }
}

function mountSettingsUi() {
    if (document.getElementById(PANEL_ID)) {
        return document.getElementById(PANEL_ID);
    }

    const container = document.querySelector(SETTINGS_CONTAINER_SELECTOR);
    if (!container) {
        return null;
    }

    const panel = document.createElement('details');
    panel.id = PANEL_ID;
    panel.className = 'preset-studio-bridge';
    panel.open = true;
    panel.innerHTML = `
        <summary class="preset-studio-bridge__summary">
            <span class="preset-studio-bridge__title">Preset Studio Bridge</span>
            <span class="preset-studio-bridge__indicator" aria-hidden="true"></span>
        </summary>
        <div class="preset-studio-bridge__body">
            <p class="preset-studio-bridge__description">
                将当前 Chat Completion 预设按需发送给 Preset Studio。此扩展不会访问 SillyTavern 登录凭据、API Key 或 Cookie。
            </p>
            <label class="preset-studio-bridge__label" for="preset-studio-bridge-url">
                Studio WebSocket 地址
            </label>
            <input
                id="preset-studio-bridge-url"
                class="text_pole preset-studio-bridge__input"
                type="url"
                inputmode="url"
                autocomplete="url"
                autocapitalize="none"
                spellcheck="false"
                aria-describedby="preset-studio-bridge-url-help"
            >
            <small id="preset-studio-bridge-url-help" class="preset-studio-bridge__help">
                例如：ws://127.0.0.1:3001/bridge；HTTPS 下请使用 wss://。
            </small>

            <label class="preset-studio-bridge__label" for="preset-studio-bridge-code">
                一次性配对码
            </label>
            <input
                id="preset-studio-bridge-code"
                class="text_pole preset-studio-bridge__input"
                type="password"
                inputmode="text"
                autocomplete="one-time-code"
                autocapitalize="none"
                spellcheck="false"
                aria-describedby="preset-studio-bridge-code-help"
            >
            <small id="preset-studio-bridge-code-help" class="preset-studio-bridge__help">
                配对码不会写入 SillyTavern 设置；同一标签页重连时优先使用临时会话凭据。
            </small>

            <div class="preset-studio-bridge__actions">
                <button id="preset-studio-bridge-connect" class="menu_button" type="button">
                    连接
                </button>
                <button id="preset-studio-bridge-disconnect" class="menu_button" type="button" disabled>
                    断开
                </button>
            </div>
            <p
                id="preset-studio-bridge-status"
                class="preset-studio-bridge__status"
                role="status"
                aria-live="polite"
                data-state="idle"
            >尚未连接</p>
        </div>
    `;

    container.append(panel);
    return panel;
}

function bindSettingsUi(panel, settings) {
    const ui = {
        panel,
        serverUrl: panel.querySelector('#preset-studio-bridge-url'),
        pairingCode: panel.querySelector('#preset-studio-bridge-code'),
        connect: panel.querySelector('#preset-studio-bridge-connect'),
        disconnect: panel.querySelector('#preset-studio-bridge-disconnect'),
        status: panel.querySelector('#preset-studio-bridge-status'),
    };

    if (Object.values(ui).some((element) => !element)) {
        panel.remove();
        throw new Error('Preset Studio Bridge settings UI could not be initialized.');
    }

    ui.serverUrl.value = settings.serverUrl;
    ui.serverUrl.addEventListener('change', () => {
        const raw = ui.serverUrl.value.trim();
        if (raw) {
            saveServerUrl(raw);
        }
    });
    ui.serverUrl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void handleConnectClick();
        }
    });
    ui.pairingCode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void handleConnectClick();
        }
    });
    ui.connect.addEventListener('click', () => void handleConnectClick());
    ui.disconnect.addEventListener('click', handleDisconnectClick);
    state.ui = ui;

    const normalized = tryNormalizeUrl(settings.serverUrl);
    if (normalized && getResumeToken(normalized)) {
        setStatus('idle', '已找到本标签页的临时会话凭据，可直接连接。');
    } else {
        setStatus('idle', '尚未连接');
    }

    refreshControls();
}

function tryNormalizeUrl(value) {
    try {
        return normalizeServerUrl(value);
    } catch {
        return null;
    }
}

function setStatus(kind, message) {
    if (!state.ui) {
        return;
    }

    state.ui.status.dataset.state = kind;
    state.ui.status.textContent = message;
    state.ui.panel.dataset.state = kind;
}

function refreshControls() {
    if (!state.ui) {
        return;
    }

    const connecting = state.socket?.readyState === WebSocket.CONNECTING;
    const open = state.socket?.readyState === WebSocket.OPEN;
    state.ui.connect.disabled = connecting || open;
    state.ui.disconnect.disabled = !state.wantConnected && !connecting && !open;
    state.ui.serverUrl.disabled = connecting || open;
}

async function handleConnectClick() {
    if (!state.ui) {
        return;
    }

    let serverUrl;
    try {
        serverUrl = normalizeServerUrl(state.ui.serverUrl.value);
    } catch (error) {
        setStatus('error', getErrorMessage(error));
        return;
    }

    const pairingCode = state.ui.pairingCode.value.trim();
    if (pairingCode) {
        clearResumeToken(serverUrl);
        state.auth = { kind: 'pairing', value: pairingCode };
    } else {
        const resumeToken = getResumeToken(serverUrl);
        if (!resumeToken) {
            setStatus('error', '请输入有效配对码；当前标签页没有可用的临时会话凭据。');
            state.ui.pairingCode.focus();
            return;
        }
        state.auth = { kind: 'resume', value: resumeToken };
    }

    saveServerUrl(serverUrl);
    state.ui.serverUrl.value = serverUrl;
    state.serverUrl = serverUrl;
    state.wantConnected = true;
    state.blocked = false;
    state.reconnectAttempt = 0;
    clearReconnectTimer();
    await openConnection();
}

function handleDisconnectClick() {
    disconnect('已由用户断开连接。');
}

async function openConnection() {
    if (!state.wantConnected || state.blocked || !state.auth || !state.serverUrl) {
        return;
    }

    const generation = ++state.socketGeneration;
    closeCurrentSocket();
    setStatus('connecting', state.reconnectAttempt > 0 ? '正在重新连接…' : '正在连接…');
    refreshControls();

    let hello;
    try {
        hello = await buildHello(state.auth);
    } catch (error) {
        if (generation !== state.socketGeneration || !state.wantConnected) {
            return;
        }
        stopReconnect('error', `无法读取 SillyTavern 状态：${getErrorMessage(error)}`);
        return;
    }

    if (generation !== state.socketGeneration || !state.wantConnected || state.blocked) {
        return;
    }

    let socket;
    try {
        socket = new WebSocket(state.serverUrl);
    } catch (error) {
        scheduleReconnect(`连接创建失败：${getErrorMessage(error)}`);
        return;
    }

    state.socket = socket;
    socket.addEventListener('open', () => {
        if (!isCurrentSocket(socket, generation)) {
            socket.close();
            return;
        }

        state.lastTrafficAt = Date.now();
        socket.send(JSON.stringify(hello));
        setStatus('connecting', '连接已建立，正在验证配对…');
        clearHandshakeTimer();
        state.handshakeTimer = window.setTimeout(() => {
            if (isCurrentSocket(socket, generation)) {
                socket.close(4000, 'Bridge handshake timeout');
            }
        }, HANDSHAKE_TIMEOUT_MS);
        refreshControls();
    });

    socket.addEventListener('message', (event) => {
        void handleSocketMessage(socket, generation, event.data);
    });

    socket.addEventListener('error', () => {
        if (isCurrentSocket(socket, generation)) {
            setStatus('connecting', 'WebSocket 连接发生错误，等待连接关闭…');
        }
    });

    socket.addEventListener('close', (event) => {
        handleSocketClose(socket, generation, event);
    });
    refreshControls();
}

function isCurrentSocket(socket, generation) {
    return state.socket === socket && state.socketGeneration === generation;
}

async function handleSocketMessage(socket, generation, rawData) {
    if (!isCurrentSocket(socket, generation)) {
        return;
    }

    state.lastTrafficAt = Date.now();
    let message;
    try {
        const text = typeof rawData === 'string'
            ? rawData
            : rawData instanceof Blob
                ? await rawData.text()
                : new TextDecoder().decode(rawData);
        message = JSON.parse(text);
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Ignored a non-JSON bridge message.`, error);
        return;
    }

    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return;
    }

    switch (message.type) {
        case 'bridge.ack':
            handleBridgeAck(message);
            break;
        case 'bridge.error':
            handleBridgeError(message);
            break;
        case 'ping':
            if (typeof message.timestamp === 'number') {
                sendMessage({ type: 'pong', timestamp: message.timestamp });
            }
            break;
        case 'pong':
            break;
        case 'rpc.request':
            await handleRpcRequest(message);
            break;
        default:
            console.debug(`[${MODULE_NAME}] Ignored unsupported message type: ${message.type}`);
    }
}

function handleBridgeAck(message) {
    if (
        typeof message.connectionId !== 'string'
        || !message.connectionId
        || typeof message.resumeToken !== 'string'
        || !message.resumeToken
        || !Number.isFinite(message.heartbeatIntervalMs)
        || message.heartbeatIntervalMs <= 0
    ) {
        state.blocked = true;
        setStatus('error', 'Bridge 返回了无效的确认消息，请检查 Studio 版本。');
        state.socket?.close(1008, 'Invalid bridge acknowledgment');
        return;
    }

    clearHandshakeTimer();
    setResumeToken(state.serverUrl, message.resumeToken);
    state.auth = { kind: 'resume', value: message.resumeToken };
    state.ui && (state.ui.pairingCode.value = '');
    state.reconnectAttempt = 0;
    state.heartbeatIntervalMs = message.heartbeatIntervalMs;
    startHeartbeat();
    setStatus('connected', '已连接。Preset Studio 可读取当前 Chat Completion 预设。');
    refreshControls();
}

function handleBridgeError(message) {
    const code = typeof message.code === 'string' ? message.code : 'BRIDGE_ERROR';
    const serverMessage = typeof message.message === 'string' && message.message
        ? message.message
        : 'Bridge 拒绝了连接。';

    if (code === 'RESUME_TOKEN_INVALID') {
        clearResumeToken(state.serverUrl);
        state.auth = null;
    }

    if (FATAL_BRIDGE_CODES.has(code)) {
        state.blocked = true;
        state.wantConnected = false;
        clearReconnectTimer();
        setStatus('error', `${serverMessage}（${code}）请重新取得配对码后连接。`);
        refreshControls();
        return;
    }

    setStatus('error', `${serverMessage}（${code}）`);
}

function handleSocketClose(socket, generation, event) {
    if (!isCurrentSocket(socket, generation)) {
        return;
    }

    state.socket = null;
    clearHandshakeTimer();
    clearHeartbeatTimer();
    refreshControls();

    if (!state.wantConnected || state.blocked) {
        return;
    }

    if (event.code === 1008 || event.code === 1009) {
        const reason = event.reason ? `：${event.reason}` : '';
        stopReconnect('error', `Bridge 已拒绝连接（${event.code}）${reason}。请检查配对与连接设置。`);
        return;
    }

    scheduleReconnect(`连接已断开（${event.code || 1006}）。`);
}

function scheduleReconnect(reason) {
    if (!state.wantConnected || state.blocked) {
        return;
    }

    clearReconnectTimer();
    const baseDelay = Math.min(1_000 * (2 ** state.reconnectAttempt), MAX_RECONNECT_DELAY_MS);
    const delay = Math.round(baseDelay * (0.85 + Math.random() * 0.3));
    state.reconnectAttempt += 1;
    setStatus('connecting', `${reason} ${Math.max(1, Math.ceil(delay / 1_000))} 秒后重试。`);
    state.reconnectTimer = window.setTimeout(() => {
        state.reconnectTimer = null;
        void openConnection();
    }, delay);
    refreshControls();
}

function stopReconnect(kind, message) {
    state.wantConnected = false;
    state.blocked = true;
    clearReconnectTimer();
    clearHandshakeTimer();
    clearHeartbeatTimer();
    setStatus(kind, message);
    refreshControls();
}

function disconnect(message = '已断开连接。') {
    state.wantConnected = false;
    state.blocked = false;
    state.auth = null;
    state.socketGeneration += 1;
    clearReconnectTimer();
    clearHandshakeTimer();
    clearHeartbeatTimer();
    const socket = state.socket;
    state.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close(1000, 'User disconnected');
    }
    setStatus('idle', message);
    refreshControls();
}

function closeCurrentSocket() {
    clearHandshakeTimer();
    clearHeartbeatTimer();
    const socket = state.socket;
    state.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close(1000, 'Replaced connection');
    }
}

function clearReconnectTimer() {
    if (state.reconnectTimer !== null) {
        window.clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
    }
}

function clearHandshakeTimer() {
    if (state.handshakeTimer !== null) {
        window.clearTimeout(state.handshakeTimer);
        state.handshakeTimer = null;
    }
}

function clearHeartbeatTimer() {
    if (state.heartbeatTimer !== null) {
        window.clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;
    }
}

function startHeartbeat() {
    clearHeartbeatTimer();
    const interval = Math.max(1_000, state.heartbeatIntervalMs);
    state.lastTrafficAt = Date.now();
    state.heartbeatTimer = window.setInterval(() => {
        const socket = state.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        if (Date.now() - state.lastTrafficAt > Math.max(interval * 3, 15_000)) {
            socket.close(4000, 'Heartbeat timeout');
            return;
        }

        sendMessage({ type: 'ping', timestamp: Date.now() });
    }, interval);
}

function sendMessage(message) {
    const socket = state.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        socket.send(JSON.stringify(message));
        return true;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to send a bridge message.`, error);
        return false;
    }
}

async function buildHello(auth) {
    const context = getContext();
    const [version, bridgeContext] = await Promise.all([
        readSillyTavernVersion(),
        buildBridgeContext(context),
    ]);
    const st = { version: version.version };
    if (version.branch) {
        st.branch = version.branch;
    }
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        st.url = window.location.origin;
    }

    return {
        type: 'bridge.hello',
        protocolVersion: PROTOCOL_VERSION,
        ...(auth.kind === 'pairing' ? { pairingCode: auth.value } : { resumeToken: auth.value }),
        bridgeVersion: BRIDGE_VERSION,
        st,
        capabilities: [...CAPABILITIES],
        context: bridgeContext,
    };
}

async function readSillyTavernVersion() {
    try {
        const response = await fetch('/version', {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        return {
            version: firstNonEmptyString(data.pkgVersion, data.version) ?? 'unknown',
            branch: firstNonEmptyString(data.gitBranch, data.branch),
        };
    } catch (error) {
        console.warn(`[${MODULE_NAME}] Could not read /version; reporting an unknown ST version.`, error);
        return { version: 'unknown', branch: null };
    }
}

async function buildBridgeContext(context) {
    const bridgeContext = {};
    const currentPresetName = await getCurrentPresetName(context);
    assignNonEmptyString(bridgeContext, 'currentPresetName', currentPresetName);
    assignNonEmptyString(bridgeContext, 'mainApi', context.mainApi);
    assignNonEmptyString(bridgeContext, 'characterName', getCharacterName(context));
    assignNonEmptyString(bridgeContext, 'chatId', context.chatId);
    assignNonEmptyString(bridgeContext, 'personaName', context.name1);
    return bridgeContext;
}

function getCharacterName(context) {
    const directName = firstNonEmptyString(context.name2);
    if (directName) {
        return directName;
    }

    const characterId = context.characterId;
    if (characterId !== undefined && characterId !== null && Array.isArray(context.characters)) {
        return firstNonEmptyString(context.characters[characterId]?.name);
    }
    return null;
}

async function getCurrentPresetName(context) {
    if (context.mainApi !== 'openai') {
        return null;
    }

    try {
        const manager = context.getPresetManager?.('openai');
        if (manager && typeof manager.getSelectedPresetName === 'function') {
            return firstNonEmptyString(await manager.getSelectedPresetName());
        }
    } catch (error) {
        console.debug(`[${MODULE_NAME}] Preset manager name lookup failed.`, error);
    }

    return firstNonEmptyString(context.chatCompletionSettings?.preset_settings_openai);
}

async function handleRpcRequest(request) {
    if (typeof request.id !== 'string' || !request.id) {
        return;
    }

    if (request.method !== 'preset.pull') {
        sendRpcError(request.id, new BridgeRpcError(
            'UNSUPPORTED_METHOD',
            `Unsupported RPC method: ${String(request.method)}`,
        ));
        return;
    }

    try {
        const result = await pullCurrentPreset();
        sendMessage({
            type: 'rpc.response',
            id: request.id,
            ok: true,
            result,
        });
        setStatus('connected', `已向 Preset Studio 发送预设“${result.name}”。`);
    } catch (error) {
        sendRpcError(request.id, error);
        console.error(`[${MODULE_NAME}] preset.pull failed.`, error);
    }
}

async function pullCurrentPreset() {
    const context = getContext();
    if (context.mainApi !== 'openai') {
        throw new BridgeRpcError(
            'CHAT_COMPLETION_NOT_ACTIVE',
            'SillyTavern 当前未使用 Chat Completion API，请先在 SillyTavern 中切换到 Chat Completion。',
            { mainApi: firstNonEmptyString(context.mainApi) ?? 'unknown' },
        );
    }

    const manager = context.getPresetManager?.('openai');
    if (
        manager
        && typeof manager.getSelectedPresetName === 'function'
        && typeof manager.getCompletionPresetByName === 'function'
    ) {
        const name = firstNonEmptyString(await manager.getSelectedPresetName());
        if (!name) {
            throw new BridgeRpcError('PRESET_UNAVAILABLE', '当前没有选中的 Chat Completion 预设。');
        }

        const preset = await manager.getCompletionPresetByName(name);
        return validatePresetResult(name, preset);
    }

    // Compatibility adapter for ST builds that expose the documented context state
    // but not the 1.18 preset-manager methods. Keep this isolated so it can be removed
    // when the minimum supported ST version is raised.
    const settings = context.chatCompletionSettings;
    const fallbackName = firstNonEmptyString(settings?.preset_settings_openai);
    if (settings && fallbackName) {
        console.warn(`[${MODULE_NAME}] Using the chatCompletionSettings compatibility adapter.`);
        return validatePresetResult(fallbackName, settings);
    }

    throw new BridgeRpcError(
        'PRESET_UNAVAILABLE',
        '无法从 SillyTavern 读取当前 Chat Completion 预设。',
    );
}

function validatePresetResult(name, preset) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
        throw new BridgeRpcError('PRESET_UNAVAILABLE', `预设“${name}”不存在或格式无效。`);
    }

    let cloned;
    try {
        cloned = typeof structuredClone === 'function'
            ? structuredClone(preset)
            : JSON.parse(JSON.stringify(preset));
        // Prove that the response is JSON serializable before reporting success.
        cloned = JSON.parse(JSON.stringify(cloned));
    } catch (error) {
        throw new BridgeRpcError(
            'PRESET_SERIALIZATION_FAILED',
            `预设“${name}”无法序列化为 JSON。`,
            { cause: error instanceof Error ? error.name : 'UnknownError' },
        );
    }

    return { name, preset: cloned };
}

function sendRpcError(id, error) {
    const rpcError = error instanceof BridgeRpcError
        ? error
        : new BridgeRpcError('PRESET_PULL_FAILED', getErrorMessage(error));
    sendMessage({
        type: 'rpc.response',
        id,
        ok: false,
        error: {
            code: rpcError.code,
            message: rpcError.message,
            ...(rpcError.details === undefined ? {} : { details: rpcError.details }),
        },
    });
}

function firstNonEmptyString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
    }
    return null;
}

function assignNonEmptyString(target, key, value) {
    const normalized = firstNonEmptyString(value);
    if (normalized) {
        target[key] = normalized;
    }
}

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

class BridgeRpcError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'BridgeRpcError';
        this.code = code;
        this.details = details;
    }
}

function registerAppReadyHandler() {
    if (state.appReadyHandler) {
        return;
    }

    const context = state.context ?? getContext();
    state.context = context;
    const eventTypes = context.eventTypes ?? context.event_types;
    const appReadyEvent = eventTypes?.APP_READY;
    if (appReadyEvent && typeof context.eventSource?.on === 'function') {
        state.appReadyEvent = appReadyEvent;
        state.appReadyHandler = () => scheduleInitialize();
        context.eventSource.on(appReadyEvent, state.appReadyHandler);
    }
}

function unregisterAppReadyHandler() {
    if (!state.context || !state.appReadyEvent || !state.appReadyHandler) {
        return;
    }

    if (typeof state.context.eventSource?.off === 'function') {
        state.context.eventSource.off(state.appReadyEvent, state.appReadyHandler);
    } else if (typeof state.context.eventSource?.removeListener === 'function') {
        state.context.eventSource.removeListener(state.appReadyEvent, state.appReadyHandler);
    }
    state.appReadyEvent = null;
    state.appReadyHandler = null;
}

function scheduleInitialize() {
    if (state.ui || state.initTimer !== null) {
        return;
    }

    state.initTimer = window.setTimeout(() => {
        state.initTimer = null;
        try {
            const context = state.context ?? getContext();
            state.context = context;
            const panel = mountSettingsUi();
            if (!panel) {
                state.initAttempts += 1;
                if (state.initAttempts < 40) {
                    scheduleInitialize();
                } else {
                    console.error(`[${MODULE_NAME}] Could not find ${SETTINGS_CONTAINER_SELECTOR}.`);
                }
                return;
            }

            state.initAttempts = 0;
            bindSettingsUi(panel, ensureSettings(context));
            console.info(`[${MODULE_NAME}] Extension initialized.`);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Extension initialization failed.`, error);
        }
    }, state.initAttempts === 0 ? 0 : 250);
}

function clearInitializeTimer() {
    if (state.initTimer !== null) {
        window.clearTimeout(state.initTimer);
        state.initTimer = null;
    }
    state.initAttempts = 0;
}

export function onActivate() {
    try {
        state.context = getContext();
        registerAppReadyHandler();
        if (document.readyState === 'complete') {
            scheduleInitialize();
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Activation failed.`, error);
    }
}

export function onEnable() {
    try {
        state.context = getContext();
        registerAppReadyHandler();
        scheduleInitialize();
    } catch (error) {
        console.error(`[${MODULE_NAME}] Enable failed.`, error);
    }
}

export function onDisable() {
    unregisterAppReadyHandler();
    clearInitializeTimer();
    disconnect('扩展已停用。');
    state.ui?.panel.remove();
    state.ui = null;
}
