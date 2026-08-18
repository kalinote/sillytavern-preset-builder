import type { JsonValue, PreviewRuntimeRegex } from "../lib/project-api";

export interface RegexPreviewRule extends PreviewRuntimeRegex {
  find: string;
  replace: string;
  meta: Record<string, JsonValue>;
}

export interface RegexPreviewStage {
  uid: string;
  name: string;
  index: number;
  matches: number;
  durationMs: number;
  input: string;
  output: string;
}

export interface RegexPreviewDiagnostic {
  severity: "warning" | "error";
  ruleUid: string;
  ruleName: string;
  message: string;
}

export interface RegexPreviewResult {
  output: string;
  rawOutput: string;
  stages: RegexPreviewStage[];
  diagnostics: RegexPreviewDiagnostic[];
  totalMatches: number;
}

export interface RunRegexPreviewOptions {
  input: string;
  rules: RegexPreviewRule[];
  currentUid: string;
  mode: "current" | "project";
  includeDisabledCurrent?: boolean;
  maxMatches?: number;
}

function lastUnescapedSlash(value: string): number {
  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] !== "/") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

export function compileTavernRegex(source: string, meta: Record<string, JsonValue>): RegExp {
  if (source.startsWith("/")) {
    const delimiter = lastUnescapedSlash(source);
    if (delimiter > 0) {
      return new RegExp(source.slice(1, delimiter), source.slice(delimiter + 1));
    }
  }
  const flags = typeof meta.flags === "string" ? meta.flags : "g";
  return new RegExp(source, flags);
}

function advanceStringIndex(value: string, index: number, unicode: boolean): number {
  if (!unicode || index + 1 >= value.length) return index + 1;
  const first = value.charCodeAt(index);
  if (first < 0xd800 || first > 0xdbff) return index + 1;
  const second = value.charCodeAt(index + 1);
  return second >= 0xdc00 && second <= 0xdfff ? index + 2 : index + 1;
}

function countMatches(input: string, regex: RegExp, maxMatches: number): number {
  const counter = new RegExp(regex.source, regex.flags);
  if (!counter.global) return counter.test(input) ? 1 : 0;
  let count = 0;
  for (;;) {
    const match = counter.exec(input);
    if (!match) return count;
    count += 1;
    if (count > maxMatches) throw new Error(`命中次数超过 ${maxMatches.toLocaleString()} 次上限`);
    if (match[0] === "") counter.lastIndex = advanceStringIndex(input, counter.lastIndex, counter.unicode);
  }
}

export function unwrapHtmlFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:html)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  return match ? match[1] ?? "" : value;
}

export function runRegexPreview({
  input,
  rules,
  currentUid,
  mode,
  includeDisabledCurrent = true,
  maxMatches = 10_000,
}: RunRegexPreviewOptions): RegexPreviewResult {
  const ordered = [...rules].sort((left, right) => left.index - right.index);
  const selected = mode === "current"
    ? ordered.filter((rule) => rule.uid === currentUid && (!rule.disabled || includeDisabledCurrent))
    : ordered.filter((rule) => !rule.disabled);
  const stages: RegexPreviewStage[] = [];
  const diagnostics: RegexPreviewDiagnostic[] = [];
  let output = input;
  let totalMatches = 0;

  for (const rule of selected) {
    const before = output;
    const startedAt = performance.now();
    try {
      const regex = compileTavernRegex(rule.find, rule.meta);
      const matches = countMatches(before, regex, maxMatches);
      output = before.replace(regex, rule.replace);
      totalMatches += matches;
      stages.push({
        uid: rule.uid,
        name: rule.name,
        index: rule.index,
        matches,
        durationMs: performance.now() - startedAt,
        input: before,
        output,
      });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        ruleUid: rule.uid,
        ruleName: rule.name,
        message: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  if (selected.length === 0) {
    diagnostics.push({
      severity: "warning",
      ruleUid: currentUid,
      ruleName: "当前规则",
      message: "没有可执行的正则规则。当前规则可能已禁用或不在清单中。",
    });
  }

  return { output: unwrapHtmlFence(output), rawOutput: output, stages, diagnostics, totalMatches };
}
