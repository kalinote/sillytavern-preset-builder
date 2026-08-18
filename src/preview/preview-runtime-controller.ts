import {
  PREVIEW_LIMITS,
  PREVIEW_PROTOCOL_VERSION,
  isPreviewPortResponse,
  isRecord,
  type PreviewPortRequest,
  type PreviewRequestType,
  type PreviewRuntimeEvent,
} from "./protocol";

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
}

export interface PreviewFramePresentation {
  width: number;
  height: number;
  scale: number;
}

function createNonce(): string {
  if (typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function messageFromPayload(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.message === "string" ? payload.message : fallback;
}

export class PreviewRuntimeController {
  readonly iframe: HTMLIFrameElement;
  readonly origin: string;

  private readonly runtimeUrl: string;
  private readonly sessionNonce = createNonce();
  private readonly parking: HTMLDivElement;
  private readonly listeners = new Set<(event: PreviewRuntimeEvent) => void>();
  private readonly pending = new Map<string, PendingRequest>();
  private port?: MessagePort;
  private requestSequence = 0;
  private connectPromise?: Promise<void>;
  private connectResolve?: () => void;
  private connectReject?: (error: Error) => void;
  private handshakeTimeout?: number;
  private attachTarget?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private placementFrame?: number;
  private presentation: PreviewFramePresentation = { width: 1280, height: 720, scale: 1 };
  private disposed = false;
  private frameLoadCount = 0;

  constructor(previewOrigin: string) {
    this.origin = new URL(previewOrigin).origin;
    if (this.origin === window.location.origin) {
      throw new Error("Preview Host 与 Studio 同源，已拒绝执行用户脚本。");
    }
    this.runtimeUrl = new URL("/preview-runtime", this.origin).toString();
    this.parking = document.createElement("div");
    this.parking.hidden = true;
    this.parking.dataset.previewRuntimeParking = "true";
    this.parking.style.position = "fixed";
    this.parking.style.overflow = "hidden";
    this.parking.style.zIndex = "20";
    this.parking.style.background = "white";
    document.body.append(this.parking);

    this.iframe = document.createElement("iframe");
    this.iframe.title = "项目动态 JavaScript 预览";
    this.iframe.addEventListener("load", this.handleFrameLoad);
    this.iframe.src = this.runtimeUrl;
    this.iframe.sandbox.value = "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock";
    this.iframe.allow = "clipboard-read; clipboard-write; fullscreen";
    this.iframe.referrerPolicy = "no-referrer";
    this.iframe.style.display = "block";
    this.iframe.style.border = "0";
    this.iframe.style.background = "white";
    this.iframe.style.position = "absolute";
    this.iframe.style.left = "0";
    this.iframe.style.top = "0";
    this.parking.append(this.iframe);
    window.addEventListener("message", this.handleWindowMessage);
  }

  subscribe(listener: (event: PreviewRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  attach(container: HTMLElement, presentation: PreviewFramePresentation): void {
    if (this.disposed) return;
    if (this.attachTarget !== container) {
      this.stopPlacementTracking();
      this.attachTarget = container;
      this.resizeObserver = new ResizeObserver(this.schedulePlacement);
      this.resizeObserver.observe(container);
      window.addEventListener("resize", this.schedulePlacement);
      window.addEventListener("scroll", this.schedulePlacement, true);
    }
    this.parking.hidden = false;
    this.setPresentation(presentation);
  }

  setPresentation({ width, height, scale }: PreviewFramePresentation): void {
    this.presentation = { width, height, scale };
    this.iframe.style.width = `${width}px`;
    this.iframe.style.height = `${height}px`;
    this.iframe.style.transform = `scale(${scale})`;
    this.iframe.style.transformOrigin = "top left";
    this.schedulePlacement();
  }

  park(container?: HTMLElement): void {
    if (this.disposed || (container && this.attachTarget !== container)) return;
    this.stopPlacementTracking();
    this.attachTarget = undefined;
    this.parking.hidden = true;
  }

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("动态预览已经销毁"));
    if (this.port) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.handshakeTimeout = window.setTimeout(() => {
        reject(new Error("无法连接独立 Preview Host，请检查 Origin 与 frame-ancestors 配置。"));
        this.connectPromise = undefined;
      }, PREVIEW_LIMITS.handshakeTimeoutMs);
    });
    return this.connectPromise;
  }

  async request(
    type: PreviewRequestType,
    payload?: unknown,
    timeoutMs: number = PREVIEW_LIMITS.requestTimeoutMs,
    transferables?: Transferable[],
  ): Promise<void> {
    await this.connect();
    if (!this.port || this.disposed) throw new Error("动态预览通信通道不可用");
    this.requestSequence += 1;
    const requestId = `${type}-${this.requestSequence}`;
    const message: PreviewPortRequest = {
      type,
      protocolVersion: PREVIEW_PROTOCOL_VERSION,
      sessionNonce: this.sessionNonce,
      requestId,
      ...(payload === undefined ? {} : { payload }),
    };
    return new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${type} 请求超时`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      if (transferables && transferables.length > 0) this.port?.postMessage(message, transferables);
      else this.port?.postMessage(message);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    // Removing the outer iframe is the definitive cancellation boundary: it
    // synchronously tears down every project/message/template child frame and
    // their browser resources. Notify the host on a best-effort basis, but do
    // not make the Studio UI wait for a cross-origin acknowledgement.
    if (this.port) {
      void this.request("runtime:dispose", undefined, 250).catch(() => undefined);
    }
    this.disposed = true;
    window.removeEventListener("message", this.handleWindowMessage);
    this.iframe.removeEventListener("load", this.handleFrameLoad);
    if (this.handshakeTimeout !== undefined) window.clearTimeout(this.handshakeTimeout);
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(new Error("动态预览已经停止"));
    }
    this.pending.clear();
    this.port?.close();
    this.port = undefined;
    this.stopPlacementTracking();
    this.iframe.remove();
    this.parking.remove();
    this.listeners.clear();
  }

  private readonly handleWindowMessage = (event: MessageEvent<unknown>) => {
    if (
      this.disposed
      || event.origin !== this.origin
      || event.source !== this.iframe.contentWindow
      || !isRecord(event.data)
      || event.data.type !== "preview:ready"
      || event.data.protocolVersion !== PREVIEW_PROTOCOL_VERSION
      || this.port
    ) return;
    const channel = new MessageChannel();
    this.port = channel.port1;
    channel.port1.onmessage = this.handlePortMessage;
    channel.port1.onmessageerror = this.handlePortMessageError;
    channel.port1.start();
    this.iframe.contentWindow?.postMessage(
      {
        type: "preview:connect",
        protocolVersion: PREVIEW_PROTOCOL_VERSION,
        sessionNonce: this.sessionNonce,
      },
      this.origin,
      [channel.port2],
    );
  };

  private readonly handleFrameLoad = () => {
    this.frameLoadCount += 1;
    if (this.disposed || this.frameLoadCount === 1 || !this.port) return;
    this.failTransport("Preview Host 已意外重载，运行时已停止，请重新启动。");
  };

  private readonly handlePortMessageError = () => {
    if (this.disposed) return;
    this.failTransport("Preview Host 通信通道发生错误，运行时已停止，请重新启动。");
  };

  private failTransport(message: string): void {
    const error = new Error(message);
    if (this.handshakeTimeout !== undefined) window.clearTimeout(this.handshakeTimeout);
    this.handshakeTimeout = undefined;
    this.connectReject?.(error);
    this.connectResolve = undefined;
    this.connectReject = undefined;
    this.connectPromise = undefined;
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    this.port?.close();
    this.port = undefined;
    const event: PreviewRuntimeEvent = {
      type: "runtime-status",
      timestamp: Date.now(),
      status: "failed",
      message,
    };
    for (const listener of this.listeners) listener(event);
  }

  private readonly schedulePlacement = () => {
    if (this.disposed || this.parking.hidden || !this.attachTarget || this.placementFrame !== undefined) return;
    this.placementFrame = window.requestAnimationFrame(() => {
      this.placementFrame = undefined;
      this.updatePlacement();
    });
  };

  private updatePlacement(): void {
    const target = this.attachTarget;
    if (!target || this.parking.hidden) return;
    const targetRect = target.getBoundingClientRect();
    let left = Math.max(0, targetRect.left);
    let top = Math.max(0, targetRect.top);
    let right = Math.min(window.innerWidth, targetRect.right);
    let bottom = Math.min(window.innerHeight, targetRect.bottom);

    for (let ancestor = target.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const style = window.getComputedStyle(ancestor);
      if (!/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) continue;
      const rect = ancestor.getBoundingClientRect();
      left = Math.max(left, rect.left);
      top = Math.max(top, rect.top);
      right = Math.min(right, rect.right);
      bottom = Math.min(bottom, rect.bottom);
    }

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    this.parking.style.visibility = width > 0 && height > 0 ? "visible" : "hidden";
    this.parking.style.left = `${left}px`;
    this.parking.style.top = `${top}px`;
    this.parking.style.width = `${width}px`;
    this.parking.style.height = `${height}px`;
    this.iframe.style.left = `${targetRect.left - left}px`;
    this.iframe.style.top = `${targetRect.top - top}px`;
    this.iframe.style.width = `${this.presentation.width}px`;
    this.iframe.style.height = `${this.presentation.height}px`;
  }

  private stopPlacementTracking(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    window.removeEventListener("resize", this.schedulePlacement);
    window.removeEventListener("scroll", this.schedulePlacement, true);
    if (this.placementFrame !== undefined) {
      window.cancelAnimationFrame(this.placementFrame);
      this.placementFrame = undefined;
    }
  }

  private readonly handlePortMessage = (event: MessageEvent<unknown>) => {
    if (this.disposed || !isPreviewPortResponse(event.data) || event.data.sessionNonce !== this.sessionNonce) return;
    const message = event.data;
    if (message.type === "preview:connected") {
      if (this.handshakeTimeout !== undefined) window.clearTimeout(this.handshakeTimeout);
      this.connectResolve?.();
      this.connectResolve = undefined;
      this.connectReject = undefined;
      return;
    }
    if (message.type === "preview:event") {
      if (!isRecord(message.payload) || typeof message.payload.type !== "string" || typeof message.payload.timestamp !== "number") return;
      const runtimeEvent = message.payload as unknown as PreviewRuntimeEvent;
      for (const listener of this.listeners) listener(runtimeEvent);
      return;
    }
    if (typeof message.requestId !== "string") return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(message.requestId);
    if (message.type === "preview:ack") pending.resolve();
    else pending.reject(new Error(messageFromPayload(message.payload, "动态预览请求失败")));
  };
}
