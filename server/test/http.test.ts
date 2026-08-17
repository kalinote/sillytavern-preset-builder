import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiServer } from "../src/http.js";

function minimalPreset() {
  return {
    temperature: 1,
    prompts: [{ identifier: "main", name: "Main", content: "Hello", role: "system" }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
    extensions: { unknown: { keep: true } },
  };
}

test("HTTP project lifecycle supports JSON import, file access, build, and export", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-http-"));
  const { server } = createApiServer({ workspaceRoot: root, staticRoot: false });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;

    const importedResponse = await fetch(`${base}/api/projects/import/json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "API fixture", version: "1", preset: minimalPreset() }),
    });
    assert.equal(importedResponse.status, 201);
    const imported = await importedResponse.json() as { project: { id: string } };
    assert.match(imported.project.id, /^project-/);

    const filesResponse = await fetch(`${base}/api/projects/${imported.project.id}/files`);
    assert.equal(filesResponse.status, 200);
    const files = await filesResponse.json() as { files: Array<{ path: string; type: string }> };
    const contentFile = files.files.find((entry) => entry.type === "file" && entry.path.endsWith("/content.md"));
    assert(contentFile);

    const fileResponse = await fetch(
      `${base}/api/projects/${imported.project.id}/files/${contentFile.path.split("/").map(encodeURIComponent).join("/")}`,
    );
    const file = await fileResponse.json() as { content: string; revision: string };
    assert.equal(file.content, "Hello");

    const saveResponse = await fetch(
      `${base}/api/projects/${imported.project.id}/files/${contentFile.path.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Hello API", ifRevision: file.revision }),
      },
    );
    assert.equal(saveResponse.status, 200);

    const buildResponse = await fetch(`${base}/api/projects/${imported.project.id}/build`, { method: "POST" });
    assert.equal(buildResponse.status, 200);
    const build = await buildResponse.json() as { success: boolean; preset: { prompts: Array<{ content: string }> } };
    assert.equal(build.success, true);
    assert.equal(build.preset.prompts[0]?.content, "Hello API");

    const reservedSourceWrite = await fetch(
      `${base}/api/projects/${imported.project.id}/files/preset.json`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "{}" }),
      },
    );
    assert.equal(reservedSourceWrite.status, 400);
    assert.equal(
      (await reservedSourceWrite.json() as { error: { code: string } }).error.code,
      "RESERVED_SOURCE_PATH",
    );

    const sourceResponse = await fetch(`${base}/api/projects/${imported.project.id}/source-json`);
    assert.equal(sourceResponse.status, 200);
    const source = await sourceResponse.json() as { content: string; revision: string; role: string };
    assert.equal(source.role, "source-json");
    const completePreset = JSON.parse(source.content) as ReturnType<typeof minimalPreset>;
    completePreset.prompts[0]!.content = "Hello complete JSON";
    const appliedSourceResponse = await fetch(`${base}/api/projects/${imported.project.id}/source-json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: JSON.stringify(completePreset), ifRevision: source.revision }),
    });
    assert.equal(appliedSourceResponse.status, 200);

    const exportResponse = await fetch(`${base}/api/projects/${imported.project.id}/export`, { method: "POST" });
    assert.equal(exportResponse.status, 201);
    const exported = await exportResponse.json() as { downloadUrl: string; filename: string };
    const downloadResponse = await fetch(`${base}${exported.downloadUrl}`);
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get("content-disposition") ?? "", /attachment/);
    const downloaded = await downloadResponse.json() as { prompts: Array<{ content: string }> };
    assert.equal(downloaded.prompts[0]?.content, "Hello complete JSON");

    const archiveResponse = await fetch(`${base}/api/projects/${imported.project.id}/archive`);
    assert.equal(archiveResponse.status, 200);
    assert.equal(archiveResponse.headers.get("content-type"), "application/zip");
    assert.match(archiveResponse.headers.get("content-disposition") ?? "", /attachment/);
    const archiveBytes = await archiveResponse.arrayBuffer();
    const form = new FormData();
    form.append("file", new Blob([archiveBytes], { type: "application/zip" }), "project.zip");
    form.append("name", "HTTP archive copy");
    form.append("version", "v2");
    const archiveImportResponse = await fetch(`${base}/api/projects/import/archive`, {
      method: "POST",
      body: form,
    });
    assert.equal(archiveImportResponse.status, 201);
    const archiveImport = await archiveImportResponse.json() as {
      project: { id: string; name: string; version: string };
      import: { originalProjectId: string; idRegenerated: boolean };
    };
    assert.notEqual(archiveImport.project.id, imported.project.id);
    assert.equal(archiveImport.project.name, "HTTP archive copy");
    assert.equal(archiveImport.project.version, "v2");
    assert.equal(archiveImport.import.originalProjectId, imported.project.id);
    assert.equal(archiveImport.import.idRegenerated, true);

    const deleteResponse = await fetch(`${base}/api/projects/${imported.project.id}`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 204);
    assert.equal(await deleteResponse.text(), "");
    assert.equal((await fetch(`${base}/api/projects/${imported.project.id}`)).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${imported.project.id}/files`)).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${imported.project.id}/source-json`)).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${imported.project.id}/build`, { method: "POST" })).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${imported.project.id}/archive`)).status, 404);
    assert.equal((await fetch(`${base}/api/projects/${archiveImport.project.id}`)).status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP errors have a stable envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-http-errors-"));
  const { server } = createApiServer({ workspaceRoot: root, staticRoot: false, bodyLimitBytes: 128 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects/import/json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preset: { prompts: [] } }),
    });
    assert.equal(response.status, 422);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, "INVALID_PRESET");
    assert(body.error.message.length > 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP origin policy allows same-origin, explicit origins, proxy same-origin, and CLI only", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-http-origin-"));
  const allowedOrigin = "https://studio.example";
  const { server } = createApiServer({
    workspaceRoot: root,
    staticRoot: false,
    allowedOrigins: [allowedOrigin],
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;

    const cliHealth = await fetch(`${base}/api/health`);
    assert.equal(cliHealth.status, 200);
    assert.equal(cliHealth.headers.get("access-control-allow-origin"), null);
    const healthBody = await cliHealth.json() as { ok: boolean; workspaceRoot?: string };
    assert.equal(healthBody.ok, true);
    assert.equal(Object.hasOwn(healthBody, "workspaceRoot"), false);

    const sameOrigin = await fetch(`${base}/api/health`, { headers: { Origin: base } });
    assert.equal(sameOrigin.status, 200);
    assert.equal(sameOrigin.headers.get("access-control-allow-origin"), base);

    const explicitlyAllowed = await fetch(`${base}/api/health`, { headers: { Origin: allowedOrigin } });
    assert.equal(explicitlyAllowed.status, 200);
    assert.equal(explicitlyAllowed.headers.get("access-control-allow-origin"), allowedOrigin);

    const proxySameOrigin = await fetch(`${base}/api/health`, {
      headers: {
        Origin: "http://localhost:4174",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    assert.equal(proxySameOrigin.status, 200);
    assert.equal(proxySameOrigin.headers.get("access-control-allow-origin"), "http://localhost:4174");

    const rejected = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "must-not-exist" }),
    });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
    const rejectedBody = await rejected.json() as { error: { code: string } };
    assert.equal(rejectedBody.error.code, "ORIGIN_NOT_ALLOWED");
    assert.equal((await (await fetch(`${base}/api/projects`)).json() as { projects: unknown[] }).projects.length, 0);

    const allowedPreflight = await fetch(`${base}/api/projects`, {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.match(allowedPreflight.headers.get("access-control-allow-methods") ?? "", /POST/);

    const rejectedPreflight = await fetch(`${base}/api/projects`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(rejectedPreflight.status, 403);

    const rejectedHeader = await fetch(`${base}/api/projects`, {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    assert.equal(rejectedHeader.status, 403);
    assert.equal((await rejectedHeader.json() as { error: { code: string } }).error.code, "CORS_HEADERS_NOT_ALLOWED");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("health exposes the workspace path only when explicitly enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-http-health-path-"));
  const { server } = createApiServer({ workspaceRoot: root, staticRoot: false, exposeWorkspacePath: true });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    const body = await response.json() as { ok: boolean; workspaceRoot?: string };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.workspaceRoot, root);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP v0.2 structure, settings, snapshots, and validation APIs form a complete workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-http-v02-"));
  const { server } = createApiServer({ workspaceRoot: root, staticRoot: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const importedResponse = await fetch(`${base}/api/projects/import/json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "v0.2 API", preset: minimalPreset() }),
    });
    const imported = await importedResponse.json() as { project: { id: string; updatedAt: string; schemaVersion: number } };
    assert.equal(imported.project.schemaVersion, 2);

    const structureResponse = await fetch(`${base}/api/projects/${imported.project.id}/structure`);
    assert.equal(structureResponse.status, 200);
    let structure = (await structureResponse.json() as {
      structure: { revision: string; prompts: Array<{ uid: string }>; regex: unknown[] };
    }).structure;
    const createResponse = await fetch(`${base}/api/projects/${imported.project.id}/structure/mutations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ifRevision: structure.revision, mutation: { op: "create", kind: "regex" } }),
    });
    assert.equal(createResponse.status, 200);
    const created = await createResponse.json() as {
      createdUid: string;
      structure: typeof structure;
      build: { revision: string; diagnostics: unknown[] };
    };
    assert.match(created.createdUid, /^[0-9a-f-]{36}$/);
    assert.equal(created.structure.regex.length, 1);
    structure = created.structure;

    const snapshotResponse = await fetch(`${base}/api/projects/${imported.project.id}/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ifRevision: structure.revision, label: "HTTP snapshot" }),
    });
    assert.equal(snapshotResponse.status, 201);
    const snapshot = (await snapshotResponse.json() as { snapshot: { uid: string } }).snapshot;
    const listResponse = await fetch(`${base}/api/projects/${imported.project.id}/snapshots`);
    assert.equal((await listResponse.json() as { snapshots: unknown[] }).snapshots.length, 1);

    const projectResponse = await fetch(`${base}/api/projects/${imported.project.id}`);
    const project = (await projectResponse.json() as { project: { updatedAt: string } }).project;
    const settingsResponse = await fetch(`${base}/api/projects/${imported.project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ifProjectRevision: project.updatedAt,
        name: "Renamed via HTTP",
        version: "0.2",
        targetPresetName: "Target v0.2",
      }),
    });
    assert.equal(settingsResponse.status, 200);
    assert.equal((await settingsResponse.json() as { project: { name: string } }).project.name, "Renamed via HTTP");

    const validationResponse = await fetch(`${base}/api/projects/${imported.project.id}/build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ validateOnly: true }),
    });
    assert.equal(validationResponse.status, 200);
    const validation = await validationResponse.json() as { success: boolean; preset?: unknown; revision: string };
    assert.equal(validation.success, true);
    assert.equal(Object.hasOwn(validation, "preset"), false);
    assert(validation.revision.length > 0);

    const restoreResponse = await fetch(
      `${base}/api/projects/${imported.project.id}/snapshots/${snapshot.uid}/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ifRevision: structure.revision }),
      },
    );
    assert.equal(restoreResponse.status, 200);
    const deleteSnapshotResponse = await fetch(
      `${base}/api/projects/${imported.project.id}/snapshots/${snapshot.uid}`,
      { method: "DELETE" },
    );
    assert.equal(deleteSnapshotResponse.status, 204);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
