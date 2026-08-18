import type { JsonValue, PreviewRuntimeScript } from "../lib/project-api";

export const PREVIEW_PROTOCOL_VERSION = 1 as const;
export const PREVIEW_LIMITS = {
  htmlBytes: 8 * 1024 * 1024,
  scriptBytes: 16 * 1024 * 1024,
  scriptChunkThresholdBytes: 512 * 1024,
  scriptChunkCodeUnits: 256 * 1024,
  scriptChunkBytes: 1024 * 1024,
  scriptMaxChunks: 128,
  logBytes: 256 * 1024,
  logEntries: 2_000,
  handshakeTimeoutMs: 10_000,
  requestTimeoutMs: 30_000,
} as const;

export type PreviewRuntimeStatus =
  | "disabled"
  | "stopped"
  | "booting"
  | "loading-scripts"
  | "running"
  | "dirty"
  | "failed";

export type PreviewFrameKind = "host" | "project-script" | "message" | "template";

export type PreviewTemplatePhase = "render" | "generate";

export interface PreviewTemplateOptions {
  enabled: boolean;
  phase: PreviewTemplatePhase;
  extraContext?: Record<string, JsonValue>;
}

export interface PreviewTemplateState {
  status: "none" | "disabled" | "evaluating" | "rendered" | "error";
  detected: boolean;
  enabled: boolean;
  phase: PreviewTemplatePhase;
  path: string;
  durationMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  message?: string;
  line?: number;
}

export interface PreviewGenerationMessage {
  role: string;
  content: JsonValue;
  name?: string;
}

export interface PreviewGenerationState {
  status: "running" | "complete" | "error";
  generationId: string;
  dryRun: boolean;
  eventSequence: string[];
  initialMessages: PreviewGenerationMessage[];
  finalMessages: PreviewGenerationMessage[];
  settings: Record<string, JsonValue>;
  templateEvaluationCount: number;
  truncated?: boolean;
  durationMs?: number;
  message?: string;
}

export interface PreviewFrameReference {
  kind: PreviewFrameKind;
  id?: string;
  name?: string;
  path?: string;
}

export interface PreviewMessageState {
  message_id: number;
  role: "system" | "user" | "assistant";
  message: string;
  name?: string;
  is_user?: boolean;
  is_system?: boolean;
  variables?: Record<string, JsonValue>;
}

export interface PreviewContextState {
  user: string;
  char: string;
  role: "system" | "user" | "assistant";
  mesId: number;
  variables: {
    global: Record<string, JsonValue>;
    chat: Record<string, JsonValue>;
    message: Record<string, JsonValue>;
  };
  messages: PreviewMessageState[];
  mockGeneration?: string;
}

export interface PreviewRuntimeConfiguration {
  projectId: string;
  projectName: string;
  preset: JsonValue;
  regexScripts: JsonValue[];
  context: PreviewContextState;
  templateEnabled: boolean;
}

export interface PreviewScriptLoadPayload {
  script: PreviewRuntimeScript;
  source: string;
}

export interface PreviewMessageRenderPayload {
  path: string;
  source: string;
  contentMode: "html" | "text";
  template: PreviewTemplateOptions;
}

export interface PreviewRuntimeLogEntry {
  id: number;
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  frame: PreviewFrameReference;
  message: string;
  values?: unknown[];
  truncated?: boolean;
  filename?: string;
  line?: number;
  column?: number;
}

export interface PreviewScriptRuntimeState {
  id: string;
  name: string;
  path: string;
  index: number;
  status: "pending" | "loading" | "running" | "error";
  message?: string;
  transferredBytes?: number;
  byteLength?: number;
}

export interface PreviewCapabilityUsage {
  capability: string;
  frame: PreviewFrameReference;
  count: number;
  supported: boolean;
  strategy: "native" | "memory" | "stub";
  message?: string;
}

export type PreviewRuntimeEvent =
  | { type: "console"; timestamp: number; level: string; values: unknown[]; frame: PreviewFrameReference; truncated?: boolean }
  | { type: "runtime-error"; timestamp: number; message: string; frame: PreviewFrameReference; filename?: string; line?: number; column?: number; error?: unknown }
  | { type: "runtime-status"; timestamp: number; status: string; message?: string }
  | { type: "script-status"; timestamp: number; script: PreviewScriptRuntimeState }
  | { type: "capability-used"; timestamp: number; usage: Omit<PreviewCapabilityUsage, "count"> }
  | { type: "state-changed"; timestamp: number; context: PreviewContextState }
  | { type: "template-status"; timestamp: number; template: PreviewTemplateState }
  | { type: "generation-status"; timestamp: number; generation: PreviewGenerationState }
  | { type: "rendered"; timestamp: number; path: string; durationMs?: number };

export type PreviewRequestType =
  | "runtime:configure"
  | "script:load"
  | "script:transfer-begin"
  | "script:transfer-chunk"
  | "script:transfer-commit"
  | "script:transfer-cancel"
  | "runtime:start-scripts"
  | "message:render"
  | "generation:simulate"
  | "state:update"
  | "storage:clear"
  | "runtime:dispose";

export interface PreviewPortRequest {
  type: PreviewRequestType;
  protocolVersion: typeof PREVIEW_PROTOCOL_VERSION;
  sessionNonce: string;
  requestId: string;
  payload?: unknown;
}

export interface PreviewPortResponse {
  type: "preview:connected" | "preview:ack" | "preview:error" | "preview:event";
  protocolVersion: typeof PREVIEW_PROTOCOL_VERSION;
  sessionNonce: string;
  requestId?: string;
  payload?: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPreviewPortResponse(value: unknown): value is PreviewPortResponse {
  if (!isRecord(value) || value.protocolVersion !== PREVIEW_PROTOCOL_VERSION) return false;
  return value.type === "preview:connected"
    || value.type === "preview:ack"
    || value.type === "preview:error"
    || value.type === "preview:event";
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
