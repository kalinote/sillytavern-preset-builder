import { AlertTriangle, ArrowDown, ArrowUp, Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { JsonValue, ProjectStructure } from "../../lib/project-api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface PromptOrderEditorProps {
  structure: ProjectStructure;
  busy?: boolean;
  onSave: (promptOrder: JsonValue[]) => void;
}

interface OrderEntry {
  identifier: string;
  enabled: boolean;
  source: Record<string, JsonValue>;
}

interface OrderGroup {
  source: Record<string, JsonValue>;
  entries: OrderEntry[];
}

export function PromptOrderEditor({ structure, busy, onSave }: PromptOrderEditorProps) {
  const [groups, setGroups] = useState<OrderGroup[]>(() => parseGroups(structure.promptOrder));
  useEffect(() => setGroups(parseGroups(structure.promptOrder)), [structure.promptOrder, structure.revision]);
  const promptByIdentifier = useMemo(
    () => new Map(structure.prompts.filter((item) => item.identifier).map((item) => [item.identifier as string, item])),
    [structure.prompts],
  );
  const duplicateIdentifiers = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const prompt of structure.prompts) {
      if (!prompt.identifier) continue;
      if (seen.has(prompt.identifier)) duplicates.add(prompt.identifier);
      seen.add(prompt.identifier);
    }
    return duplicates;
  }, [structure.prompts]);
  const issues = groups.flatMap((group, groupIndex) => {
    const seen = new Set<string>();
    return group.entries.flatMap((entry) => {
      const output: string[] = [];
      if (!promptByIdentifier.has(entry.identifier)) output.push(`组 ${groupIndex + 1}：${entry.identifier} 为悬空引用`);
      if (seen.has(entry.identifier)) output.push(`组 ${groupIndex + 1}：${entry.identifier} 重复`);
      if (duplicateIdentifiers.has(entry.identifier)) output.push(`${entry.identifier} 对应多个 Prompt`);
      seen.add(entry.identifier);
      return output;
    });
  });

  const updateEntries = (groupIndex: number, update: (entries: OrderEntry[]) => OrderEntry[]) => {
    setGroups((current) => current.map((group, index) =>
      index === groupIndex ? { ...group, entries: update(group.entries) } : group));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Prompt Order</h2>
            <p className="mt-1 text-xs text-muted-foreground">这里调整运行时引用与启用状态，不改变 Prompts 数组顺序。</p>
          </div>
          <Button
            size="sm"
            disabled={busy || issues.length > 0}
            onClick={() => onSave(serializeGroups(groups))}
          >
            <Check />保存结构化顺序
          </Button>
        </div>

        {issues.length > 0 ? (
          <div className="rounded-xl border border-warning/30 bg-warning-soft/60 p-3 text-xs text-warning">
            <div className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />保存前需要解决 {issues.length} 个引用问题</div>
            <ul className="mt-2 space-y-1 pl-5">
              {issues.slice(0, 8).map((issue, index) => <li key={`${issue}-${index}`} className="list-disc">{issue}</li>)}
            </ul>
          </div>
        ) : null}

        {groups.map((group, groupIndex) => {
          const used = new Set(group.entries.map((entry) => entry.identifier));
          const available = structure.prompts.filter((prompt) => prompt.identifier && !used.has(prompt.identifier));
          return (
            <section key={groupIndex} className="rounded-2xl border border-border bg-surface p-3 shadow-xs">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                <div>
                  <p className="text-xs font-semibold">Character {String(group.source.character_id ?? groupIndex + 1)}</p>
                  <p className="text-[10px] text-muted-foreground">{group.entries.length} 个运行时引用</p>
                </div>
                {available.length > 0 ? (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Plus className="size-3.5" />
                    <select
                      value=""
                      disabled={busy}
                      className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground"
                      onChange={(event) => {
                        const identifier = event.target.value;
                        if (!identifier) return;
                        updateEntries(groupIndex, (entries) => [
                          ...entries,
                          { identifier, enabled: true, source: { identifier, enabled: true } },
                        ]);
                      }}
                    >
                      <option value="">添加 Prompt…</option>
                      {available.map((prompt) => (
                        <option key={prompt.uid} value={prompt.identifier}>{prompt.name || prompt.identifier}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div className="mt-2 space-y-1.5">
                {group.entries.map((entry, entryIndex) => {
                  const prompt = promptByIdentifier.get(entry.identifier);
                  const invalid = !prompt || duplicateIdentifiers.has(entry.identifier)
                    || group.entries.findIndex((candidate) => candidate.identifier === entry.identifier) !== entryIndex;
                  return (
                    <div key={`${entry.identifier}-${entryIndex}`} className="flex items-center gap-2 rounded-xl border border-border bg-muted/25 px-2.5 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{prompt?.name || entry.identifier}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{entry.identifier}</span>
                      </span>
                      {invalid ? <Badge variant="red">需修复</Badge> : null}
                      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          disabled={busy}
                          onChange={(event) => updateEntries(groupIndex, (entries) => entries.map((item, index) =>
                            index === entryIndex ? { ...item, enabled: event.target.checked } : item))}
                        />
                        启用
                      </label>
                      <Button variant="ghost" size="icon-sm" disabled={busy || entryIndex === 0} onClick={() => updateEntries(groupIndex, (entries) => move(entries, entryIndex, -1))}>
                        <ArrowUp /><span className="sr-only">上移</span>
                      </Button>
                      <Button variant="ghost" size="icon-sm" disabled={busy || entryIndex === group.entries.length - 1} onClick={() => updateEntries(groupIndex, (entries) => move(entries, entryIndex, 1))}>
                        <ArrowDown /><span className="sr-only">下移</span>
                      </Button>
                      <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => updateEntries(groupIndex, (entries) => entries.filter((_, index) => index !== entryIndex))}>
                        <Trash2 /><span className="sr-only">移除引用</span>
                      </Button>
                    </div>
                  );
                })}
                {group.entries.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">这个分组还没有 Prompt 引用</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function parseGroups(value: JsonValue[]): OrderGroup[] {
  return value.map((candidate) => {
    const source = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? structuredClone(candidate) as Record<string, JsonValue>
      : { character_id: 100001, order: [] };
    const order = Array.isArray(source.order) ? source.order : [];
    return {
      source,
      entries: order.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.identifier !== "string") return [];
        return [{
          identifier: entry.identifier,
          enabled: entry.enabled !== false,
          source: structuredClone(entry) as Record<string, JsonValue>,
        }];
      }),
    };
  });
}

function serializeGroups(groups: OrderGroup[]): JsonValue[] {
  return groups.map((group) => ({
    ...structuredClone(group.source),
    order: group.entries.map((entry) => ({ ...structuredClone(entry.source), identifier: entry.identifier, enabled: entry.enabled })),
  }));
}

function move<T>(items: T[], index: number, delta: number) {
  const next = [...items];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}
