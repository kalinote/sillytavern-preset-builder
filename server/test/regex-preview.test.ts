import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compileTavernRegex,
  runRegexPreview,
  unwrapHtmlFence,
  type RegexPreviewRule,
} from "../../src/preview/regex-preview-pipeline.js";

function rule(input: Partial<RegexPreviewRule> & Pick<RegexPreviewRule, "uid" | "name" | "index" | "find" | "replace">): RegexPreviewRule {
  return {
    id: input.uid,
    disabled: false,
    runOnEdit: true,
    findPath: `regex/${input.uid}/find.txt`,
    replacePath: `regex/${input.uid}/replace.html`,
    metaPath: `regex/${input.uid}/meta.json`,
    meta: {},
    ...input,
  };
}

test("regex preview uses native numbered, named, and whole-match replacement semantics", () => {
  const result = runRegexPreview({
    input: "<bi>Hello | 你好</bi>",
    currentUid: "bilingual",
    mode: "current",
    rules: [rule({
      uid: "bilingual",
      name: "Bilingual",
      index: 0,
      find: "/<bi>\\s*(?<left>[\\s\\S]*?)\\s*\\|\\s*([\\s\\S]*?)\\s*<\\/bi>/g",
      replace: "<p>$<left></p><p>$2</p><code>$&</code>",
    })],
  });
  assert.equal(result.totalMatches, 1);
  assert.equal(result.output, "<p>Hello</p><p>你好</p><code><bi>Hello | 你好</bi></code>");
  assert.equal(result.diagnostics.length, 0);
});

test("project regex mode preserves order and skips disabled rules", () => {
  const result = runRegexPreview({
    input: "fox",
    currentUid: "second",
    mode: "project",
    rules: [
      rule({ uid: "second", name: "Second", index: 1, find: "/FOX/g", replace: "狐" }),
      rule({ uid: "first", name: "First", index: 0, find: "/fox/g", replace: "FOX" }),
      rule({ uid: "disabled", name: "Disabled", index: 2, find: "/狐/g", replace: "wrong", disabled: true }),
    ],
  });
  assert.equal(result.output, "狐");
  assert.deepEqual(result.stages.map((stage) => stage.uid), ["first", "second"]);
});

test("regex preview reports invalid flags and caps empty-string matches", () => {
  assert.throws(() => compileTavernRegex("/x/gg", {}), /flags/i);
  const result = runRegexPreview({
    input: "abcd",
    currentUid: "empty",
    mode: "current",
    maxMatches: 2,
    rules: [rule({ uid: "empty", name: "Empty", index: 0, find: "/(?:)/g", replace: "-" })],
  });
  assert.equal(result.stages.length, 0);
  assert.match(result.diagnostics[0]?.message ?? "", /超过 2 次上限/);
});

test("HTML fences are removed only when they wrap the complete result", () => {
  assert.equal(unwrapHtmlFence("```\n<section>ok</section>\n```"), "<section>ok</section>");
  assert.equal(unwrapHtmlFence("before\n```html\n<section>ok</section>\n```"), "before\n```html\n<section>ok</section>\n```");
});

test("four representative full-sample replacement shapes retain captures and parent access", () => {
  const cases = JSON.parse(readFileSync(
    new URL("./fixtures/preview/sample-regex-cases.json", import.meta.url),
    "utf8",
  )) as Array<{
    name: string;
    find: string;
    input: string;
    replace: string;
    expected: string[];
  }>;

  assert.equal(cases.length, 4);
  for (const [index, fixture] of cases.entries()) {
    const result = runRegexPreview({
      input: fixture.input,
      currentUid: `sample-${index}`,
      mode: "current",
      rules: [rule({
        uid: `sample-${index}`,
        name: fixture.name,
        index,
        find: fixture.find,
        replace: fixture.replace,
      })],
    });

    assert.equal(result.diagnostics.length, 0, fixture.name);
    assert.ok(result.totalMatches >= 1, fixture.name);
    for (const expected of fixture.expected) assert.ok(result.output.includes(expected), `${fixture.name}: ${expected}`);
  }
});
