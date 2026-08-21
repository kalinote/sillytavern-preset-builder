import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "./errors.js";
import { EXTENSIONS_DIRECTORY, extensionKeyFromConfigPath } from "./extension-config.js";
import { cloneJson, getAtPath, isJsonObject, stableSha256 } from "./json.js";
import { PRESET_PROMPT_FIELD_SET } from "./preset-config.js";
import type {
  BuildResult,
  Diagnostic,
  JsonObject,
  JsonValue,
  OrderedIndex,
  ProjectManifest,
  PromptIndexItem,
  RegexIndexItem,
  ScriptIndexItem,
} from "./types.js";

async function readText(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiError(422, "MISSING_PROJECT_FILE", `Missing ${label}`, { path });
    }
    throw error;
  }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  const source = await readText(path, label);
  try {
    return JSON.parse(source) as T;
  } catch (error) {
    throw new ApiError(422, "INVALID_PROJECT_JSON", `${label} is not valid JSON`, {
      path,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function buildExtensions(projectRoot: string): Promise<JsonObject> {
  let entries;
  try {
    entries = await readdir(join(projectRoot, EXTENSIONS_DIRECTORY), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ApiError(422, "MISSING_PROJECT_FILE", `Missing ${EXTENSIONS_DIRECTORY}`, {
        path: join(projectRoot, EXTENSIONS_DIRECTORY),
      });
    }
    throw error;
  }

  const configFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      extensionKey: extensionKeyFromConfigPath(`${EXTENSIONS_DIRECTORY}/${entry.name}`),
      path: join(projectRoot, EXTENSIONS_DIRECTORY, entry.name),
    }))
    .filter((entry): entry is { extensionKey: string; path: string } => entry.extensionKey !== undefined)
    .sort((left, right) => left.extensionKey.localeCompare(right.extensionKey));
  const configs = await Promise.all(configFiles.map(async ({ extensionKey, path }) => ({
    extensionKey,
    value: await readJson<JsonValue>(path, `extension ${extensionKey}`),
  })));
  const extensions: JsonObject = {};
  for (const config of configs) extensions[config.extensionKey] = config.value;
  return extensions;
}

function assertIndex<T>(value: OrderedIndex<T>, label: string): void {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.items)) {
    throw new ApiError(422, "INVALID_PROJECT_INDEX", `${label} has an unsupported structure`);
  }
}

async function buildPrompts(projectRoot: string): Promise<JsonValue[]> {
  const directory = join(projectRoot, "prompts");
  const index = await readJson<OrderedIndex<PromptIndexItem>>(join(directory, "index.json"), "prompts/index.json");
  assertIndex(index, "prompts/index.json");
  const output: JsonValue[] = [];
  const seen = new Set<string>();

  for (const item of index.items) {
    if (!item || typeof item.uid !== "string" || seen.has(item.uid)) {
      throw new ApiError(422, "INVALID_PROJECT_INDEX", "Prompt index contains a missing or duplicate uid");
    }
    seen.add(item.uid);
    const meta = await readJson<JsonObject>(join(directory, item.uid, "meta.json"), `prompt ${item.uid} meta`);
    if (!isJsonObject(meta)) throw new ApiError(422, "INVALID_PROJECT_JSON", `Prompt ${item.uid} meta must be an object`);
    if (item.contentKind === "text") {
      meta.content = await readText(join(directory, item.uid, "content.md"), `prompt ${item.uid} content`);
    } else if (item.contentKind === "absent") {
      delete meta.content;
    }
    output.push(meta);
  }
  return output;
}

async function buildRegex(projectRoot: string): Promise<JsonValue[]> {
  const directory = join(projectRoot, "regex");
  const index = await readJson<OrderedIndex<RegexIndexItem>>(join(directory, "index.json"), "regex/index.json");
  assertIndex(index, "regex/index.json");
  const output: JsonValue[] = [];
  const seen = new Set<string>();

  for (const item of index.items) {
    if (!item || typeof item.uid !== "string" || seen.has(item.uid)) {
      throw new ApiError(422, "INVALID_PROJECT_INDEX", "Regex index contains a missing or duplicate uid");
    }
    seen.add(item.uid);
    const meta = await readJson<JsonObject>(join(directory, item.uid, "meta.json"), `regex ${item.uid} meta`);
    if (!isJsonObject(meta)) throw new ApiError(422, "INVALID_PROJECT_JSON", `Regex ${item.uid} meta must be an object`);
    if (item.findKind === "text") meta.findRegex = await readText(join(directory, item.uid, "find.txt"), `regex ${item.uid} find`);
    else if (item.findKind === "absent") delete meta.findRegex;
    if (item.replaceKind === "text") {
      meta.replaceString = await readText(join(directory, item.uid, "replace.html"), `regex ${item.uid} replacement`);
    } else if (item.replaceKind === "absent") delete meta.replaceString;
    output.push(meta);
  }
  return output;
}

async function buildScripts(projectRoot: string): Promise<JsonValue[]> {
  const directory = join(projectRoot, "scripts");
  const index = await readJson<OrderedIndex<ScriptIndexItem>>(join(directory, "index.json"), "scripts/index.json");
  assertIndex(index, "scripts/index.json");
  const output: JsonValue[] = [];
  const seen = new Set<string>();

  for (const item of index.items) {
    if (!item || typeof item.uid !== "string" || seen.has(item.uid)) {
      throw new ApiError(422, "INVALID_PROJECT_INDEX", "Script index contains a missing or duplicate uid");
    }
    seen.add(item.uid);
    const meta = await readJson<JsonObject>(join(directory, item.uid, "meta.json"), `script ${item.uid} meta`);
    if (!isJsonObject(meta)) throw new ApiError(422, "INVALID_PROJECT_JSON", `Script ${item.uid} meta must be an object`);
    if (item.contentKind === "text") {
      meta.content = await readText(join(directory, item.uid, "content.js"), `script ${item.uid} content`);
    } else if (item.contentKind === "absent") {
      delete meta.content;
    }
    output.push(meta);
  }
  return output;
}

function installRegexMirrors(
  preset: JsonObject,
  prompts: JsonValue[],
  manifest: ProjectManifest,
  regexes: JsonValue[],
  diagnostics: Diagnostic[],
): void {
  const mirrorBinding = manifest.regexMirrorBinding;
  const targets = mirrorBinding?.consistent
    ? mirrorBinding.targets
    : mirrorBinding
      ? [mirrorBinding.authority]
      : [];
  if (targets.includes("extensions.regex_scripts")) {
    const extensions = preset.extensions;
    if (isJsonObject(extensions)) extensions.regex_scripts = cloneJson(regexes);
  }
  if (targets.includes("extensions.SPreset.RegexBinding.regexes")) {
    const binding = getAtPath(preset, ["extensions", "SPreset", "RegexBinding"]);
    if (isJsonObject(binding)) binding.regexes = cloneJson(regexes);
  }

  const promptIdentifier = mirrorBinding?.consistent ? mirrorBinding.promptIdentifier : undefined;
  if (promptIdentifier) {
    const prompt = prompts.find((candidate) => isJsonObject(candidate) && candidate.identifier === promptIdentifier);
    const spreset = getAtPath(preset, ["extensions", "SPreset"]);
    if (isJsonObject(prompt) && isJsonObject(spreset)) {
      prompt.content = JSON.stringify(spreset);
    } else {
      diagnostics.push({
        level: "warning",
        code: "REGEX_PROMPT_MIRROR_MISSING",
        message: `Could not rebuild regex prompt mirror ${promptIdentifier}`,
      });
    }
  }
}

function collectPromptOrderDiagnostics(preset: JsonObject, diagnostics: Diagnostic[]): void {
  const prompts = Array.isArray(preset.prompts) ? preset.prompts : [];
  const identifiers = new Map<string, number>();
  for (const prompt of prompts) {
    if (!isJsonObject(prompt) || typeof prompt.identifier !== "string" || !prompt.identifier) continue;
    identifiers.set(prompt.identifier, (identifiers.get(prompt.identifier) ?? 0) + 1);
  }
  for (const [identifier, count] of identifiers) {
    if (count > 1) {
      diagnostics.push({
        level: "error",
        code: "DUPLICATE_PROMPT_IDENTIFIER",
        message: `Prompt identifier ${identifier} is used by ${count} prompts`,
        path: "prompts/index.json",
      });
    }
  }

  if (!Array.isArray(preset.prompt_order)) {
    diagnostics.push({
      level: "error",
      code: "INVALID_PROMPT_ORDER",
      message: "prompt_order must be an array",
      path: "prompts/prompt-order.json",
    });
    return;
  }
  for (let groupIndex = 0; groupIndex < preset.prompt_order.length; groupIndex += 1) {
    const group = preset.prompt_order[groupIndex];
    if (!isJsonObject(group) || !Array.isArray(group.order)) {
      diagnostics.push({
        level: "error",
        code: "INVALID_PROMPT_ORDER_GROUP",
        message: `prompt_order group ${groupIndex + 1} has no order array`,
        path: "prompts/prompt-order.json",
      });
      continue;
    }
    const seen = new Set<string>();
    for (const entry of group.order) {
      if (!isJsonObject(entry) || typeof entry.identifier !== "string") {
        diagnostics.push({
          level: "error",
          code: "INVALID_PROMPT_ORDER_ENTRY",
          message: `prompt_order group ${groupIndex + 1} contains an invalid entry`,
          path: "prompts/prompt-order.json",
        });
        continue;
      }
      if (!identifiers.has(entry.identifier)) {
        diagnostics.push({
          level: "error",
          code: "DANGLING_PROMPT_ORDER_REFERENCE",
          message: `prompt_order references missing prompt ${entry.identifier}`,
          path: "prompts/prompt-order.json",
        });
      }
      if (seen.has(entry.identifier)) {
        diagnostics.push({
          level: "error",
          code: "DUPLICATE_PROMPT_ORDER_REFERENCE",
          message: `prompt_order group ${groupIndex + 1} references ${entry.identifier} more than once`,
          path: "prompts/prompt-order.json",
        });
      }
      seen.add(entry.identifier);
    }
  }
}

export async function buildPresetProject(projectRoot: string): Promise<BuildResult> {
  const manifest = await readJson<ProjectManifest>(join(projectRoot, "project.json"), "project.json");
  if (manifest.schemaVersion !== 2) {
    throw new ApiError(422, "UNSUPPORTED_PROJECT", "Unsupported project schema version");
  }
  const [settings, promptFields, extensions] = await Promise.all([
    readJson<JsonObject>(join(projectRoot, "preset.settings.json"), "preset.settings.json"),
    readJson<JsonObject>(join(projectRoot, "preset.prompt-fields.json"), "preset.prompt-fields.json"),
    buildExtensions(projectRoot),
  ]);
  if (!isJsonObject(settings)) throw new ApiError(422, "INVALID_PROJECT_JSON", "preset.settings.json must be an object");
  if (!isJsonObject(promptFields)) throw new ApiError(422, "INVALID_PROJECT_JSON", "preset.prompt-fields.json must be an object");
  for (const key of ["extensions", "prompts", "prompt_order"]) {
    if (Object.hasOwn(settings, key)) {
      throw new ApiError(422, "INVALID_PROJECT_JSON", `preset.settings.json cannot contain ${key}`);
    }
  }
  for (const key of PRESET_PROMPT_FIELD_SET) {
    if (Object.hasOwn(settings, key)) {
      throw new ApiError(422, "INVALID_PROJECT_JSON", `${key} belongs in preset.prompt-fields.json`);
    }
  }
  for (const [key, value] of Object.entries(promptFields)) {
    if (!PRESET_PROMPT_FIELD_SET.has(key) || typeof value !== "string") {
      throw new ApiError(422, "INVALID_PROJECT_JSON", `preset.prompt-fields.json contains unsupported field ${key}`);
    }
  }
  const preset = cloneJson(settings);
  for (const [key, value] of Object.entries(promptFields)) preset[key] = cloneJson(value);
  preset.extensions = cloneJson(extensions);
  const diagnostics: Diagnostic[] = [];

  const prompts = manifest.managedPaths.prompts ? await buildPrompts(projectRoot) : [];
  if (manifest.managedPaths.prompts) preset.prompts = prompts;
  if (manifest.managedPaths.promptOrder) {
    preset.prompt_order = await readJson<JsonValue>(
      join(projectRoot, "prompts", "prompt-order.json"),
      "prompts/prompt-order.json",
    );
  }

  if (manifest.managedPaths.regex) {
    if (!manifest.regexMirrorBinding) {
      throw new ApiError(422, "REGEX_MIRROR_BINDING_MISSING", "Managed Regex files have no write-back binding");
    }
    const regexes = await buildRegex(projectRoot);
    installRegexMirrors(preset, prompts, manifest, regexes, diagnostics);
  }
  if (manifest.regexMirrorBinding && !manifest.regexMirrorBinding.consistent) {
    diagnostics.push({
      level: "warning",
      code: "REGEX_MIRROR_CONFLICT_PRESERVED",
      message: manifest.managedPaths.regex
        ? `Conflicting Regex mirrors were preserved; edits only update ${manifest.regexMirrorBinding.authority}`
        : "Conflicting Regex mirrors were preserved in their extension config files and are not linked",
    });
  }

  if (manifest.managedPaths.scripts) {
    const helper = getAtPath(preset, ["extensions", "tavern_helper"]);
    if (!isJsonObject(helper)) {
      throw new ApiError(422, "SCRIPT_TARGET_MISSING", "tavern_helper extension config is missing");
    }
    helper.scripts = await buildScripts(projectRoot);
  }

  collectPromptOrderDiagnostics(preset, diagnostics);

  const serialized = `${JSON.stringify(preset, null, 2)}\n`;
  const reparsed = JSON.parse(serialized) as unknown;
  if (!isJsonObject(reparsed)) throw new ApiError(500, "BUILD_INVALID", "Built preset is not a JSON object");
  return {
    preset,
    diagnostics,
    revision: stableSha256(serialized),
    size: Buffer.byteLength(serialized),
  };
}
