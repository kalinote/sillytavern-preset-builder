import assert from "node:assert/strict";
import { Script } from "node:vm";
import test from "node:test";

import { renderPreviewRuntimeDocument } from "../src/preview-runtime.js";
import { PREVIEW_TEMPLATE_BOOTSTRAP } from "../src/preview-template-runtime.js";

test("generated Preview Host inline scripts are syntactically valid", () => {
  const document = renderPreviewRuntimeDocument(["http://127.0.0.1:3001"]);
  const scripts = [...document.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? "")
    .filter((source) => source.trim().length > 0);

  assert.ok(scripts.length >= 2);
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new Script(source, { filename: `generated-preview-inline-${index}.js` }),
      `inline script ${index} must parse`,
    );
  });
  assert.match(document, /storage:clear/);
  assert.match(document, /indexedDB\.deleteDatabase/);
  assert.match(document, /script:transfer-begin/);
  assert.match(document, /Script transfer SHA-256 mismatch/);
});

test("Prompt Template sandbox bootstrap is valid and exposes the EJS-1 contract", () => {
  assert.doesNotThrow(
    () => new Script(PREVIEW_TEMPLATE_BOOTSTRAP, { filename: "preset-studio-template-bootstrap.js" }),
  );
  assert.match(PREVIEW_TEMPLATE_BOOTSTRAP, /outputFunctionName:\s*"print"/);
  assert.match(PREVIEW_TEMPLATE_BOOTSTRAP, /getvar/);
  assert.match(PREVIEW_TEMPLATE_BOOTSTRAP, /setvar/);
  assert.match(PREVIEW_TEMPLATE_BOOTSTRAP, /include is not supported/);
});
