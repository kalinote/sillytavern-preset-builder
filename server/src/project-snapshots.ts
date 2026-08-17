import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic.js";
import { ApiError } from "./errors.js";
import { isJsonObject, stringifyJson } from "./json.js";
import type {
  BuildResult,
  JsonObject,
  JsonValue,
  ProjectSnapshotSummary,
  SnapshotIndex,
  SnapshotReason,
} from "./types.js";

const AUTOMATIC_SNAPSHOT_LIMIT = 20;

function snapshotLabel(reason: SnapshotReason): string {
  switch (reason) {
    case "before-item-delete": return "删除条目前";
    case "before-source-json-apply": return "应用完整 JSON 前";
    case "before-snapshot-restore": return "恢复快照前";
    default: return "手动快照";
  }
}

export function assertSnapshotId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, "INVALID_SNAPSHOT_ID", "Invalid snapshot id");
  }
  return value;
}

async function readSnapshotIndex(projectRoot: string): Promise<SnapshotIndex> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(projectRoot, "snapshots", "index.json"), "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiError(422, "INVALID_SNAPSHOT_INDEX", "snapshots/index.json is missing");
    }
    throw new ApiError(422, "INVALID_SNAPSHOT_INDEX", "snapshots/index.json is not valid JSON");
  }
  if (!isJsonObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.items)) {
    throw new ApiError(422, "INVALID_SNAPSHOT_INDEX", "snapshots/index.json has an unsupported structure");
  }
  return value as unknown as SnapshotIndex;
}

async function writeSnapshotIndex(projectRoot: string, index: SnapshotIndex): Promise<void> {
  await atomicWriteFile(join(projectRoot, "snapshots", "index.json"), stringifyJson(index as unknown as JsonValue));
}

export async function listProjectSnapshots(projectRoot: string): Promise<ProjectSnapshotSummary[]> {
  return structuredClone((await readSnapshotIndex(projectRoot)).items);
}

export async function createProjectSnapshot(
  projectRoot: string,
  build: BuildResult,
  input: { label?: string; reason: SnapshotReason },
): Promise<ProjectSnapshotSummary> {
  const label = input.label?.trim() || snapshotLabel(input.reason);
  if (label.length > 120) throw new ApiError(400, "INVALID_INPUT", "Snapshot label is too long");
  const index = await readSnapshotIndex(projectRoot);
  const createdAt = new Date().toISOString();
  const summary: ProjectSnapshotSummary = {
    uid: randomUUID(),
    label,
    kind: input.reason === "manual" ? "manual" : "automatic",
    reason: input.reason,
    createdAt,
    presetRevision: build.revision,
    size: build.size,
  };
  const snapshotRoot = join(projectRoot, "snapshots", summary.uid);
  await mkdir(snapshotRoot, { recursive: false });
  try {
    await Promise.all([
      atomicWriteFile(join(snapshotRoot, "meta.json"), stringifyJson(summary as unknown as JsonValue)),
      atomicWriteFile(join(snapshotRoot, "preset.json"), stringifyJson(build.preset)),
    ]);
    index.items.push(summary);

    const automatic = index.items
      .filter((item) => item.kind === "automatic")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const expired = automatic.slice(0, Math.max(0, automatic.length - AUTOMATIC_SNAPSHOT_LIMIT));
    const expiredIds = new Set(expired.map((item) => item.uid));
    if (expiredIds.size > 0) index.items = index.items.filter((item) => !expiredIds.has(item.uid));
    await writeSnapshotIndex(projectRoot, index);
    await Promise.all(
      expired.map((item) => rm(join(projectRoot, "snapshots", item.uid), { recursive: true, force: true })),
    );
    return structuredClone(summary);
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readSnapshotPreset(projectRoot: string, snapshotId: string): Promise<JsonObject> {
  const id = assertSnapshotId(snapshotId);
  const index = await readSnapshotIndex(projectRoot);
  if (!index.items.some((item) => item.uid === id)) {
    throw new ApiError(404, "SNAPSHOT_NOT_FOUND", "Snapshot does not exist");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(projectRoot, "snapshots", id, "preset.json"), "utf8")) as unknown;
  } catch {
    throw new ApiError(422, "INVALID_SNAPSHOT", "Snapshot preset is not valid JSON");
  }
  if (!isJsonObject(value)) throw new ApiError(422, "INVALID_SNAPSHOT", "Snapshot preset root must be an object");
  return value;
}

export async function deleteProjectSnapshot(projectRoot: string, snapshotId: string): Promise<void> {
  const id = assertSnapshotId(snapshotId);
  const index = await readSnapshotIndex(projectRoot);
  const nextItems = index.items.filter((item) => item.uid !== id);
  if (nextItems.length === index.items.length) {
    throw new ApiError(404, "SNAPSHOT_NOT_FOUND", "Snapshot does not exist");
  }
  index.items = nextItems;
  await writeSnapshotIndex(projectRoot, index);
  await rm(join(projectRoot, "snapshots", id), { recursive: true, force: true });
}
