import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  JsonValue,
  ProjectStructure,
  StructureMutation,
} from "../../lib/project-api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface ItemPropertiesPanelProps {
  path: string;
  structure: ProjectStructure;
  busy?: boolean;
  onApply: (mutation: StructureMutation) => void;
}

export function ItemPropertiesPanel({ path, structure, busy, onApply }: ItemPropertiesPanelProps) {
  const selected = selectedItem(structure, path);
  const [draft, setDraft] = useState<Record<string, JsonValue>>({});
  useEffect(() => setDraft(selected ? itemDraft(selected) : {}), [selected?.uid, structure.revision]);
  if (!selected) return <EmptyProperties />;

  const set = (key: string, value: JsonValue) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="space-y-4 p-3">
      <div>
        <p className="text-xs font-semibold">{kindLabel(selected.kind)} 条目属性</p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">UID {selected.uid}</p>
      </div>

      {selected.kind === "prompt" ? (
        <>
          <Field label="名称"><Input value={stringValue(draft.name)} onChange={(event) => set("name", event.target.value)} /></Field>
          <Field label="Identifier"><Input value={stringValue(draft.identifier)} onChange={(event) => set("identifier", event.target.value)} /></Field>
          <Field label="Role">
            <select className={selectClass} value={stringValue(draft.role) || "system"} onChange={(event) => set("role", event.target.value)}>
              <option value="system">system</option><option value="user">user</option><option value="assistant">assistant</option>
            </select>
          </Field>
          <BooleanField label="启用" checked={draft.enabled !== false} onChange={(value) => set("enabled", value)} />
          <BooleanField label="Marker" checked={draft.marker === true} onChange={(value) => set("marker", value)} />
        </>
      ) : selected.kind === "regex" ? (
        <>
          <Field label="名称"><Input value={stringValue(draft.scriptName)} onChange={(event) => set("scriptName", event.target.value)} /></Field>
          <Field label="ID"><Input value={stringValue(draft.id)} onChange={(event) => set("id", event.target.value)} /></Field>
          <BooleanField label="禁用" checked={draft.disabled === true} onChange={(value) => set("disabled", value)} />
          <BooleanField label="编辑时运行" checked={draft.runOnEdit === true} onChange={(value) => set("runOnEdit", value)} />
          <Field label="Placement（JSON）">
            <Input value={JSON.stringify(draft.placement ?? [])} onChange={(event) => {
              try { set("placement", JSON.parse(event.target.value) as JsonValue); } catch { /* Keep the last valid value. */ }
            }} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min depth"><Input type="number" value={numberValue(draft.minDepth)} onChange={(event) => set("minDepth", Number(event.target.value))} /></Field>
            <Field label="Max depth"><Input type="number" value={numberValue(draft.maxDepth)} onChange={(event) => set("maxDepth", Number(event.target.value))} /></Field>
          </div>
        </>
      ) : (
        <>
          <Field label="名称"><Input value={stringValue(draft.name)} onChange={(event) => set("name", event.target.value)} /></Field>
          <Field label="ID"><Input value={stringValue(draft.id)} onChange={(event) => set("id", event.target.value)} /></Field>
          <BooleanField label="启用" checked={draft.enabled !== false} onChange={(value) => set("enabled", value)} />
        </>
      )}

      <Button
        className="w-full"
        disabled={busy}
        onClick={() => onApply({ op: "patch", kind: selected.kind, uid: selected.uid, patch: draft })}
      >
        {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
        应用属性
      </Button>
      <p className="text-[10px] leading-4 text-muted-foreground">只更新这里显示的安全字段；meta.json 中的未知字段会原样保留。</p>
    </div>
  );
}

const selectClass = "h-9 w-full rounded-lg border border-input bg-surface px-3 text-xs outline-none focus:ring-2 focus:ring-ring/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5 text-[11px] font-medium"><span>{label}</span>{children}</label>;
}

function BooleanField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between rounded-xl border border-border p-3 text-xs"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function selectedItem(structure: ProjectStructure, path: string) {
  const match = /^(prompts|regex|scripts)\/([^/]+)\//.exec(path);
  if (!match) return null;
  const collection = match[1] === "prompts" ? structure.prompts : match[1] === "regex" ? structure.regex : structure.scripts;
  return collection.find((item) => item.uid === match[2]) ?? null;
}

function itemDraft(item: NonNullable<ReturnType<typeof selectedItem>>): Record<string, JsonValue> {
  if (item.kind === "prompt") return {
    name: item.name ?? "", identifier: item.identifier ?? "", role: item.role ?? "system", enabled: item.enabled ?? true, marker: item.marker ?? false,
  };
  if (item.kind === "regex") return {
    scriptName: item.name ?? "", id: item.id ?? "", disabled: item.disabled ?? false, runOnEdit: item.runOnEdit ?? false,
    placement: item.placement ?? [], minDepth: item.minDepth ?? 0, maxDepth: item.maxDepth ?? 0,
  };
  return { name: item.name ?? "", id: item.id ?? "", enabled: item.enabled ?? true };
}

function kindLabel(kind: "prompt" | "regex" | "script") { return kind === "prompt" ? "Prompt" : kind === "regex" ? "Regex" : "Script"; }
function stringValue(value: JsonValue | undefined) { return typeof value === "string" ? value : ""; }
function numberValue(value: JsonValue | undefined) { return typeof value === "number" ? value : 0; }
function EmptyProperties() { return <div className="p-6 text-center text-xs text-muted-foreground">选择 Prompt、Regex 或 Script 条目后编辑属性。</div>; }
