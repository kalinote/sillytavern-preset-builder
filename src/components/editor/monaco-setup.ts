import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { jsonDefaults } from "monaco-editor/languages/features/json/register";
import {
  javascriptDefaults,
  typescriptDefaults,
} from "monaco-editor/languages/features/typescript/register";

interface MonacoWorkerEnvironment {
  getWorker(moduleId: string, label: string): Worker;
}

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: MonacoWorkerEnvironment;
};

monacoGlobal.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") {
      return new CssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new HtmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new TypeScriptWorker();
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });

const PRESET_REGEX_LANGUAGE_ID = "sillytavern-regex";
let presetLanguagesConfigured = false;

export function configurePresetLanguages() {
  if (presetLanguagesConfigured) return;
  presetLanguagesConfigured = true;

  monaco.languages.register({
    id: PRESET_REGEX_LANGUAGE_ID,
    aliases: ["SillyTavern Regex", "Regex"],
  });
  monaco.languages.setLanguageConfiguration(PRESET_REGEX_LANGUAGE_ID, {
    brackets: [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: "{", close: "}" },
    ],
  });
  monaco.languages.setMonarchTokensProvider(PRESET_REGEX_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/\\\\./, "regexp.escape"],
        [/\[(?:\\\\.|[^\\\]])*\]/, "regexp.characterclass"],
        [/\(\?(?:[:=!]|<[=!])/, "regexp.group"],
        [/[()|]/, "regexp.group"],
        [/(?:[?*+]|\{\d+(?:,\d*)?\})\??/, "regexp.quantifier"],
        [/[\^$]/, "regexp.anchor"],
        [/\./, "regexp.dot"],
        [/[^\\\[\](){}?*+|.^$]+/, "regexp"],
      ],
    },
  });
}

export function configureMonacoTheme() {
  monaco.editor.defineTheme("preset-studio-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "718096", fontStyle: "italic" },
      { token: "keyword", foreground: "1D4ED8" },
      { token: "string", foreground: "0F766E" },
      { token: "number", foreground: "B45309" },
      { token: "regexp", foreground: "BE185D" },
      { token: "regexp.escape", foreground: "2563EB", fontStyle: "bold" },
      { token: "regexp.characterclass", foreground: "0F766E" },
      { token: "regexp.group", foreground: "7C3AED" },
      { token: "regexp.quantifier", foreground: "B45309" },
      { token: "regexp.anchor", foreground: "BE185D", fontStyle: "bold" },
      { token: "regexp.dot", foreground: "64748B" },
      { token: "type", foreground: "6D28D9" },
      { token: "delimiter", foreground: "64748B" },
    ],
    colors: {
      "editor.background": "#FBFCFE",
      "editor.foreground": "#2A3548",
      "editorGutter.background": "#F3F6FA",
      "editorLineNumber.foreground": "#9CA8BA",
      "editorLineNumber.activeForeground": "#2563EB",
      "editor.lineHighlightBackground": "#EFF5FF",
      "editor.selectionBackground": "#BED5FF",
      "editor.inactiveSelectionBackground": "#DCE9FF",
      "editorCursor.foreground": "#2563EB",
      "editorIndentGuide.background1": "#E2E8F0",
      "editorIndentGuide.activeBackground1": "#A9BBD6",
      "editorBracketMatch.background": "#EAF2FF",
      "editorBracketMatch.border": "#7AA2F7",
      "editorWidget.background": "#FFFFFF",
      "editorWidget.border": "#DFE6EF",
      "editorSuggestWidget.background": "#FFFFFF",
      "editorSuggestWidget.border": "#DFE6EF",
      "editorSuggestWidget.selectedBackground": "#EAF2FF",
      "editorHoverWidget.background": "#FFFFFF",
      "editorHoverWidget.border": "#DFE6EF",
      "scrollbarSlider.background": "#AAB6C633",
      "scrollbarSlider.hoverBackground": "#8C9AAF55",
      "scrollbarSlider.activeBackground": "#71809666",
      focusBorder: "#2563EB",
    },
  });
}

/** Language-service defaults are global in Monaco; the workbench owns one editor. */
export function configureMonacoLanguageServices(largeFile: boolean) {
  const languageFeaturesEnabled = !largeFile;

  jsonDefaults.setDiagnosticsOptions({
    validate: languageFeaturesEnabled,
    allowComments: true,
    trailingCommas: "ignore",
    schemas: [],
  });
  jsonDefaults.setModeConfiguration({
    documentFormattingEdits: languageFeaturesEnabled,
    documentRangeFormattingEdits: languageFeaturesEnabled,
    completionItems: languageFeaturesEnabled,
    hovers: languageFeaturesEnabled,
    documentSymbols: languageFeaturesEnabled,
    tokens: languageFeaturesEnabled,
    colors: languageFeaturesEnabled,
    foldingRanges: languageFeaturesEnabled,
    diagnostics: languageFeaturesEnabled,
    selectionRanges: languageFeaturesEnabled,
  });

  const diagnostics = {
    noSemanticValidation: largeFile,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: largeFile,
  };

  javascriptDefaults.setDiagnosticsOptions(diagnostics);
  typescriptDefaults.setDiagnosticsOptions(diagnostics);
  const typeScriptFeatures = {
    completionItems: languageFeaturesEnabled,
    hovers: languageFeaturesEnabled,
    documentSymbols: languageFeaturesEnabled,
    definitions: languageFeaturesEnabled,
    references: languageFeaturesEnabled,
    documentHighlights: languageFeaturesEnabled,
    rename: languageFeaturesEnabled,
    diagnostics: languageFeaturesEnabled,
    documentRangeFormattingEdits: languageFeaturesEnabled,
    signatureHelp: languageFeaturesEnabled,
    onTypeFormattingEdits: languageFeaturesEnabled,
    codeActions: languageFeaturesEnabled,
    inlayHints: languageFeaturesEnabled,
  };
  javascriptDefaults.setModeConfiguration(typeScriptFeatures);
  typescriptDefaults.setModeConfiguration(typeScriptFeatures);
  javascriptDefaults.setEagerModelSync(languageFeaturesEnabled);
  typescriptDefaults.setEagerModelSync(languageFeaturesEnabled);
}

export { monaco };
export { PRESET_REGEX_LANGUAGE_ID };
