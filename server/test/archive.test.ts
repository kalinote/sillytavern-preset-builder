import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { ApiError } from "../src/errors.js";
import { ProjectStore } from "../src/project-store.js";
import type { JsonObject } from "../src/types.js";

function presetFixture(): JsonObject {
  return {
    temperature: 0,
    prompts: [
      {
        identifier: "main",
        name: "Main",
        enabled: false,
        content: "Archive fixture\n第二行",
        role: "system",
        unknown: { keep: true },
      },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    extensions: { unknown: { nullable: null } },
  };
}

async function withStore(run: (store: ProjectStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-archive-"));
  try {
    const store = new ProjectStore(root);
    await store.initialize();
    await run(store, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("project ZIP download and import preserve the split project and always regenerate id", async () => {
  await withStore(async (store) => {
    const sourcePreset = presetFixture();
    const source = await store.importProject({ name: "Archive source", version: "v1", preset: sourcePreset });
    await store.saveProjectFile(source.id, "notes/readme.txt", { content: "Preserved unknown project file" });
    const archive = await store.buildProjectArchive(source.id);
    assert.match(archive.filename, /^Archive source-v1-project\.zip$/);
    assert(archive.content.byteLength > 0);

    const imported = await store.importProjectArchive(archive.content, { name: "Imported copy", version: "v2" });
    assert.notEqual(imported.project.id, source.id);
    assert.equal(imported.originalProjectId, source.id);
    assert.equal(imported.idRegenerated, true);
    assert.equal(imported.project.name, "Imported copy");
    assert.equal(imported.project.version, "v2");
    assert.equal(imported.project.source.type, "project-package");
    assert.equal(imported.project.preview.javascriptEnabled, true);
    assert.equal((await store.readProjectFile(imported.project.id, "notes/readme.txt")).content, "Preserved unknown project file");
    assert.deepEqual((await store.buildProject(imported.project.id)).preset, sourcePreset);

    const forcedDisabled = await store.importProjectArchive(archive.content, {
      javascriptPolicy: "force-disabled",
    });
    assert.equal(forcedDisabled.project.preview.javascriptEnabled, false);

    const projects = await store.listProjects();
    assert.equal(projects.length, 3);
    assert(!projects.some((project) => project.id === ".staging"));
  });
});

test("ZIP extraction rejects Zip Slip and never writes outside staging", async () => {
  await withStore(async (store, root) => {
    const malicious = zipSync({
      "../escaped.txt": strToU8("must not be written"),
      "project.json": strToU8("{}"),
    });
    await assert.rejects(
      store.importProjectArchive(malicious),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_ARCHIVE_PATH",
    );
    await assert.rejects(readFile(join(root, "escaped.txt")), /ENOENT/);
    assert.equal((await store.listProjects()).length, 0);
  });
});

test("ZIP import requires project.json at archive root", async () => {
  await withStore(async (store) => {
    const wrapped = zipSync({ "wrapped/project.json": strToU8("{}") });
    await assert.rejects(
      store.importProjectArchive(wrapped),
      (error: unknown) => error instanceof ApiError && error.code === "PROJECT_MANIFEST_REQUIRED",
    );
  });
});

test("ZIP import enforces entry, per-file, and total unpacked limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-archive-limits-"));
  try {
    const entryLimited = new ProjectStore(join(root, "entries"), {
      maxArchiveBytes: 1024 * 1024,
      maxUnpackedBytes: 1024 * 1024,
      maxFileBytes: 1024 * 1024,
      maxEntries: 2,
    });
    const tooMany = zipSync({
      "project.json": strToU8("{}"),
      "one.txt": strToU8("1"),
      "two.txt": strToU8("2"),
    });
    await assert.rejects(
      entryLimited.importProjectArchive(tooMany),
      (error: unknown) => error instanceof ApiError && error.code === "ARCHIVE_ENTRY_LIMIT",
    );

    const fileLimited = new ProjectStore(join(root, "files"), {
      maxArchiveBytes: 1024 * 1024,
      maxUnpackedBytes: 128,
      maxFileBytes: 8,
      maxEntries: 10,
    });
    const oversized = zipSync({
      "project.json": strToU8("0123456789"),
    });
    await assert.rejects(
      fileLimited.importProjectArchive(oversized),
      (error: unknown) => error instanceof ApiError && error.code === "ARCHIVE_FILE_TOO_LARGE",
    );

    const totalLimited = new ProjectStore(join(root, "total"), {
      maxArchiveBytes: 1024 * 1024,
      maxUnpackedBytes: 12,
      maxFileBytes: 10,
      maxEntries: 10,
    });
    const excessiveTotal = zipSync({
      "project.json": strToU8("12345678"),
      "extra.txt": strToU8("12345678"),
    });
    await assert.rejects(
      totalLimited.importProjectArchive(excessiveTotal),
      (error: unknown) => error instanceof ApiError && error.code === "ARCHIVE_UNPACKED_TOO_LARGE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
