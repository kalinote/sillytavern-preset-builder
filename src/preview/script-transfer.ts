import type { PreviewRuntimeScript } from "../lib/project-api";
import { PREVIEW_LIMITS, type PreviewRequestType } from "./protocol";

interface PreviewTransferPort {
  request(
    type: PreviewRequestType,
    payload?: unknown,
    timeoutMs?: number,
    transferables?: Transferable[],
  ): Promise<void>;
}

export interface ScriptChunkRange {
  start: number;
  end: number;
}

export interface ScriptTransferResult {
  chunkCount: number;
  transferredBytes: number;
  durationMs: number;
}

export class PreviewScriptTransferCancelledError extends Error {
  constructor() {
    super("Project script transfer was cancelled");
    this.name = "PreviewScriptTransferCancelledError";
  }
}

export function planScriptChunks(
  source: string,
  chunkCodeUnits: number = PREVIEW_LIMITS.scriptChunkCodeUnits,
): ScriptChunkRange[] {
  if (!Number.isInteger(chunkCodeUnits) || chunkCodeUnits < 2) {
    throw new RangeError("Script chunk size must be an integer of at least two UTF-16 code units");
  }
  if (source.length === 0) return [{ start: 0, end: 0 }];
  const ranges: ScriptChunkRange[] = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + chunkCodeUnits);
    if (
      end < source.length
      && end > start
      && source.charCodeAt(end - 1) >= 0xD800
      && source.charCodeAt(end - 1) <= 0xDBFF
      && source.charCodeAt(end) >= 0xDC00
      && source.charCodeAt(end) <= 0xDFFF
    ) end -= 1;
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

export async function transferProjectScript(
  port: PreviewTransferPort,
  script: PreviewRuntimeScript,
  source: string,
  isCancelled: () => boolean,
): Promise<ScriptTransferResult> {
  if (isCancelled()) throw new PreviewScriptTransferCancelledError();
  const ranges = planScriptChunks(source);
  if (ranges.length > PREVIEW_LIMITS.scriptMaxChunks) {
    throw new Error(`${script.name} requires ${ranges.length} chunks; maximum is ${PREVIEW_LIMITS.scriptMaxChunks}`);
  }
  const transferId = `${script.uid}-${crypto.randomUUID()}`;
  const startedAt = performance.now();
  let begun = false;
  let transferredBytes = 0;
  try {
    await port.request("script:transfer-begin", {
      transferId,
      script,
      totalChunks: ranges.length,
      totalBytes: script.byteLength,
      contentHash: script.contentHash,
    });
    begun = true;
    const encoder = new TextEncoder();
    for (let index = 0; index < ranges.length; index += 1) {
      if (isCancelled()) throw new PreviewScriptTransferCancelledError();
      const range = ranges[index]!;
      const bytes = encoder.encode(source.slice(range.start, range.end));
      if (bytes.byteLength > PREVIEW_LIMITS.scriptChunkBytes) {
        throw new Error(`${script.name} chunk ${index + 1} exceeds ${PREVIEW_LIMITS.scriptChunkBytes} bytes`);
      }
      transferredBytes += bytes.byteLength;
      const buffer = bytes.buffer as ArrayBuffer;
      await port.request(
        "script:transfer-chunk",
        { transferId, index, bytes: buffer },
        PREVIEW_LIMITS.requestTimeoutMs,
        [buffer],
      );
    }
    if (isCancelled()) throw new PreviewScriptTransferCancelledError();
    if (transferredBytes !== script.byteLength) {
      throw new Error(`${script.name} changed while preparing chunks: ${transferredBytes}/${script.byteLength} bytes`);
    }
    await port.request("script:transfer-commit", { transferId });
    return {
      chunkCount: ranges.length,
      transferredBytes,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    if (begun) {
      await port.request("script:transfer-cancel", { transferId }, 2_000).catch(() => undefined);
    }
    throw error;
  }
}
