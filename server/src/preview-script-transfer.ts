export interface PreviewScriptTransferDescriptor {
  id?: unknown;
  uid?: unknown;
  name?: unknown;
  path?: unknown;
  index?: unknown;
  byteLength?: unknown;
  contentHash?: unknown;
}

export interface PreviewScriptTransferOptions {
  textEncoder: { encode(value: string): Uint8Array };
  textDecoder: { decode(value?: ArrayBufferView, options?: { stream?: boolean }): string };
  digestSha256(value: Uint8Array): Promise<string>;
  maxScriptBytes: number;
  maxChunkBytes: number;
  maxChunks: number;
  load(payload: { script: PreviewScriptTransferDescriptor; source: string }): Promise<void>;
  onProgress?(payload: {
    script: PreviewScriptTransferDescriptor;
    transferredBytes: number;
    totalBytes: number;
  }): void;
}

interface ScriptTransfer {
  script: PreviewScriptTransferDescriptor;
  totalChunks: number;
  totalBytes: number;
  contentHash: string;
  nextIndex: number;
  receivedBytes: number;
  chunks: Uint8Array[];
}

/**
 * This factory intentionally has no module-scope runtime dependencies. Its
 * function source is embedded in the isolated Preview Host, while the same
 * implementation is instantiated directly by Node tests.
 */
export function createPreviewScriptTransferManager(options: PreviewScriptTransferOptions) {
  const transfers = new Map<string, ScriptTransfer>();

  function transferError(message: string): Error {
    const error = new Error(message);
    error.name = "PreviewScriptTransferError";
    return error;
  }

  function requireTransferId(value: unknown): string {
    if (typeof value !== "string" || value.length < 1 || value.length > 128) {
      throw transferError("Script transfer id must be a string between 1 and 128 characters");
    }
    return value;
  }

  function requireTransfer(transferId: string): ScriptTransfer {
    const transfer = transfers.get(transferId);
    if (!transfer) throw transferError(`Unknown or cancelled script transfer: ${transferId}`);
    return transfer;
  }

  function abortTransfer(transferId: string, message: string): never {
    transfers.delete(transferId);
    throw transferError(message);
  }

  function begin(payload: unknown): void {
    if (!payload || typeof payload !== "object") throw transferError("Script transfer begin payload is invalid");
    const input = payload as Record<string, unknown>;
    const transferId = requireTransferId(input.transferId);
    if (transfers.has(transferId)) throw transferError(`Duplicate script transfer: ${transferId}`);
    if (transfers.size > 0) throw transferError("Only one project script may be transferred at a time");
    if (!input.script || typeof input.script !== "object") throw transferError("Script transfer descriptor is missing");
    const script = input.script as PreviewScriptTransferDescriptor;
    const totalBytes = input.totalBytes;
    const totalChunks = input.totalChunks;
    const contentHash = input.contentHash;
    if (!Number.isInteger(totalBytes) || (totalBytes as number) < 0 || (totalBytes as number) > options.maxScriptBytes) {
      throw transferError(`Project script transfer exceeds ${options.maxScriptBytes} bytes`);
    }
    if (!Number.isInteger(totalChunks) || (totalChunks as number) < 1 || (totalChunks as number) > options.maxChunks) {
      throw transferError(`Project script transfer must contain between 1 and ${options.maxChunks} chunks`);
    }
    if (typeof contentHash !== "string" || !/^[a-f0-9]{64}$/i.test(contentHash)) {
      throw transferError("Project script transfer requires a SHA-256 content hash");
    }
    if (script.byteLength !== totalBytes || script.contentHash !== contentHash) {
      throw transferError("Project script transfer metadata does not match its runtime manifest");
    }
    const transfer: ScriptTransfer = {
      script,
      totalChunks: totalChunks as number,
      totalBytes: totalBytes as number,
      contentHash: contentHash.toLowerCase(),
      nextIndex: 0,
      receivedBytes: 0,
      chunks: [],
    };
    transfers.set(transferId, transfer);
    options.onProgress?.({ script, transferredBytes: 0, totalBytes: transfer.totalBytes });
  }

  function append(payload: unknown): void {
    if (!payload || typeof payload !== "object") throw transferError("Script transfer chunk payload is invalid");
    const input = payload as Record<string, unknown>;
    const transferId = requireTransferId(input.transferId);
    const transfer = requireTransfer(transferId);
    if (!Number.isInteger(input.index) || input.index !== transfer.nextIndex) {
      abortTransfer(transferId, `Expected script chunk ${transfer.nextIndex}, received ${String(input.index)}`);
    }
    if (!(input.bytes instanceof ArrayBuffer)) {
      abortTransfer(transferId, "Script transfer chunk must be an ArrayBuffer");
    }
    const bytes = new Uint8Array(input.bytes);
    if (bytes.byteLength > options.maxChunkBytes) {
      abortTransfer(transferId, `Script transfer chunk exceeds ${options.maxChunkBytes} bytes`);
    }
    if (transfer.receivedBytes + bytes.byteLength > transfer.totalBytes) {
      abortTransfer(transferId, "Script transfer received more bytes than declared");
    }
    transfer.chunks.push(bytes);
    transfer.receivedBytes += bytes.byteLength;
    transfer.nextIndex += 1;
    options.onProgress?.({
      script: transfer.script,
      transferredBytes: transfer.receivedBytes,
      totalBytes: transfer.totalBytes,
    });
  }

  async function commit(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object") throw transferError("Script transfer commit payload is invalid");
    const input = payload as Record<string, unknown>;
    const transferId = requireTransferId(input.transferId);
    const transfer = requireTransfer(transferId);
    transfers.delete(transferId);
    if (transfer.nextIndex !== transfer.totalChunks) {
      throw transferError(`Script transfer is incomplete: received ${transfer.nextIndex}/${transfer.totalChunks} chunks`);
    }
    if (transfer.receivedBytes !== transfer.totalBytes) {
      throw transferError(`Script transfer byte length mismatch: ${transfer.receivedBytes}/${transfer.totalBytes}`);
    }
    const joined = new Uint8Array(transfer.totalBytes);
    let offset = 0;
    for (const chunk of transfer.chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    transfer.chunks.length = 0;
    const actualHash = (await options.digestSha256(joined)).toLowerCase();
    if (actualHash !== transfer.contentHash) {
      throw transferError(`Script transfer SHA-256 mismatch: expected ${transfer.contentHash}, received ${actualHash}`);
    }
    const source = options.textDecoder.decode(joined);
    if (options.textEncoder.encode(source).byteLength !== transfer.totalBytes) {
      throw transferError("Script transfer is not canonical UTF-8 text");
    }
    await options.load({ script: transfer.script, source });
  }

  function cancel(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") throw transferError("Script transfer cancel payload is invalid");
    const transferId = requireTransferId((payload as Record<string, unknown>).transferId);
    return transfers.delete(transferId);
  }

  function clear(): void {
    transfers.clear();
  }

  return Object.freeze({ begin, append, commit, cancel, clear, get activeCount() { return transfers.size; } });
}
