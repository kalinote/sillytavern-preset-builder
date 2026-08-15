export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ProjectSourceType = "empty" | "uploaded-json" | "sillytavern" | "project-package";

export interface ManagedPaths {
  prompts: boolean;
  promptOrder: boolean;
  regex: boolean;
  scripts: boolean;
}

export interface RegexMirrorBinding {
  authority: string;
  targets: string[];
  consistent: boolean;
  promptIdentifier?: string;
}

export interface ProjectManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  source: {
    type: ProjectSourceType;
    presetName?: string;
    stVersion?: string;
  };
  targetPresetName: string;
  originalJsonSha256?: string;
  buildRulesVersion: 1;
  managedPaths: ManagedPaths;
  regexMirrorBinding?: RegexMirrorBinding;
  preservation: {
    unknownFields: "preset.base.json";
    semanticRoundTrip: true;
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  version: string;
  source: ProjectSourceType;
  targetPresetName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileEntry {
  path: string;
  type: "file" | "directory";
  size: number;
  updatedAt: string;
}

export interface ProjectFile {
  path: string;
  content: string;
  size: number;
  revision: string;
  updatedAt: string;
}

export interface Diagnostic {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
}

export interface BuildResult {
  preset: JsonObject;
  diagnostics: Diagnostic[];
  revision: string;
  size: number;
}

export interface PromptIndexItem {
  uid: string;
  identifier?: string;
  name?: string;
  contentKind: "text" | "inline" | "absent";
}

export interface RegexIndexItem {
  uid: string;
  id?: string;
  name?: string;
  findKind: "text" | "inline" | "absent";
  replaceKind: "text" | "inline" | "absent";
}

export interface ScriptIndexItem {
  uid: string;
  id?: string;
  name?: string;
  contentKind: "text" | "inline" | "absent";
}

export interface OrderedIndex<T> {
  schemaVersion: 1;
  items: T[];
}

export interface ImportProjectInput {
  name?: string;
  version?: string;
  preset: JsonObject;
  sourceType?: ProjectSourceType;
  sourcePresetName?: string;
  sourceStVersion?: string;
}
