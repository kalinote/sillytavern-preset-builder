import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createPreviewScriptTransferManager } from "../src/preview-script-transfer.js";
import type { PreviewRuntimeScript } from "../src/types.js";
import {
  planScriptChunks,
  PreviewScriptTransferCancelledError,
  transferProjectScript,
} from "../../src/preview/script-transfer.js";
import type { PreviewRequestType } from "../../src/preview/protocol.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function descriptor(source: string): PreviewRuntimeScript {
  return {
    uid: "large-script",
    id: "large-script",
    name: "Large script",
    index: 0,
    enabled: true,
    executable: true,
    path: "scripts/large-script/content.js",
    byteLength: encoder.encode(source).byteLength,
    contentHash: sha256(source),
  };
}

function manager(load: (source: string) => void, maxChunkBytes = 1024 * 1024) {
  return createPreviewScriptTransferManager({
    textEncoder: encoder,
    textDecoder: decoder,
    digestSha256: async (value) => sha256(value),
    maxScriptBytes: 16 * 1024 * 1024,
    maxChunkBytes,
    maxChunks: 128,
    load: async ({ source }) => load(source),
  });
}

function beginPayload(script: PreviewRuntimeScript, totalChunks: number) {
  return {
    transferId: "transfer-1",
    script,
    totalChunks,
    totalBytes: script.byteLength,
    contentHash: script.contentHash,
  };
}

test("script chunk planning never splits a UTF-16 surrogate pair", () => {
  const source = "ab😀cd😀ef";
  const ranges = planScriptChunks(source, 3);
  const rebuilt = ranges.map((range) => source.slice(range.start, range.end)).join("");
  assert.equal(rebuilt, source);
  for (const range of ranges.slice(0, -1)) {
    const last = source.charCodeAt(range.end - 1);
    assert.equal(last >= 0xD800 && last <= 0xDBFF, false);
  }
  assert.deepEqual(planScriptChunks("", 3), [{ start: 0, end: 0 }]);
});

test("script transfer applies ordered chunks only after byte and SHA-256 verification", async () => {
  const source = "const greeting = '狐神 😀';\n".repeat(20_000);
  const script = descriptor(source);
  let loaded = "";
  const transfer = manager((value) => { loaded = value; });
  const ranges = planScriptChunks(source, 32_768);
  transfer.begin(beginPayload(script, ranges.length));
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    const bytes = encoder.encode(source.slice(range.start, range.end));
    transfer.append({ transferId: "transfer-1", index, bytes: bytes.buffer });
  }
  await transfer.commit({ transferId: "transfer-1" });
  assert.equal(loaded, source);
  assert.equal(transfer.activeCount, 0);
});

test("script transfer rejects out-of-order, incomplete, oversized, and tampered input", async () => {
  const source = "console.log('verified');";
  const script = descriptor(source);

  const outOfOrder = manager(() => undefined);
  outOfOrder.begin(beginPayload(script, 2));
  assert.throws(
    () => outOfOrder.append({ transferId: "transfer-1", index: 1, bytes: encoder.encode("a").buffer }),
    /Expected script chunk 0/,
  );
  assert.equal(outOfOrder.activeCount, 0);

  const incomplete = manager(() => undefined);
  incomplete.begin(beginPayload(script, 2));
  incomplete.append({ transferId: "transfer-1", index: 0, bytes: encoder.encode(source).buffer });
  await assert.rejects(incomplete.commit({ transferId: "transfer-1" }), /incomplete/);
  assert.equal(incomplete.activeCount, 0);

  const oversized = manager(() => undefined, 2);
  oversized.begin(beginPayload(script, 1));
  assert.throws(
    () => oversized.append({ transferId: "transfer-1", index: 0, bytes: encoder.encode(source).buffer }),
    /chunk exceeds 2 bytes/,
  );
  assert.equal(oversized.activeCount, 0);

  let tamperedLoaded = false;
  const tamperedScript = { ...script, contentHash: "0".repeat(64) };
  const tampered = manager(() => { tamperedLoaded = true; });
  tampered.begin(beginPayload(tamperedScript, 1));
  tampered.append({ transferId: "transfer-1", index: 0, bytes: encoder.encode(source).buffer });
  await assert.rejects(tampered.commit({ transferId: "transfer-1" }), /SHA-256 mismatch/);
  assert.equal(tamperedLoaded, false);
  assert.equal(tampered.activeCount, 0);
});

test("browser-side transfer uses acknowledged chunks and cancels an interrupted upload", async () => {
  const source = "globalThis.largeFixture = true;\n".repeat(24_000);
  const script = descriptor(source);
  let loaded = "";
  const transfer = manager((value) => { loaded = value; });
  let chunks = 0;
  const port = {
    async request(type: PreviewRequestType, payload?: unknown): Promise<void> {
      if (type === "script:transfer-begin") transfer.begin(payload);
      else if (type === "script:transfer-chunk") { transfer.append(payload); chunks += 1; }
      else if (type === "script:transfer-commit") await transfer.commit(payload);
      else if (type === "script:transfer-cancel") transfer.cancel(payload);
      else throw new Error(`Unexpected request: ${type}`);
    },
  };
  const result = await transferProjectScript(port, script, source, () => false);
  assert.equal(loaded, source);
  assert.equal(result.chunkCount, chunks);
  assert.equal(result.transferredBytes, script.byteLength);
  assert.ok(result.chunkCount > 1);

  let cancelAfterFirstChunk = false;
  const cancelledTransfer = manager(() => assert.fail("cancelled script must not execute"));
  const cancellingPort = {
    async request(type: PreviewRequestType, payload?: unknown): Promise<void> {
      if (type === "script:transfer-begin") cancelledTransfer.begin(payload);
      else if (type === "script:transfer-chunk") {
        cancelledTransfer.append(payload);
        cancelAfterFirstChunk = true;
      } else if (type === "script:transfer-cancel") cancelledTransfer.cancel(payload);
      else if (type === "script:transfer-commit") await cancelledTransfer.commit(payload);
    },
  };
  await assert.rejects(
    transferProjectScript(cancellingPort, script, source, () => cancelAfterFirstChunk),
    PreviewScriptTransferCancelledError,
  );
  assert.equal(cancelledTransfer.activeCount, 0);
});
