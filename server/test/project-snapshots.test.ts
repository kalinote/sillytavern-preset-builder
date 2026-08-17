import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectSnapshot, listProjectSnapshots } from "../src/project-snapshots.js";
import type { BuildResult } from "../src/types.js";

function buildResult(revision: string): BuildResult {
  return {
    preset: { prompts: [], prompt_order: [] },
    diagnostics: [],
    revision,
    size: revision.length,
  };
}

test("automatic snapshot retention keeps the newest 20 and preserves manual snapshots", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "preset-studio-snapshots-"));
  const snapshotsRoot = join(projectRoot, "snapshots");
  await mkdir(snapshotsRoot);
  await writeFile(join(snapshotsRoot, "index.json"), '{"schemaVersion":1,"items":[]}\n', "utf8");

  try {
    const manual = await createProjectSnapshot(projectRoot, buildResult("manual"), {
      label: "Manual baseline",
      reason: "manual",
    });
    const automaticIds: string[] = [];
    for (let index = 0; index < 22; index += 1) {
      const snapshot = await createProjectSnapshot(projectRoot, buildResult(`auto-${index}`), {
        label: `Automatic ${index}`,
        reason: "before-item-delete",
      });
      automaticIds.push(snapshot.uid);
    }

    const snapshots = await listProjectSnapshots(projectRoot);
    assert.equal(snapshots.filter((snapshot) => snapshot.kind === "automatic").length, 20);
    assert.equal(snapshots.some((snapshot) => snapshot.uid === manual.uid), true);
    assert.equal(snapshots.some((snapshot) => snapshot.uid === automaticIds[0]), false);
    assert.equal(snapshots.some((snapshot) => snapshot.uid === automaticIds[1]), false);
    await assert.rejects(access(join(snapshotsRoot, automaticIds[0])));
    await assert.rejects(access(join(snapshotsRoot, automaticIds[1])));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
