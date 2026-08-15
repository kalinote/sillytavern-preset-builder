import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic.js";
import { ApiError } from "./errors.js";
import {
  cloneJson,
  getAtPath,
  isJsonObject,
  semanticEqual,
  stableSha256,
  stringifyJson,
} from "./json.js";
import type {
  ImportProjectInput,
  JsonObject,
  JsonValue,
  OrderedIndex,
  ProjectManifest,
  PromptIndexItem,
  RegexIndexItem,
  RegexMirrorBinding,
  ScriptIndexItem,
} from "./types.js";

interface RegexDetection {
  regexes: JsonValue[];
  binding: RegexMirrorBinding;
  settingsPromptIndex?: number;
  settingsPromptBaseContent?: string;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function assertChatCompletionPreset(value: JsonObject): void {
  if (!Array.isArray(value.prompts)) {
    throw new ApiError(422, "INVALID_PRESET", "Chat Completion preset must contain a prompts array");
  }
  if (!Array.isArray(value.prompt_order)) {
    throw new ApiError(422, "INVALID_PRESET", "Chat Completion preset must contain a prompt_order array");
  }
  if (!value.prompts.every(isJsonObject)) {
    throw new ApiError(422, "INVALID_PRESET", "Every prompts item must be a JSON object");
  }
  if (value.extensions !== undefined && !isJsonObject(value.extensions)) {
    throw new ApiError(422, "INVALID_PRESET", "extensions must be a JSON object when present");
  }
}

function detectRegexMirrors(preset: JsonObject): RegexDetection | undefined {
  const candidates: Array<{ target: string; value: JsonValue[] }> = [];
  const primary = getAtPath(preset, ["extensions", "regex_scripts"]);
  if (Array.isArray(primary)) {
    candidates.push({ target: "extensions.regex_scripts", value: primary });
  }

  const spresetRegex = getAtPath(preset, ["extensions", "SPreset", "RegexBinding", "regexes"]);
  if (Array.isArray(spresetRegex)) {
    candidates.push({ target: "extensions.SPreset.RegexBinding.regexes", value: spresetRegex });
  }

  let settingsPromptIndex: number | undefined;
  let settingsPromptBaseContent: string | undefined;
  const prompts = preset.prompts as JsonValue[];
  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    if (!isJsonObject(prompt) || prompt.identifier !== "SPresetSettings" || typeof prompt.content !== "string") continue;
    try {
      const parsed = JSON.parse(prompt.content) as unknown;
      if (!isJsonObject(parsed)) continue;
      const mirrorRegex = getAtPath(parsed, ["RegexBinding", "regexes"]);
      if (!Array.isArray(mirrorRegex)) continue;
      const extensionSpreset = getAtPath(preset, ["extensions", "SPreset"]);
      if (!isJsonObject(extensionSpreset) || !semanticEqual(parsed, extensionSpreset)) continue;

      // The sample and current SPreset convention use compact JSON.stringify.
      // Only link this string mirror when it can be rebuilt without changing the
      // string's semantic value on an untouched round trip.
      if (prompt.content !== JSON.stringify(parsed)) continue;
      const baseContent = cloneJson(parsed);
      const binding = getAtPath(baseContent, ["RegexBinding"]);
      if (isJsonObject(binding)) binding.regexes = [];
      candidates.push({ target: `prompts[${index}].content.RegexBinding.regexes`, value: mirrorRegex });
      settingsPromptIndex = index;
      settingsPromptBaseContent = JSON.stringify(baseContent);
      break;
    } catch {
      // A non-JSON SPresetSettings prompt is an independent prompt, not a mirror.
    }
  }

  if (candidates.length === 0) return undefined;
  const authority = candidates.find((candidate) => candidate.target === "extensions.regex_scripts") ?? candidates[0];
  if (!authority) return undefined;
  const consistent = candidates.every((candidate) => semanticEqual(authority.value, candidate.value));
  if (!consistent) {
    return {
      regexes: [],
      binding: {
        authority: authority.target,
        targets: candidates.map((candidate) => candidate.target),
        consistent: false,
      },
    };
  }

  return {
    regexes: cloneJson(authority.value),
    binding: {
      authority: authority.target,
      targets: candidates.map((candidate) => candidate.target),
      consistent: true,
      ...(settingsPromptIndex === undefined ? {} : { promptIdentifier: "SPresetSettings" }),
    },
    ...(settingsPromptIndex === undefined ? {} : { settingsPromptIndex }),
    ...(settingsPromptBaseContent === undefined ? {} : { settingsPromptBaseContent }),
  };
}

async function writeJson(path: string, value: JsonValue): Promise<void> {
  await atomicWriteFile(path, stringifyJson(value));
}

function makeManifest(
  id: string,
  input: ImportProjectInput,
  original: JsonObject,
  regexDetection: RegexDetection | undefined,
): ProjectManifest {
  const now = new Date().toISOString();
  const name = input.name?.trim() || input.sourcePresetName?.trim() || "Untitled preset";
  const source = {
    type: input.sourceType ?? "uploaded-json",
    ...(input.sourcePresetName ? { presetName: input.sourcePresetName } : {}),
    ...(input.sourceStVersion ? { stVersion: input.sourceStVersion } : {}),
  };
  return {
    schemaVersion: 1,
    id,
    name,
    version: input.version?.trim() ?? "",
    createdAt: now,
    updatedAt: now,
    source,
    targetPresetName: input.sourcePresetName?.trim() || `[Preset Studio] ${name}`,
    originalJsonSha256: stableSha256(JSON.stringify(original)),
    buildRulesVersion: 1,
    managedPaths: {
      prompts: true,
      promptOrder: true,
      regex: Boolean(regexDetection?.binding.consistent),
      scripts: Array.isArray(getAtPath(original, ["extensions", "tavern_helper", "scripts"])),
    },
    ...(regexDetection ? { regexMirrorBinding: regexDetection.binding } : {}),
    preservation: {
      unknownFields: "preset.base.json",
      semanticRoundTrip: true,
    },
  };
}

async function splitPrompts(
  projectRoot: string,
  prompts: JsonValue[],
  regexDetection: RegexDetection | undefined,
): Promise<void> {
  const directory = join(projectRoot, "prompts");
  await mkdir(directory, { recursive: true });
  const items: PromptIndexItem[] = [];

  for (let index = 0; index < prompts.length; index += 1) {
    const original = prompts[index];
    if (!isJsonObject(original)) throw new ApiError(422, "INVALID_PRESET", `prompts[${index}] is not an object`);
    const prompt = cloneJson(original);
    const uid = randomUUID();
    const itemRoot = join(directory, uid);
    await mkdir(itemRoot, { recursive: true });

    if (regexDetection?.settingsPromptIndex === index && regexDetection.settingsPromptBaseContent !== undefined) {
      prompt.content = regexDetection.settingsPromptBaseContent;
    }

    const hasContent = Object.hasOwn(prompt, "content");
    const textContent = typeof prompt.content === "string";
    const contentKind: PromptIndexItem["contentKind"] = textContent ? "text" : hasContent ? "inline" : "absent";
    if (textContent) {
      await atomicWriteFile(join(itemRoot, "content.md"), prompt.content as string);
      delete prompt.content;
    }
    await writeJson(join(itemRoot, "meta.json"), prompt);

    items.push({
      uid,
      ...(optionalString(original.identifier) ? { identifier: original.identifier as string } : {}),
      ...(optionalString(original.name) ? { name: original.name as string } : {}),
      contentKind,
    });
  }

  const index: OrderedIndex<PromptIndexItem> = { schemaVersion: 1, items };
  await writeJson(join(directory, "index.json"), index as unknown as JsonValue);
}

async function splitRegex(projectRoot: string, regexes: JsonValue[]): Promise<void> {
  const directory = join(projectRoot, "regex");
  await mkdir(directory, { recursive: true });
  const items: RegexIndexItem[] = [];

  for (let index = 0; index < regexes.length; index += 1) {
    const original = regexes[index];
    if (!isJsonObject(original)) throw new ApiError(422, "INVALID_PRESET", `regex[${index}] is not an object`);
    const regex = cloneJson(original);
    const uid = randomUUID();
    const itemRoot = join(directory, uid);
    await mkdir(itemRoot, { recursive: true });
    const findPresent = Object.hasOwn(regex, "findRegex");
    const replacePresent = Object.hasOwn(regex, "replaceString");
    const findText = typeof regex.findRegex === "string";
    const replaceText = typeof regex.replaceString === "string";
    const findKind: RegexIndexItem["findKind"] = findText ? "text" : findPresent ? "inline" : "absent";
    const replaceKind: RegexIndexItem["replaceKind"] = replaceText ? "text" : replacePresent ? "inline" : "absent";

    if (findText) {
      await atomicWriteFile(join(itemRoot, "find.txt"), regex.findRegex as string);
      // Keep an empty placeholder so JSON key insertion order is retained. The
      // SPresetSettings mirror is itself a JSON string, where object key order
      // affects string equality even though it does not affect JSON semantics.
      regex.findRegex = "";
    }
    if (replaceText) {
      await atomicWriteFile(join(itemRoot, "replace.html"), regex.replaceString as string);
      regex.replaceString = "";
    }
    await writeJson(join(itemRoot, "meta.json"), regex);
    items.push({
      uid,
      ...(optionalString(original.id) ? { id: original.id as string } : {}),
      ...(optionalString(original.scriptName) ? { name: original.scriptName as string } : {}),
      findKind,
      replaceKind,
    });
  }

  const index: OrderedIndex<RegexIndexItem> = { schemaVersion: 1, items };
  await writeJson(join(directory, "index.json"), index as unknown as JsonValue);
}

async function splitScripts(projectRoot: string, scripts: JsonValue[]): Promise<void> {
  const directory = join(projectRoot, "scripts");
  await mkdir(directory, { recursive: true });
  const items: ScriptIndexItem[] = [];

  for (let index = 0; index < scripts.length; index += 1) {
    const original = scripts[index];
    if (!isJsonObject(original)) throw new ApiError(422, "INVALID_PRESET", `scripts[${index}] is not an object`);
    const script = cloneJson(original);
    const uid = randomUUID();
    const itemRoot = join(directory, uid);
    await mkdir(itemRoot, { recursive: true });
    const hasContent = Object.hasOwn(script, "content");
    const textContent = typeof script.content === "string";
    const contentKind: ScriptIndexItem["contentKind"] = textContent ? "text" : hasContent ? "inline" : "absent";

    if (textContent) {
      await atomicWriteFile(join(itemRoot, "content.js"), script.content as string);
      delete script.content;
    }
    await writeJson(join(itemRoot, "meta.json"), script);
    items.push({
      uid,
      ...(optionalString(original.id) ? { id: original.id as string } : {}),
      ...(optionalString(original.name) ? { name: original.name as string } : {}),
      contentKind,
    });
  }

  const index: OrderedIndex<ScriptIndexItem> = { schemaVersion: 1, items };
  await writeJson(join(directory, "index.json"), index as unknown as JsonValue);
}

export async function splitPresetProject(
  projectRoot: string,
  id: string,
  input: ImportProjectInput,
): Promise<ProjectManifest> {
  assertChatCompletionPreset(input.preset);
  const original = cloneJson(input.preset);
  const base = cloneJson(input.preset);
  const regexDetection = detectRegexMirrors(original);
  const scripts = getAtPath(original, ["extensions", "tavern_helper", "scripts"]);
  const manifest = makeManifest(id, input, original, regexDetection);

  delete base.prompts;
  delete base.prompt_order;

  if (regexDetection?.binding.consistent) {
    const extensions = base.extensions;
    if (isJsonObject(extensions) && Array.isArray(extensions.regex_scripts)) extensions.regex_scripts = [];
    const binding = getAtPath(base, ["extensions", "SPreset", "RegexBinding"]);
    if (isJsonObject(binding) && Array.isArray(binding.regexes)) binding.regexes = [];
  }
  if (manifest.managedPaths.scripts) {
    const helper = getAtPath(base, ["extensions", "tavern_helper"]);
    if (isJsonObject(helper)) helper.scripts = [];
  }

  await mkdir(projectRoot, { recursive: true });
  await Promise.all([
    mkdir(join(projectRoot, "snapshots"), { recursive: true }),
    mkdir(join(projectRoot, "recovery"), { recursive: true }),
    mkdir(join(projectRoot, "output"), { recursive: true }),
  ]);
  await writeJson(join(projectRoot, "preset.base.json"), base);
  await splitPrompts(projectRoot, original.prompts as JsonValue[], regexDetection);
  await writeJson(join(projectRoot, "prompts", "prompt-order.json"), original.prompt_order as JsonValue);
  if (manifest.managedPaths.regex && regexDetection) await splitRegex(projectRoot, regexDetection.regexes);
  if (manifest.managedPaths.scripts && Array.isArray(scripts)) await splitScripts(projectRoot, scripts);

  // Commit the manifest last. Project discovery treats it as the transaction marker.
  await writeJson(join(projectRoot, "project.json"), manifest as unknown as JsonValue);
  return manifest;
}

export function createBlankPreset(): JsonObject {
  return {
    temperature: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    top_p: 1,
    stream_openai: true,
    prompts: [],
    prompt_order: [{ character_id: 100001, order: [] }],
    extensions: {},
  };
}
