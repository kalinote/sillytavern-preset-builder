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
