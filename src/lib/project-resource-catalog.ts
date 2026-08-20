import type { ProjectFileEntry, ProjectStructure } from "./project-api";
import { readPrimaryPromptOrder } from "./prompt-order";

export type ProjectPluginId = string;

export type ProjectResourceType =
  | "config"
  | "prompts"
  | "prompt-order"
  | "regex"
  | "scripts"
  | "snapshots"
  | "output"
  | "recovery"
  | "other";

export interface ProjectResourceCapabilities {
  read: boolean;
  edit: boolean;
  create: boolean;
  delete: boolean;
  reorder: boolean;
}

export interface ProjectResourceEntry {
  resourceId: string;
  treePath: string;
  sourcePath?: string;
  kind: "file" | "directory" | "reference";
  pluginId: ProjectPluginId;
  resourceType: ProjectResourceType;
  capabilities: ProjectResourceCapabilities;
  size: number;
  updatedAt?: string;
  displayName: string;
  order?: number;
  role?: "source-json";
  promptOrder?: {
    identifier: string;
    groupIndex: number;
    characterId: string;
    position?: number;
    last: boolean;
    enabled: boolean;
    referenced: boolean;
    editable: boolean;
  };
}

const PLUGIN_ORDER = [
  "core",
  "spreset",
  "regex",
  "tavern-helper",
  "prompt-template",
  "shared",
  "project",
] as const;

const PLUGIN_LABELS: Record<string, string> = {
  core: "核心预设",
  spreset: "SPreset",
  regex: "Regex",
  "tavern-helper": "Tavern Helper",
  "prompt-template": "Prompt Template",
  shared: "共享配置",
  project: "工程管理",
};

const RESOURCE_TYPE_ORDER: readonly ProjectResourceType[] = [
  "config",
  "prompts",
  "prompt-order",
  "regex",
  "scripts",
  "snapshots",
  "output",
  "recovery",
  "other",
];

const RESOURCE_TYPE_LABELS: Record<ProjectResourceType, string> = {
  config: "配置",
  prompts: "Prompts",
  "prompt-order": "Prompt Order",
  regex: "正则",
  scripts: "脚本",
  snapshots: "快照",
  output: "构建输出",
  recovery: "恢复数据",
  other: "其他文件",
};

const FILE_CAPABILITIES: ProjectResourceCapabilities = {
  read: true,
  edit: true,
  create: false,
  delete: false,
  reorder: false,
};

const DIRECTORY_CAPABILITIES: ProjectResourceCapabilities = {
  read: false,
  edit: false,
  create: false,
  delete: false,
  reorder: false,
};

export function buildProjectResourceCatalog(
  files: readonly ProjectFileEntry[],
  structure: ProjectStructure | null | undefined,
): ProjectResourceEntry[] {
  const entries = new Map<string, ProjectResourceEntry>();
  const prompts = new Map((structure?.prompts ?? []).map((item) => [item.uid, item]));
  const regex = new Map((structure?.regex ?? []).map((item) => [item.uid, item]));
  const scripts = new Map((structure?.scripts ?? []).map((item) => [item.uid, item]));
  const pluginLabels = new Map((structure?.plugins ?? []).map((plugin) => [plugin.id, plugin.displayName]));
  const primaryPromptOrder = readPrimaryPromptOrder(structure?.promptOrder ?? []);
  const promptIdentifierCounts = new Map<string, number>();
  for (const prompt of structure?.prompts ?? []) {
    if (!prompt.identifier) continue;
    promptIdentifierCounts.set(prompt.identifier, (promptIdentifierCounts.get(prompt.identifier) ?? 0) + 1);
  }
  const promptOrderEntries = new Map(
    primaryPromptOrder.entries.map((entry) => [entry.identifier, entry]),
  );
  const promptOrderIdentifierCounts = new Map<string, number>();
  for (const entry of primaryPromptOrder.entries) {
    promptOrderIdentifierCounts.set(
      entry.identifier,
      (promptOrderIdentifierCounts.get(entry.identifier) ?? 0) + 1,
    );
  }

  function pluginOrder(pluginId: string): number {
    const knownOrder = PLUGIN_ORDER.indexOf(pluginId as (typeof PLUGIN_ORDER)[number]);
    return knownOrder === -1 ? PLUGIN_ORDER.indexOf("shared") - 0.5 : knownOrder;
  }

  function ensureDirectory(
    treePath: string,
    pluginId: ProjectPluginId,
    resourceType: ProjectResourceType,
    displayName: string,
    order?: number,
  ): void {
    if (entries.has(treePath)) return;
    entries.set(treePath, {
      resourceId: `directory:${treePath}`,
      treePath,
      kind: "directory",
      pluginId,
      resourceType,
      capabilities: DIRECTORY_CAPABILITIES,
      size: 0,
      displayName,
      ...(order === undefined ? {} : { order }),
    });
  }

  function ensureResourceType(pluginId: ProjectPluginId, resourceType: ProjectResourceType): string {
    ensureDirectory(
      pluginId,
      pluginId,
      resourceType,
      pluginLabels.get(pluginId) ?? PLUGIN_LABELS[pluginId] ?? pluginId,
      pluginOrder(pluginId),
    );
    const typePath = `${pluginId}/${resourceType}`;
    ensureDirectory(
      typePath,
      pluginId,
      resourceType,
      RESOURCE_TYPE_LABELS[resourceType],
      RESOURCE_TYPE_ORDER.indexOf(resourceType),
    );
    return typePath;
  }

  function ensureIntermediateDirectories(
    treePath: string,
    pluginId: ProjectPluginId,
    resourceType: ProjectResourceType,
  ): void {
    const segments = treePath.split("/");
    for (let index = 3; index < segments.length; index += 1) {
      const path = segments.slice(0, index).join("/");
      ensureDirectory(path, pluginId, resourceType, segments[index - 1] ?? path);
    }
  }

  function addFile(
    file: ProjectFileEntry,
    treePath: string,
    pluginId: ProjectPluginId,
    resourceType: ProjectResourceType,
    displayName?: string,
  ): void {
    ensureResourceType(pluginId, resourceType);
    ensureIntermediateDirectories(treePath, pluginId, resourceType);
    entries.set(treePath, {
      resourceId: `file:${file.path}`,
      treePath,
      sourcePath: file.path,
      kind: "file",
      pluginId,
      resourceType,
      capabilities: FILE_CAPABILITIES,
      size: file.size ?? 0,
      ...(file.updatedAt ? { updatedAt: file.updatedAt } : {}),
      displayName: displayName ?? file.displayName ?? file.name,
      ...(file.order === undefined ? {} : { order: file.order }),
      ...(file.role === "source-json" ? { role: file.role } : {}),
    });
  }

  function addConfigReference(
    file: ProjectFileEntry,
    pluginId: string,
    extensionKey: string,
    displayName: string,
  ): void {
    const typePath = ensureResourceType(pluginId, "config");
    const treePath = `${typePath}/extension-${encodeURIComponent(extensionKey)}`;
    entries.set(treePath, {
      resourceId: `reference:${pluginId}:${extensionKey}`,
      treePath,
      sourcePath: file.path,
      kind: "reference",
      pluginId,
      resourceType: "config",
      capabilities: FILE_CAPABILITIES,
      size: file.size ?? 0,
      ...(file.updatedAt ? { updatedAt: file.updatedAt } : {}),
      displayName: `${displayName} 配置（共享基础文件）`,
    });
  }

  for (const file of files) {
    if (file.kind !== "file") continue;

    if (file.path === "preset.json") {
      addFile(file, "core/config/preset.json", "core", "config", "完整预设 JSON");
      continue;
    }
    if (file.path === "preset.base.json") {
      addFile(file, "shared/config/preset.base.json", "shared", "config", "未拆分字段与插件配置");
      continue;
    }
    if (file.path === "project.json") {
      addFile(file, "project/config/project.json", "project", "config", "工程配置");
      continue;
    }
    if (file.path === "prompts/index.json") {
      addFile(file, "core/prompts/index.json", "core", "prompts", "Prompt 索引");
      continue;
    }
    if (file.path === "prompts/prompt-order.json") {
      addFile(file, "core/prompt-order/prompt-order.json", "core", "prompt-order");
      continue;
    }

    const promptMatch = /^prompts\/([^/]+)\/(.+)$/.exec(file.path);
    if (promptMatch) {
      const uid = promptMatch[1]!;
      const item = prompts.get(uid);
      const isSpreset = item?.identifier === "SPresetSettings";
      const pluginId: ProjectPluginId = isSpreset ? "spreset" : "core";
      const resourceType: ProjectResourceType = isSpreset ? "config" : "prompts";
      const typePath = ensureResourceType(pluginId, resourceType);
      const itemPath = `${typePath}/${uid}`;
      const itemLabel = isSpreset
        ? `SPresetSettings${item?.name ? ` · ${item.name}` : ""}`
        : item?.name || item?.identifier || `Prompt ${item?.order === undefined ? uid : item.order + 1}`;
      const orderEntry = item?.identifier ? promptOrderEntries.get(item.identifier) : undefined;
      const runtimeOrder = isSpreset
        ? item?.order
        : orderEntry?.position ?? primaryPromptOrder.entries.length + (item?.order ?? prompts.size);
      ensureDirectory(itemPath, pluginId, resourceType, itemLabel, runtimeOrder);
      const directoryEntry = entries.get(itemPath);
      if (directoryEntry && !isSpreset && item?.identifier) {
        directoryEntry.promptOrder = {
          identifier: item.identifier,
          groupIndex: primaryPromptOrder.groupIndex,
          characterId: String(primaryPromptOrder.characterId),
          ...(orderEntry ? { position: orderEntry.position } : {}),
          last: orderEntry?.position === primaryPromptOrder.entries.length - 1,
          enabled: orderEntry?.enabled ?? false,
          referenced: orderEntry !== undefined,
          editable: promptIdentifierCounts.get(item.identifier) === 1
            && (promptOrderIdentifierCounts.get(item.identifier) ?? 0) <= 1,
        };
      }
      addFile(file, `${itemPath}/${promptMatch[2]}`, pluginId, resourceType);
      continue;
    }

    if (file.path === "regex/index.json") {
      addFile(file, "regex/regex/index.json", "regex", "regex", "正则索引");
      continue;
    }
    const regexMatch = /^regex\/([^/]+)\/(.+)$/.exec(file.path);
    if (regexMatch) {
      const uid = regexMatch[1]!;
      const item = regex.get(uid);
      const typePath = ensureResourceType("regex", "regex");
      const itemPath = `${typePath}/${uid}`;
      ensureDirectory(
        itemPath,
        "regex",
        "regex",
        item?.name || item?.id || `Regex ${item?.order === undefined ? uid : item.order + 1}`,
        item?.order,
      );
      addFile(file, `${itemPath}/${regexMatch[2]}`, "regex", "regex");
      continue;
    }

    if (file.path === "scripts/index.json") {
      addFile(file, "tavern-helper/scripts/index.json", "tavern-helper", "scripts", "脚本索引");
      continue;
    }
    const scriptMatch = /^scripts\/([^/]+)\/(.+)$/.exec(file.path);
    if (scriptMatch) {
      const uid = scriptMatch[1]!;
      const item = scripts.get(uid);
      const typePath = ensureResourceType("tavern-helper", "scripts");
      const itemPath = `${typePath}/${uid}`;
      ensureDirectory(
        itemPath,
        "tavern-helper",
        "scripts",
        item?.name || item?.id || `Script ${item?.order === undefined ? uid : item.order + 1}`,
        item?.order,
      );
      addFile(file, `${itemPath}/${scriptMatch[2]}`, "tavern-helper", "scripts");
      continue;
    }

    const managedMatch = /^(snapshots|output|recovery)\/(.+)$/.exec(file.path);
    if (managedMatch) {
      const resourceType = managedMatch[1] as "snapshots" | "output" | "recovery";
      addFile(file, `project/${resourceType}/${managedMatch[2]}`, "project", resourceType);
      continue;
    }

    addFile(file, `project/other/${file.path}`, "project", "other");
  }

  const baseFile = files.find((file) => file.kind === "file" && file.path === "preset.base.json");
  for (const plugin of structure?.plugins ?? []) {
    if (plugin.id === "regex") {
      ensureResourceType("regex", "regex");
    } else if (baseFile) {
      addConfigReference(baseFile, plugin.id, plugin.extensionKey, plugin.displayName);
    }
  }

  return [...entries.values()];
}
