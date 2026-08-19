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

export interface ProjectPreviewSettings {
  javascriptEnabled: boolean;
}

export interface ProjectManifest {
  schemaVersion: 2;
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
  preview: ProjectPreviewSettings;
  regexMirrorBinding?: RegexMirrorBinding;
  preservation: {
    unknownFields: "preset.base.json";
    semanticRoundTrip: true;
  };
}

export interface PreviewRuntimeScript {
  uid: string;
  id: string;
  name: string;
  index: number;
  enabled: boolean;
  executable: boolean;
  path: string;
  byteLength: number;
  contentHash: string;
}

export interface PreviewRuntimeRegex {
  uid: string;
  id: string;
  name: string;
  index: number;
  disabled: boolean;
  runOnEdit: boolean;
  findPath: string;
  replacePath: string;
  metaPath: string;
}

export interface PreviewRuntimeManifest {
  projectId: string;
  projectUpdatedAt: string;
  javascriptEnabled: boolean;
  scripts: PreviewRuntimeScript[];
  regexScripts: PreviewRuntimeRegex[];
  totalEnabledScriptBytes: number;
  compatibility: {
    spresetPresent: boolean;
    promptTemplateHints: string[];
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
  displayName?: string;
  order?: number;
  role?: "source-json";
}

export interface ProjectFile {
  path: string;
  content: string;
  size: number;
  revision: string;
  updatedAt: string;
  role?: "source-json";
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

export type ProjectItemKind = "prompt" | "regex" | "script";

export interface PromptStructureItem {
  kind: "prompt";
  uid: string;
  order: number;
  name?: string;
  identifier?: string;
  role?: string;
  enabled?: boolean;
  marker?: JsonValue;
}

export interface RegexStructureItem {
  kind: "regex";
  uid: string;
  order: number;
  name?: string;
  id?: string;
  disabled?: boolean;
  runOnEdit?: boolean;
  placement?: JsonValue;
  minDepth?: number;
  maxDepth?: number;
}

export interface ScriptStructureItem {
  kind: "script";
  uid: string;
  order: number;
  name?: string;
  id?: string;
  enabled?: boolean;
}

export interface ProjectPluginSummary {
  id: string;
  displayName: string;
  extensionKey: string;
  known: boolean;
  configSourcePath: "preset.base.json";
}

export interface ProjectStructure {
  projectId: string;
  projectRevision: string;
  revision: string;
  prompts: PromptStructureItem[];
  regex: RegexStructureItem[];
  scripts: ScriptStructureItem[];
  plugins: ProjectPluginSummary[];
  promptOrder: JsonValue[];
}

export type StructureMutation =
  | { op: "create"; kind: ProjectItemKind; afterUid?: string; template?: "blank" }
  | { op: "duplicate"; kind: ProjectItemKind; uid: string }
  | { op: "patch"; kind: ProjectItemKind; uid: string; patch: JsonObject }
  | {
      op: "delete";
      kind: ProjectItemKind;
      uid: string;
      removePromptOrderReferences?: boolean;
    }
  | { op: "reorder"; kind: ProjectItemKind; uids: string[] }
  | { op: "set-prompt-order"; promptOrder: JsonValue[] };

export type SnapshotKind = "manual" | "automatic";
export type SnapshotReason =
  | "manual"
  | "before-item-delete"
  | "before-source-json-apply"
  | "before-snapshot-restore";

export interface ProjectSnapshotSummary {
  uid: string;
  label: string;
  kind: SnapshotKind;
  reason: SnapshotReason;
  createdAt: string;
  presetRevision: string;
  size: number;
}

export interface SnapshotIndex {
  schemaVersion: 1;
  items: ProjectSnapshotSummary[];
}

export interface ImportProjectInput {
  name?: string;
  version?: string;
  preset: JsonObject;
  sourceType?: ProjectSourceType;
  sourcePresetName?: string;
  sourceStVersion?: string;
  preview?: ProjectPreviewSettings;
}
