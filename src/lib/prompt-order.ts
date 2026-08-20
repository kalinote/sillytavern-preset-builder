import type { JsonValue } from "./project-api";

const DEFAULT_CHARACTER_ID = 100001;

export interface PrimaryPromptOrderEntry {
  identifier: string;
  enabled: boolean;
  position: number;
  rawIndex: number;
}

export interface PrimaryPromptOrder {
  groupIndex: number;
  characterId: JsonValue;
  entries: PrimaryPromptOrderEntry[];
}

export function readPrimaryPromptOrder(promptOrder: readonly JsonValue[]): PrimaryPromptOrder {
  const preferredIndex = promptOrder.findIndex((candidate) => {
    if (!isJsonObject(candidate) || !Array.isArray(candidate.order)) return false;
    return Number(candidate.character_id) === DEFAULT_CHARACTER_ID;
  });
  const fallbackIndex = promptOrder.findIndex(
    (candidate) => isJsonObject(candidate) && Array.isArray(candidate.order),
  );
  const groupIndex = preferredIndex >= 0 ? preferredIndex : fallbackIndex;
  if (groupIndex < 0) {
    return { groupIndex: -1, characterId: DEFAULT_CHARACTER_ID, entries: [] };
  }

  const group = promptOrder[groupIndex];
  if (!isJsonObject(group) || !Array.isArray(group.order)) {
    return { groupIndex: -1, characterId: DEFAULT_CHARACTER_ID, entries: [] };
  }

  const entries: PrimaryPromptOrderEntry[] = [];
  for (let rawIndex = 0; rawIndex < group.order.length; rawIndex += 1) {
    const candidate = group.order[rawIndex];
    if (!isJsonObject(candidate) || typeof candidate.identifier !== "string") continue;
    entries.push({
      identifier: candidate.identifier,
      enabled: candidate.enabled !== false,
      position: entries.length,
      rawIndex,
    });
  }
  return {
    groupIndex,
    characterId: group.character_id ?? DEFAULT_CHARACTER_ID,
    entries,
  };
}

export function setPrimaryPromptEnabled(
  promptOrder: readonly JsonValue[],
  identifier: string,
  enabled: boolean,
): JsonValue[] {
  const next = structuredClone(promptOrder) as JsonValue[];
  const primary = readPrimaryPromptOrder(next);
  const groupIndex = primary.groupIndex >= 0 ? primary.groupIndex : next.length;
  if (primary.groupIndex < 0) next.push({ character_id: DEFAULT_CHARACTER_ID, order: [] });
  const group = next[groupIndex];
  if (!isJsonObject(group) || !Array.isArray(group.order)) return normalizePromptOrder(next);

  const entry = group.order.find(
    (candidate) => isJsonObject(candidate) && candidate.identifier === identifier,
  );
  if (isJsonObject(entry)) entry.enabled = enabled;
  else group.order.push({ identifier, enabled });
  return normalizePromptOrder(next);
}

export function movePrimaryPrompt(
  promptOrder: readonly JsonValue[],
  identifier: string,
  targetIdentifier: string,
  placement: "before" | "after",
): JsonValue[] {
  if (identifier === targetIdentifier) return normalizePromptOrder(structuredClone(promptOrder) as JsonValue[]);
  const next = structuredClone(promptOrder) as JsonValue[];
  const primary = readPrimaryPromptOrder(next);
  const group = next[primary.groupIndex];
  if (!isJsonObject(group) || !Array.isArray(group.order)) return normalizePromptOrder(next);

  const sourceIndex = group.order.findIndex(
    (candidate) => isJsonObject(candidate) && candidate.identifier === identifier,
  );
  const targetIndex = group.order.findIndex(
    (candidate) => isJsonObject(candidate) && candidate.identifier === targetIdentifier,
  );
  if (sourceIndex < 0 || targetIndex < 0) return normalizePromptOrder(next);
  const [entry] = group.order.splice(sourceIndex, 1);
  if (entry === undefined) return normalizePromptOrder(next);
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  group.order.splice(adjustedTargetIndex + (placement === "after" ? 1 : 0), 0, entry);
  return normalizePromptOrder(next);
}

export function movePrimaryPromptByDelta(
  promptOrder: readonly JsonValue[],
  identifier: string,
  delta: -1 | 1,
): JsonValue[] {
  const primary = readPrimaryPromptOrder(promptOrder);
  const position = primary.entries.findIndex((entry) => entry.identifier === identifier);
  const target = primary.entries[position + delta];
  if (position < 0 || !target) return normalizePromptOrder(structuredClone(promptOrder) as JsonValue[]);
  return movePrimaryPrompt(
    promptOrder,
    identifier,
    target.identifier,
    delta < 0 ? "before" : "after",
  );
}

function normalizePromptOrder(promptOrder: JsonValue[]): JsonValue[] {
  for (const candidate of promptOrder) {
    if (!isJsonObject(candidate) || !Array.isArray(candidate.order)) continue;
    for (const entry of candidate.order) {
      if (!isJsonObject(entry) || typeof entry.identifier !== "string") continue;
      entry.enabled = entry.enabled !== false;
    }
  }
  return promptOrder;
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
