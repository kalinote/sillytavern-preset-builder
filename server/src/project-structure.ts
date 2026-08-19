import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic.js";
import { buildPresetProject } from "./builder.js";
import { ApiError } from "./errors.js";
import { cloneJson, isJsonObject, stringifyJson } from "./json.js";
import type {
  BuildResult,
  JsonObject,
  JsonValue,
  OrderedIndex,
  ProjectItemKind,
  ProjectManifest,
  ProjectStructure,
  PromptIndexItem,
  RegexIndexItem,
  ScriptIndexItem,
  StructureMutation,
} from "./types.js";

type AnyIndexItem = PromptIndexItem | RegexIndexItem | ScriptIndexItem;

const KIND_CONFIG = {
  prompt: { root: "prompts", index: "prompts/index.json", label: "Prompt" },
  regex: { root: "regex", index: "regex/index.json", label: "Regex" },
  script: { root: "scripts", index: "scripts/index.json", label: "Script" },
} as const;

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pluginSummary(extensionKey: string) {
  const known = {
    SPreset: { id: "spreset", displayName: "SPreset" },
    regex_scripts: { id: "regex", displayName: "Regex" },
    tavern_helper: { id: "tavern-helper", displayName: "Tavern Helper" },
    prompt_template: { id: "prompt-template", displayName: "Prompt Template" },
  }[extensionKey];
  return {
    id: known?.id ?? `extension:${encodeURIComponent(extensionKey)}`,
    displayName: known?.displayName ?? extensionKey,
    extensionKey,
    known: known !== undefined,
    configSourcePath: "preset.base.json" as const,
  };
}

function assertUid(uid: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)) {
    throw new ApiError(422, "INVALID_PROJECT_INDEX", "Project item index contains an invalid uid");
  }
  return uid;
}

async function readJson<T>(path: string, label: string): Promise<T> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiError(422, "MISSING_PROJECT_FILE", `Missing ${label}`, { path });
    }
    throw new ApiError(422, "INVALID_PROJECT_JSON", `${label} is not valid JSON`, { path });
  }
  return value as T;
}

async function writeJson(path: string, value: JsonValue): Promise<void> {
  await atomicWriteFile(path, stringifyJson(value));
}

async function readIndex(projectRoot: string, kind: ProjectItemKind): Promise<OrderedIndex<AnyIndexItem>> {
  const config = KIND_CONFIG[kind];
  const index = await readJson<OrderedIndex<AnyIndexItem>>(join(projectRoot, config.index), config.index);
  if (!index || index.schemaVersion !== 1 || !Array.isArray(index.items)) {
    throw new ApiError(422, "INVALID_PROJECT_INDEX", `${config.index} has an unsupported structure`);
  }
  const seen = new Set<string>();
  for (const item of index.items) {
    if (!item || typeof item.uid !== "string") {
      throw new ApiError(422, "INVALID_PROJECT_INDEX", `${config.index} contains a missing uid`);
    }
    assertUid(item.uid);
    if (seen.has(item.uid)) throw new ApiError(422, "INVALID_PROJECT_INDEX", `${config.index} contains duplicate uid`);
    seen.add(item.uid);
  }
  return index;
}

async function readMeta(projectRoot: string, kind: ProjectItemKind, uid: string): Promise<JsonObject> {
  const config = KIND_CONFIG[kind];
  const meta = await readJson<JsonObject>(join(projectRoot, config.root, assertUid(uid), "meta.json"), `${config.label} meta`);
  if (!isJsonObject(meta)) throw new ApiError(422, "INVALID_PROJECT_JSON", `${config.label} meta must be an object`);
  return meta;
}

async function readPromptOrder(projectRoot: string): Promise<JsonValue[]> {
  const value = await readJson<JsonValue>(join(projectRoot, "prompts", "prompt-order.json"), "prompt-order.json");
  if (!Array.isArray(value)) throw new ApiError(422, "INVALID_PROMPT_ORDER", "prompt-order.json must contain an array");
  return value;
}

export async function readProjectStructure(
  projectRoot: string,
  manifest: ProjectManifest,
  existingBuild?: BuildResult,
): Promise<ProjectStructure> {
  const [promptIndex, promptOrder, build, regexIndex, scriptIndex] = await Promise.all([
    readIndex(projectRoot, "prompt"),
    readPromptOrder(projectRoot),
    existingBuild ? Promise.resolve(existingBuild) : buildPresetProject(projectRoot),
    manifest.managedPaths.regex ? readIndex(projectRoot, "regex") : Promise.resolve({ schemaVersion: 1, items: [] } as OrderedIndex<AnyIndexItem>),
    manifest.managedPaths.scripts ? readIndex(projectRoot, "script") : Promise.resolve({ schemaVersion: 1, items: [] } as OrderedIndex<AnyIndexItem>),
  ]);

  const [prompts, regex, scripts] = await Promise.all([
    Promise.all(promptIndex.items.map(async (item, order) => {
      const meta = await readMeta(projectRoot, "prompt", item.uid);
      return {
        kind: "prompt" as const,
        uid: item.uid,
        order,
        ...(typeof meta.name === "string" ? { name: meta.name } : {}),
        ...(typeof meta.identifier === "string" ? { identifier: meta.identifier } : {}),
        ...(typeof meta.role === "string" ? { role: meta.role } : {}),
        ...(typeof meta.enabled === "boolean" ? { enabled: meta.enabled } : {}),
        ...(meta.marker === undefined ? {} : { marker: cloneJson(meta.marker) }),
      };
    })),
    Promise.all(regexIndex.items.map(async (item, order) => {
      const meta = await readMeta(projectRoot, "regex", item.uid);
      return {
        kind: "regex" as const,
        uid: item.uid,
        order,
        ...(typeof meta.scriptName === "string" ? { name: meta.scriptName } : {}),
        ...(typeof meta.id === "string" ? { id: meta.id } : {}),
        ...(typeof meta.disabled === "boolean" ? { disabled: meta.disabled } : {}),
        ...(typeof meta.runOnEdit === "boolean" ? { runOnEdit: meta.runOnEdit } : {}),
        ...(meta.placement === undefined ? {} : { placement: cloneJson(meta.placement) }),
        ...(typeof meta.minDepth === "number" && Number.isFinite(meta.minDepth) ? { minDepth: meta.minDepth } : {}),
        ...(typeof meta.maxDepth === "number" && Number.isFinite(meta.maxDepth) ? { maxDepth: meta.maxDepth } : {}),
      };
    })),
    Promise.all(scriptIndex.items.map(async (item, order) => {
      const meta = await readMeta(projectRoot, "script", item.uid);
      return {
        kind: "script" as const,
        uid: item.uid,
        order,
        ...(typeof meta.name === "string" ? { name: meta.name } : {}),
        ...(typeof meta.id === "string" ? { id: meta.id } : {}),
        ...(typeof meta.enabled === "boolean" ? { enabled: meta.enabled } : {}),
      };
    })),
  ]);
  const extensions = isJsonObject(build.preset.extensions) ? build.preset.extensions : {};
  const plugins = Object.keys(extensions).map(pluginSummary);

  return {
    projectId: manifest.id,
    projectRevision: manifest.updatedAt,
    revision: build.revision,
    prompts,
    regex,
    scripts,
    plugins,
    promptOrder: cloneJson(promptOrder),
  };
}

function uniqueValue(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function promptOrderReferences(promptOrder: JsonValue[], identifier: string): number {
  let count = 0;
  for (const group of promptOrder) {
    if (!isJsonObject(group) || !Array.isArray(group.order)) continue;
    for (const entry of group.order) {
      if (isJsonObject(entry) && entry.identifier === identifier) count += 1;
    }
  }
  return count;
}

function replacePromptOrderIdentifier(promptOrder: JsonValue[], oldIdentifier: string, nextIdentifier: string): void {
  for (const group of promptOrder) {
    if (!isJsonObject(group) || !Array.isArray(group.order)) continue;
    for (const entry of group.order) {
      if (isJsonObject(entry) && entry.identifier === oldIdentifier) entry.identifier = nextIdentifier;
    }
  }
}

function removePromptOrderIdentifier(promptOrder: JsonValue[], identifier: string): void {
  for (const group of promptOrder) {
    if (!isJsonObject(group) || !Array.isArray(group.order)) continue;
    group.order = group.order.filter((entry) => !isJsonObject(entry) || entry.identifier !== identifier);
  }
}

function validatePromptOrder(promptOrder: JsonValue[], identifiers: string[]): void {
  const counts = new Map<string, number>();
  for (const identifier of identifiers) counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
  for (const [identifier, count] of counts) {
    if (count > 1) {
      throw new ApiError(409, "PROMPT_IDENTIFIER_CONFLICT", `Prompt identifier ${identifier} is not unique`);
    }
  }
  const known = new Set(identifiers);
  for (let groupIndex = 0; groupIndex < promptOrder.length; groupIndex += 1) {
    const group = promptOrder[groupIndex];
    if (!isJsonObject(group) || !Array.isArray(group.order) || !Object.hasOwn(group, "character_id")) {
      throw new ApiError(422, "INVALID_PROMPT_ORDER", `promptOrder[${groupIndex}] must contain character_id and order`);
    }
    const seen = new Set<string>();
    for (let itemIndex = 0; itemIndex < group.order.length; itemIndex += 1) {
      const entry = group.order[itemIndex];
      if (!isJsonObject(entry) || typeof entry.identifier !== "string" || typeof entry.enabled !== "boolean") {
        throw new ApiError(422, "INVALID_PROMPT_ORDER", `promptOrder[${groupIndex}].order[${itemIndex}] is invalid`);
      }
      if (!known.has(entry.identifier)) {
        throw new ApiError(422, "INVALID_PROMPT_ORDER", `Prompt identifier ${entry.identifier} does not exist`);
      }
      if (seen.has(entry.identifier)) {
        throw new ApiError(422, "INVALID_PROMPT_ORDER", `Prompt identifier ${entry.identifier} is duplicated in one group`);
      }
      seen.add(entry.identifier);
    }
  }
}

function validatePatch(kind: ProjectItemKind, patch: JsonObject): void {
  const allowed = new Set(
    kind === "prompt"
      ? ["name", "identifier", "role", "enabled", "marker"]
      : kind === "regex"
        ? ["scriptName", "id", "disabled", "runOnEdit", "placement", "minDepth", "maxDepth"]
        : ["name", "id", "enabled"],
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", `Field ${key} cannot be patched`);
    if (["name", "identifier", "role", "scriptName", "id"].includes(key)) {
      if (typeof value !== "string" || value.length > 200) {
        throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", `${key} must be a string of at most 200 characters`);
      }
      if (["identifier", "id"].includes(key) && !value.trim()) {
        throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", `${key} must not be empty`);
      }
    }
    if (["enabled", "disabled", "runOnEdit"].includes(key) && typeof value !== "boolean") {
      throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", `${key} must be a boolean`);
    }
    if (["minDepth", "maxDepth"].includes(key) && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", `${key} must be a finite number`);
    }
  }
}

async function ensureManagedKind(projectRoot: string, manifest: ProjectManifest, kind: ProjectItemKind): Promise<void> {
  if (kind === "prompt" || (kind === "regex" ? manifest.managedPaths.regex : manifest.managedPaths.scripts)) return;
  const basePath = join(projectRoot, "preset.base.json");
  const base = await readJson<JsonObject>(basePath, "preset.base.json");
  if (!isJsonObject(base)) throw new ApiError(422, "INVALID_PROJECT_JSON", "preset.base.json must be an object");
  if (!isJsonObject(base.extensions)) base.extensions = {};
  const extensions = base.extensions as JsonObject;

  if (kind === "regex") {
    extensions.regex_scripts = [];
    manifest.managedPaths.regex = true;
    manifest.regexMirrorBinding = {
      authority: "extensions.regex_scripts",
      targets: ["extensions.regex_scripts"],
      consistent: true,
    };
  } else {
    if (!isJsonObject(extensions.tavern_helper)) extensions.tavern_helper = {};
    (extensions.tavern_helper as JsonObject).scripts = [];
    manifest.managedPaths.scripts = true;
  }
  const config = KIND_CONFIG[kind];
  await mkdir(join(projectRoot, config.root), { recursive: true });
  await writeJson(join(projectRoot, config.index), { schemaVersion: 1, items: [] });
  await writeJson(basePath, base);
}

async function identifiersFor(projectRoot: string, kind: ProjectItemKind, index: OrderedIndex<AnyIndexItem>): Promise<string[]> {
  const key = kind === "prompt" ? "identifier" : "id";
  const output: string[] = [];
  for (const item of index.items) {
    const meta = await readMeta(projectRoot, kind, item.uid);
    const value = meta[key];
    if (typeof value === "string" && value) output.push(value);
  }
  return output;
}

function updateIndexMetadata(kind: ProjectItemKind, item: AnyIndexItem, meta: JsonObject): void {
  if (kind === "prompt") {
    if (typeof meta.name === "string") item.name = meta.name; else delete item.name;
    if (typeof meta.identifier === "string") (item as PromptIndexItem).identifier = meta.identifier;
    else delete (item as PromptIndexItem).identifier;
  } else if (kind === "regex") {
    if (typeof meta.scriptName === "string") item.name = meta.scriptName; else delete item.name;
    if (typeof meta.id === "string") (item as RegexIndexItem).id = meta.id; else delete (item as RegexIndexItem).id;
  } else {
    if (typeof meta.name === "string") item.name = meta.name; else delete item.name;
    if (typeof meta.id === "string") (item as ScriptIndexItem).id = meta.id; else delete (item as ScriptIndexItem).id;
  }
}

export interface StructureMutationOutcome {
  createdUid?: string;
  deletedUid?: string;
}

export async function applyStructureMutation(
  projectRoot: string,
  manifest: ProjectManifest,
  mutation: StructureMutation,
): Promise<StructureMutationOutcome> {
  if (mutation.op === "set-prompt-order") {
    const promptIndex = await readIndex(projectRoot, "prompt");
    const identifiers = await identifiersFor(projectRoot, "prompt", promptIndex);
    validatePromptOrder(mutation.promptOrder, identifiers);
    await writeJson(join(projectRoot, "prompts", "prompt-order.json"), cloneJson(mutation.promptOrder));
    return {};
  }

  await ensureManagedKind(projectRoot, manifest, mutation.kind);
  const config = KIND_CONFIG[mutation.kind];
  const index = await readIndex(projectRoot, mutation.kind);
  const itemPosition = "uid" in mutation ? index.items.findIndex((item) => item.uid === mutation.uid) : -1;
  if ("uid" in mutation && itemPosition < 0) {
    throw new ApiError(404, "PROJECT_ITEM_NOT_FOUND", `${config.label} item does not exist`);
  }

  if (mutation.op === "create") {
    const uid = randomUUID();
    const itemRoot = join(projectRoot, config.root, uid);
    const used = new Set(await identifiersFor(projectRoot, mutation.kind, index));
    await mkdir(itemRoot, { recursive: false });
    let meta: JsonObject;
    let item: AnyIndexItem;
    if (mutation.kind === "prompt") {
      const identifier = uniqueValue("prompt", used);
      meta = { name: "新建 Prompt", identifier, role: "system", enabled: true };
      item = { uid, name: "新建 Prompt", identifier, contentKind: "text" };
      await atomicWriteFile(join(itemRoot, "content.md"), "");
    } else if (mutation.kind === "regex") {
      const id = uniqueValue("regex", used);
      meta = { scriptName: "新建 Regex", id, disabled: false, runOnEdit: false };
      item = { uid, name: "新建 Regex", id, findKind: "text", replaceKind: "text" };
      await Promise.all([
        atomicWriteFile(join(itemRoot, "find.txt"), ""),
        atomicWriteFile(join(itemRoot, "replace.html"), ""),
      ]);
    } else {
      const id = uniqueValue("script", used);
      meta = { name: "新建 Script", id, enabled: true };
      item = { uid, name: "新建 Script", id, contentKind: "text" };
      await atomicWriteFile(join(itemRoot, "content.js"), "");
    }
    await writeJson(join(itemRoot, "meta.json"), meta);
    const afterIndex = mutation.afterUid === undefined
      ? index.items.length
      : index.items.findIndex((candidate) => candidate.uid === mutation.afterUid) + 1;
    if (mutation.afterUid !== undefined && afterIndex === 0) {
      throw new ApiError(404, "PROJECT_ITEM_NOT_FOUND", "afterUid does not exist");
    }
    index.items.splice(afterIndex, 0, item);
    await writeJson(join(projectRoot, config.index), index as unknown as JsonValue);
    return { createdUid: uid };
  }

  if (mutation.op === "duplicate") {
    const sourceItem = index.items[itemPosition] as AnyIndexItem;
    const uid = randomUUID();
    await cp(join(projectRoot, config.root, sourceItem.uid), join(projectRoot, config.root, uid), {
      recursive: true,
      force: false,
    });
    const meta = await readMeta(projectRoot, mutation.kind, uid);
    const used = new Set(await identifiersFor(projectRoot, mutation.kind, index));
    if (mutation.kind === "prompt") {
      meta.name = `${optionalString(meta.name) || "未命名 Prompt"} 副本`;
      meta.identifier = uniqueValue(optionalString(meta.identifier) || "prompt", used);
    } else if (mutation.kind === "regex") {
      meta.scriptName = `${optionalString(meta.scriptName) || "未命名 Regex"} 副本`;
      meta.id = uniqueValue(optionalString(meta.id) || "regex", used);
    } else {
      meta.name = `${optionalString(meta.name) || "未命名 Script"} 副本`;
      meta.id = uniqueValue(optionalString(meta.id) || "script", used);
    }
    await writeJson(join(projectRoot, config.root, uid, "meta.json"), meta);
    const item = cloneJson(sourceItem as unknown as JsonValue) as unknown as AnyIndexItem;
    item.uid = uid;
    updateIndexMetadata(mutation.kind, item, meta);
    index.items.splice(itemPosition + 1, 0, item);
    await writeJson(join(projectRoot, config.index), index as unknown as JsonValue);
    return { createdUid: uid };
  }

  if (mutation.op === "patch") {
    validatePatch(mutation.kind, mutation.patch);
    const item = index.items[itemPosition] as AnyIndexItem;
    const meta = await readMeta(projectRoot, mutation.kind, item.uid);
    if (mutation.kind === "prompt" && typeof mutation.patch.identifier === "string") {
      const nextIdentifier = mutation.patch.identifier.trim();
      const oldIdentifier = optionalString(meta.identifier);
      const identifiers = await identifiersFor(projectRoot, "prompt", index);
      if (identifiers.some((identifier) => identifier === nextIdentifier && identifier !== oldIdentifier)) {
        throw new ApiError(409, "PROMPT_IDENTIFIER_CONFLICT", `Prompt identifier ${nextIdentifier} already exists`);
      }
      if (oldIdentifier && oldIdentifier !== nextIdentifier) {
        const promptOrder = await readPromptOrder(projectRoot);
        if (promptOrderReferences(promptOrder, oldIdentifier) > 0) {
          if (identifiers.filter((identifier) => identifier === oldIdentifier).length !== 1) {
            throw new ApiError(409, "PROMPT_IDENTIFIER_CONFLICT", "Referenced prompt identifier is not unique");
          }
          replacePromptOrderIdentifier(promptOrder, oldIdentifier, nextIdentifier);
          await writeJson(join(projectRoot, "prompts", "prompt-order.json"), promptOrder);
        }
      }
      mutation.patch.identifier = nextIdentifier;
    }
    for (const [key, value] of Object.entries(mutation.patch)) meta[key] = cloneJson(value);
    updateIndexMetadata(mutation.kind, item, meta);
    await Promise.all([
      writeJson(join(projectRoot, config.root, item.uid, "meta.json"), meta),
      writeJson(join(projectRoot, config.index), index as unknown as JsonValue),
    ]);
    return {};
  }

  if (mutation.op === "delete") {
    const item = index.items[itemPosition] as AnyIndexItem;
    if (mutation.kind === "prompt") {
      const meta = await readMeta(projectRoot, "prompt", item.uid);
      const identifier = optionalString(meta.identifier);
      if (identifier) {
        const promptOrder = await readPromptOrder(projectRoot);
        const references = promptOrderReferences(promptOrder, identifier);
        if (references > 0 && !mutation.removePromptOrderReferences) {
          throw new ApiError(409, "PROMPT_ORDER_REFERENCE_EXISTS", "Prompt is referenced by prompt_order", {
            identifier,
            references,
          });
        }
        if (references > 0) {
          const identifiers = await identifiersFor(projectRoot, "prompt", index);
          if (identifiers.filter((value) => value === identifier).length === 1) {
            removePromptOrderIdentifier(promptOrder, identifier);
            await writeJson(join(projectRoot, "prompts", "prompt-order.json"), promptOrder);
          }
        }
      }
    }
    index.items.splice(itemPosition, 1);
    await writeJson(join(projectRoot, config.index), index as unknown as JsonValue);
    await rm(join(projectRoot, config.root, item.uid), { recursive: true, force: false });
    return { deletedUid: item.uid };
  }

  if (mutation.op === "reorder") {
    if (mutation.uids.length !== index.items.length || new Set(mutation.uids).size !== mutation.uids.length) {
      throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", "Reorder must contain every uid exactly once");
    }
    const byUid = new Map(index.items.map((item) => [item.uid, item]));
    if (mutation.uids.some((uid) => !byUid.has(uid))) {
      throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", "Reorder contains an unknown uid");
    }
    index.items = mutation.uids.map((uid) => byUid.get(uid) as AnyIndexItem);
    await writeJson(join(projectRoot, config.index), index as unknown as JsonValue);
    return {};
  }

  throw new ApiError(422, "INVALID_STRUCTURE_MUTATION", "Unsupported structure mutation");
}
