import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { EXTENSION_FILES } from "../src/extension-archive.js";
import { createApiServer } from "../src/http.js";

test("extension archive endpoint packages only the fixed installable file whitelist", async () => {
  const root = await mkdtemp(join(tmpdir(), "preset-studio-extension-"));
  const extensionRoot = join(root, "extension");
  await mkdir(extensionRoot);
  const expected = new Map<string, string>();
  for (const file of EXTENSION_FILES) {
    const content = `fixture:${file}`;
    expected.set(`preset-studio-bridge/${file}`, content);
    await writeFile(join(extensionRoot, file), content, "utf8");
  }
  await writeFile(join(extensionRoot, "ignored-secret.txt"), "must not be packaged", "utf8");

  const { server, bridge } = createApiServer({
    workspaceRoot: join(root, "workspace"),
    extensionRoot,
    staticRoot: false,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/st/extension/archive`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-disposition") ?? "", /preset-studio-bridge\.zip/);

    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    assert.deepEqual(Object.keys(archive).sort(), [...expected.keys()].sort());
    for (const [path, content] of expected) assert.equal(strFromU8(archive[path] as Uint8Array), content);
    assert.equal(Object.hasOwn(archive, "preset-studio-bridge/ignored-secret.txt"), false);

    await rm(join(extensionRoot, "README.md"));
    const unavailable = await fetch(url);
    assert.equal(unavailable.status, 503);
    const error = await unavailable.json() as { error: { code: string; details?: { file?: string } } };
    assert.equal(error.error.code, "EXTENSION_ARCHIVE_UNAVAILABLE");
    assert.equal(error.error.details?.file, "README.md");
  } finally {
    bridge.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await rm(root, { recursive: true, force: true });
  }
});
