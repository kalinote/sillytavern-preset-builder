import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiError } from "../src/errors.js";
import { ProjectStore } from "../src/project-store.js";
import type { JsonObject, JsonValue } from "../src/types.js";

function fixturePreset(): JsonObject {
  const regexes: JsonValue[] = [
    {
      id: "regex-one",
      scriptName: "Card frame",
      disabled: false,
      runOnEdit: true,
      findRegex: "/<card>([\\s\\S]*?)<\\/card>/g",
      replaceString: "<section class=\"card\">$1</section>",
      placement: [2],
      minDepth: null,
      maxDepth: 0,
    },
  ];
  const spreset: JsonObject = {
    ChatSquash: { enabled: false },
    RegexBinding: { active: true, enabled: true, regexes: structuredClone(regexes) },
  };
  return {
    temperature: 0,
    send_if_empty: "",
    nullable_unknown: null,
    empty_unknown: [],
    unknown_top_level: { keep: true, nested: { value: 7 } },
    prompts: [
      {
        identifier: "main",
        name: "Main prompt",
        enabled: false,
        role: "system",
        content: "First line\nSecond line",
        unknown_prompt_field: { preserve: 0 },
      },
      {
        identifier: "SPresetSettings",
        name: "SPreset config",
        enabled: false,
        content: JSON.stringify(spreset),
      },
      {
        identifier: "marker",
        name: "Chat history",
        marker: true,
        content: "",
      },
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: "main", enabled: true },
          { identifier: "marker", enabled: false },
        ],
      },
    ],
    extensions: {
      unknown_extension: { falseValue: false, empty: {} },
      regex_scripts: structuredClone(regexes),
      SPreset: spreset,
      tavern_helper: {
        variables: { global: { answer: 42 } },
        scripts: [
          {
            type: "script",
            id: "script-one",
            name: "Runtime helper",
            enabled: true,
            content: "export function main() {\n  return 'ok';\n}\n",
            data: {},
          },
        ],
      },
    },
  };
}

async function withStore(run: (store: ProjectStore, root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-store-"));
  try {
    const store = new ProjectStore(root);
    await store.initialize();
    await run(store, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("import splits and rebuilds a preset with deep semantic equality", async () => {
  await withStore(async (store, root) => {
    const preset = fixturePreset();
    const manifest = await store.importProject({ name: "Round trip", version: "v1", preset });
    assert.equal(manifest.managedPaths.prompts, true);
    assert.equal(manifest.managedPaths.regex, true);
    assert.equal(manifest.managedPaths.scripts, true);
    assert.deepEqual(manifest.regexMirrorBinding?.targets, [
      "extensions.regex_scripts",
      "extensions.SPreset.RegexBinding.regexes",
      "prompts[1].content.RegexBinding.regexes",
    ]);

    const built = await store.buildProject(manifest.id);
    assert.deepEqual(built.preset, preset);
    assert.equal(built.diagnostics.length, 0);

    const base = JSON.parse(await readFile(join(root, manifest.id, "preset.base.json"), "utf8")) as JsonObject;
    assert.deepEqual(base.unknown_top_level, preset.unknown_top_level);
    assert.deepEqual((base.extensions as JsonObject).unknown_extension, (preset.extensions as JsonObject).unknown_extension);
    assert.deepEqual((base.extensions as JsonObject).regex_scripts, []);

    const files = await store.listFiles(manifest.id);
    assert(files.some((entry) => entry.path.endsWith("/content.md")));
    assert(files.some((entry) => entry.path.endsWith("/replace.html")));
    assert(files.some((entry) => entry.path.endsWith("/content.js")));
  });
});

test("single-file saves are atomic, revision-aware, and affect the next build", async () => {
  await withStore(async (store) => {
    const manifest = await store.importProject({ name: "Edit test", preset: fixturePreset() });
    const promptIndexFile = await store.readProjectFile(manifest.id, "prompts/index.json");
    const promptIndex = JSON.parse(promptIndexFile.content) as { items: Array<{ uid: string; identifier?: string }> };
    const mainPrompt = promptIndex.items.find((item) => item.identifier === "main");
    assert(mainPrompt);
    const contentPath = `prompts/${mainPrompt.uid}/content.md`;
    const before = await store.readProjectFile(manifest.id, contentPath);
    assert.equal(before.content, "First line\nSecond line");

    const after = await store.saveProjectFile(manifest.id, contentPath, {
      content: "Edited prompt",
      ifRevision: before.revision,
    });
    assert.notEqual(after.revision, before.revision);
    assert.equal(after.content, "Edited prompt");

    await assert.rejects(
      store.saveProjectFile(manifest.id, contentPath, {
        content: "Stale write",
        ifRevision: before.revision,
      }),
      (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === "REVISION_CONFLICT",
    );

    const built = await store.buildProject(manifest.id);
    const prompts = built.preset.prompts as JsonObject[];
    assert.equal(prompts.find((prompt) => prompt.identifier === "main")?.content, "Edited prompt");
  });
});

test("project file paths cannot escape the project directory", async () => {
  await withStore(async (store) => {
    const manifest = await store.createEmptyProject({ name: "Traversal" });
    for (const path of ["../secret.txt", "%2e%2e/secret.txt", "C:\\Windows\\win.ini", "prompts//meta.json"]) {
      await assert.rejects(
        store.readProjectFile(manifest.id, path),
        (error: unknown) => error instanceof ApiError && error.code === "INVALID_PATH",
      );
    }
  });
});

test("export writes a unique timestamped JSON artifact", async () => {
  await withStore(async (store) => {
    const preset = fixturePreset();
    const manifest = await store.importProject({ name: "Fox / preset", version: "V 1", preset });
    const first = await store.exportProject(manifest.id);
    const second = await store.exportProject(manifest.id);
    assert.match(first.filename, /^Fox - preset-V 1-\d{8}-\d{6}\.json$/);
    assert.notEqual(second.filename, first.filename);
    const downloaded = await store.readOutput(manifest.id, first.filename);
    assert.deepEqual(JSON.parse(downloaded.content.toString("utf8")), preset);
  });
});

test("file listing exposes stable named directories while keeping UUID paths", async () => {
  await withStore(async (store) => {
    const preset = fixturePreset();
    preset.prompts = [
      { identifier: "one", name: "重复", content: "One" },
      { identifier: "two", name: "重复", content: "Two" },
      { identifier: "three", name: "重复 (2)", content: "Three" },
      { identifier: "fallback", content: "Four" },
      { content: "Five" },
      { identifier: "emoji", name: "中文/Emoji ⚡", content: "Six" },
    ];
    preset.prompt_order = [{ character_id: 100001, order: [] }];
    const manifest = await store.importProject({ name: "Display names", preset });
    const files = await store.listFiles(manifest.id);
    const source = files.find((entry) => entry.role === "source-json");
    assert.deepEqual(source, {
      path: "preset.json",
      type: "file",
      size: 0,
      updatedAt: manifest.updatedAt,
      displayName: "preset.json",
      order: -1,
      role: "source-json",
    });

    const promptDirectories = files
      .filter((entry) => entry.type === "directory" && /^prompts\/[^/]+$/.test(entry.path))
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    assert.deepEqual(promptDirectories.map((entry) => entry.displayName), [
      "重复",
      "重复 (2)",
      "重复 (2) (2)",
      "fallback",
      "未命名 Prompt 5",
      "中文/Emoji ⚡",
    ]);
    assert(promptDirectories.every((entry) => /^prompts\/[0-9a-f-]{36}$/.test(entry.path)));

    const regexDirectory = files.find(
      (entry) => entry.type === "directory" && /^regex\/[^/]+$/.test(entry.path),
    );
    const scriptDirectory = files.find(
      (entry) => entry.type === "directory" && /^scripts\/[^/]+$/.test(entry.path),
    );
    assert.equal(regexDirectory?.displayName, "Card frame");
    assert.equal(regexDirectory?.order, 0);
    assert.equal(scriptDirectory?.displayName, "Runtime helper");
    assert.equal(scriptDirectory?.order, 0);
  });
});

test("complete source JSON can atomically replace split sources and preserve project history", async () => {
  await withStore(async (store) => {
    const preset = fixturePreset();
    const manifest = await store.importProject({
      name: "Complete source",
      version: "v1",
      sourceType: "sillytavern",
      sourcePresetName: "Remote source",
      sourceStVersion: "1.18.0",
      preset,
    });
    const originalHash = manifest.originalJsonSha256;
    const exported = await store.exportProject(manifest.id);
    const firstSource = await store.readSourceJson(manifest.id);
    assert.deepEqual(JSON.parse(firstSource.content), preset);

    const promptIndexFile = await store.readProjectFile(manifest.id, "prompts/index.json");
    const promptIndex = JSON.parse(promptIndexFile.content) as { items: Array<{ uid: string; identifier?: string }> };
    const main = promptIndex.items.find((item) => item.identifier === "main");
    assert(main);
    const contentPath = `prompts/${main.uid}/content.md`;
    const contentFile = await store.readProjectFile(manifest.id, contentPath);
    await store.saveProjectFile(manifest.id, contentPath, {
      content: "Edited before full source",
      ifRevision: contentFile.revision,
    });
    const currentSource = await store.readSourceJson(manifest.id);
    const replacement = JSON.parse(currentSource.content) as JsonObject;
    const prompts = replacement.prompts as JsonObject[];
    prompts.reverse();
    prompts.push({ identifier: "new", name: "新增/条目 ⚡", content: "New content" });
    (prompts.find((prompt) => prompt.identifier === "main") as JsonObject).name = "Renamed main";

    const applied = await store.replaceSourceJson(manifest.id, {
      content: JSON.stringify(replacement),
      ifRevision: currentSource.revision,
    });
    assert.deepEqual(JSON.parse(applied.content), replacement);
    assert.deepEqual((await store.buildProject(manifest.id)).preset, replacement);
    const updatedManifest = await store.getProject(manifest.id);
    assert.equal(updatedManifest.id, manifest.id);
    assert.equal(updatedManifest.name, manifest.name);
    assert.equal(updatedManifest.version, manifest.version);
    assert.equal(updatedManifest.createdAt, manifest.createdAt);
    assert.deepEqual(updatedManifest.source, manifest.source);
    assert.equal(updatedManifest.targetPresetName, manifest.targetPresetName);
    assert.equal(updatedManifest.originalJsonSha256, originalHash);
    assert(await store.readOutput(manifest.id, exported.filename));

    await assert.rejects(
      store.replaceSourceJson(manifest.id, {
        content: JSON.stringify(replacement),
        ifRevision: firstSource.revision,
      }),
      (error: unknown) => error instanceof ApiError && error.code === "REVISION_CONFLICT",
    );
    const beforeInvalid = await store.buildProject(manifest.id);
    await assert.rejects(
      store.replaceSourceJson(manifest.id, {
        content: "{",
        ifRevision: applied.revision,
      }),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_SOURCE_JSON",
    );
    await assert.rejects(
      store.replaceSourceJson(manifest.id, {
        content: JSON.stringify({ prompts: [] }),
        ifRevision: applied.revision,
      }),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_PRESET",
    );
    assert.deepEqual((await store.buildProject(manifest.id)).preset, beforeInvalid.preset);
  });
});

test("project deletion is serialized with writes and never affects other projects", async () => {
  await withStore(async (store) => {
    const deleted = await store.importProject({ name: "Delete me", preset: fixturePreset() });
    const survivor = await store.importProject({ name: "Keep me", preset: fixturePreset() });
    const index = await store.readProjectFile(deleted.id, "prompts/index.json");
    const save = store.saveProjectFile(deleted.id, "prompts/index.json", {
      content: index.content,
      ifRevision: index.revision,
    });
    const remove = store.deleteProject(deleted.id);
    await Promise.all([save, remove]);

    assert.deepEqual((await store.listProjects()).map((project) => project.id), [survivor.id]);
    await assert.rejects(
      store.getProject(deleted.id),
      (error: unknown) => error instanceof ApiError && error.code === "PROJECT_NOT_FOUND",
    );
    await assert.rejects(
      store.deleteProject(deleted.id),
      (error: unknown) => error instanceof ApiError && error.code === "PROJECT_NOT_FOUND",
    );
    assert.equal((await store.buildProject(survivor.id)).preset.prompts !== undefined, true);
    await assert.rejects(
      store.deleteProject("../outside"),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_PROJECT_ID",
    );
  });
});

test("schema v2 structure mutations preserve unknown fields and enforce prompt references", async () => {
  await withStore(async (store, root) => {
    const manifest = await store.importProject({ name: "Structure", preset: fixturePreset() });
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(
      JSON.parse(await readFile(join(root, manifest.id, "snapshots", "index.json"), "utf8")),
      { schemaVersion: 1, items: [] },
    );

    let structure = await store.getProjectStructure(manifest.id);
    assert.equal(structure.prompts.length, 3);
    assert.equal(structure.regex.length, 1);
    assert.equal(structure.scripts.length, 1);

    const duplicated = await store.mutateProjectStructure(manifest.id, {
      ifRevision: structure.revision,
      mutation: { op: "duplicate", kind: "prompt", uid: structure.prompts[0]!.uid },
    });
    assert(duplicated.createdUid);
    const duplicate = duplicated.structure.prompts.find((item) => item.uid === duplicated.createdUid);
    assert.equal(duplicate?.name, "Main prompt 副本");
    assert.equal(duplicate?.identifier, "main-2");
    const duplicateMeta = JSON.parse(
      await readFile(join(root, manifest.id, "prompts", duplicated.createdUid, "meta.json"), "utf8"),
    ) as JsonObject;
    assert.deepEqual(duplicateMeta.unknown_prompt_field, { preserve: 0 });

    const patched = await store.mutateProjectStructure(manifest.id, {
      ifRevision: duplicated.structure.revision,
      mutation: {
        op: "patch",
        kind: "prompt",
        uid: structure.prompts[0]!.uid,
        patch: { name: "Renamed", identifier: "renamed-main", enabled: true },
      },
    });
    const promptOrder = patched.structure.promptOrder as JsonObject[];
    assert.equal(((promptOrder[0]!.order as JsonObject[])[0]!.identifier), "renamed-main");
    const patchedMeta = JSON.parse(
      await readFile(join(root, manifest.id, "prompts", structure.prompts[0]!.uid, "meta.json"), "utf8"),
    ) as JsonObject;
    assert.deepEqual(patchedMeta.unknown_prompt_field, { preserve: 0 });

    await assert.rejects(
      store.mutateProjectStructure(manifest.id, {
        ifRevision: patched.structure.revision,
        mutation: { op: "delete", kind: "prompt", uid: structure.prompts[0]!.uid },
      }),
      (error: unknown) => error instanceof ApiError && error.code === "PROMPT_ORDER_REFERENCE_EXISTS",
    );
    const removed = await store.mutateProjectStructure(manifest.id, {
      ifRevision: patched.structure.revision,
      mutation: {
        op: "delete",
        kind: "prompt",
        uid: structure.prompts[0]!.uid,
        removePromptOrderReferences: true,
      },
    });
    assert.equal(removed.snapshot?.reason, "before-item-delete");
    assert.equal(removed.structure.prompts.some((item) => item.uid === structure.prompts[0]!.uid), false);

    const createdRegex = await store.mutateProjectStructure(manifest.id, {
      ifRevision: removed.structure.revision,
      mutation: { op: "create", kind: "regex" },
    });
    assert.equal(createdRegex.structure.regex.length, 2);
    const createdScript = await store.mutateProjectStructure(manifest.id, {
      ifRevision: createdRegex.structure.revision,
      mutation: { op: "create", kind: "script" },
    });
    assert.equal(createdScript.structure.scripts.length, 2);
    await assert.rejects(
      store.mutateProjectStructure(manifest.id, {
        ifRevision: createdScript.structure.revision,
        mutation: { op: "reorder", kind: "script", uids: [] },
      }),
      (error: unknown) => error instanceof ApiError && error.code === "INVALID_STRUCTURE_MUTATION",
    );
  });
});

test("snapshots restore complete presets and project settings use optimistic concurrency", async () => {
  await withStore(async (store) => {
    const manifest = await store.importProject({ name: "History", preset: fixturePreset() });
    const initial = await store.getProjectStructure(manifest.id);
    const manual = await store.createSnapshot(manifest.id, {
      label: "Initial state",
      ifRevision: initial.revision,
    });
    assert.equal(manual.kind, "manual");

    const mainPrompt = initial.prompts.find((item) => item.identifier === "main");
    assert(mainPrompt);
    const contentPath = `prompts/${mainPrompt.uid}/content.md`;
    const content = await store.readProjectFile(manifest.id, contentPath);
    await store.saveProjectFile(manifest.id, contentPath, {
      content: "Changed after snapshot",
      ifRevision: content.revision,
    });
    const changed = await store.buildProject(manifest.id);
    assert.notEqual(changed.revision, initial.revision);

    const restored = await store.restoreSnapshot(manifest.id, manual.uid, { ifRevision: changed.revision });
    assert.deepEqual(restored.build.preset, fixturePreset());
    const snapshots = await store.listSnapshots(manifest.id);
    assert.equal(snapshots.some((item) => item.uid === manual.uid), true);
    assert.equal(snapshots.some((item) => item.reason === "before-snapshot-restore"), true);
    await store.deleteSnapshot(manifest.id, manual.uid);
    assert.equal((await store.listSnapshots(manifest.id)).some((item) => item.uid === manual.uid), false);

    const beforeSettings = await store.getProject(manifest.id);
    const updated = await store.updateProject(manifest.id, {
      ifProjectRevision: beforeSettings.updatedAt,
      name: "History renamed",
      version: "v2",
      targetPresetName: "Remote target",
    });
    assert.equal(updated.name, "History renamed");
    assert.equal(updated.version, "v2");
    assert.equal(updated.targetPresetName, "Remote target");
    await assert.rejects(
      store.updateProject(manifest.id, {
        ifProjectRevision: beforeSettings.updatedAt,
        name: "Stale",
      }),
      (error: unknown) => error instanceof ApiError && error.code === "PROJECT_REVISION_CONFLICT",
    );
  });
});
