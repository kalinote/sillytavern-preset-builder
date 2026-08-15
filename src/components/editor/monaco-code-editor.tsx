import Editor, {
  type BeforeMount,
  type OnMount,
} from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { EditorLoading } from "./editor-loading";
import {
  configureMonacoLanguageServices,
  configureMonacoTheme,
  configurePresetLanguages,
  monaco,
  PRESET_REGEX_LANGUAGE_ID,
} from "./monaco-setup";
import type {
  CodeEditorLanguage,
  EditorImplementationProps,
} from "./types";
import {
  clampEditorOffset,
  readEditorViewState,
  writeEditorViewState,
} from "./view-state";

function toMonacoLanguage(language: CodeEditorLanguage | undefined) {
  switch (language?.toLowerCase()) {
    case "prompt":
    case "markdown":
    case "md":
      return "markdown";
    case "json":
    case "jsonc":
      return "json";
    case "javascript":
    case "js":
      return "javascript";
    case "typescript":
    case "ts":
      return "typescript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "regex":
      return PRESET_REGEX_LANGUAGE_ID;
    case "text":
    case "plaintext":
    default:
      return "plaintext";
  }
}

export function MonacoCodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  largeFile = false,
  viewStateKey,
  ariaLabel = "源码编辑器",
}: EditorImplementationProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelLanguage = toMonacoLanguage(language);

  useEffect(() => {
    configureMonacoLanguageServices(largeFile);
  }, [largeFile]);

  const beforeMount = useCallback<BeforeMount>(() => {
    configureMonacoTheme();
    configurePresetLanguages();
    configureMonacoLanguageServices(largeFile);
  }, [largeFile]);

  const onMount = useCallback<OnMount>(
    (editor) => {
      editorRef.current = editor;
      const model = editor.getModel();
      model?.updateOptions({ insertSpaces: true, tabSize: 2 });
      editor.layout();

      const savedViewState = readEditorViewState(viewStateKey);
      if (!model || !savedViewState) return;
      const documentLength = model.getValueLength();
      const anchor = model.getPositionAt(
        clampEditorOffset(savedViewState.anchor, documentLength),
      );
      const head = model.getPositionAt(
        clampEditorOffset(savedViewState.head, documentLength),
      );
      editor.setSelection(
        new monaco.Selection(
          anchor.lineNumber,
          anchor.column,
          head.lineNumber,
          head.column,
        ),
      );
      editor.setScrollLeft(savedViewState.scrollLeft);
      editor.setScrollTop(savedViewState.scrollTop);
    },
    [viewStateKey],
  );

  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const selection = editor?.getSelection();
      if (editor && model && selection) {
        writeEditorViewState(viewStateKey, {
          anchor: model.getOffsetAt(selection.getSelectionStart()),
          head: model.getOffsetAt(selection.getPosition()),
          scrollLeft: editor.getScrollLeft(),
          scrollTop: editor.getScrollTop(),
        });
      }
      editorRef.current = null;
    };
  }, [viewStateKey]);

  const options = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      accessibilitySupport: "auto",
      ariaLabel,
      automaticLayout: true,
      bracketPairColorization: { enabled: !largeFile },
      codeLens: false,
      colorDecorators: !largeFile,
      contextmenu: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: largeFile ? "off" : "on",
      domReadOnly: readOnly,
      fixedOverflowWidgets: true,
      folding: !largeFile,
      fontFamily:
        '"SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontLigatures: !largeFile,
      fontSize: 13,
      glyphMargin: false,
      guides: {
        bracketPairs: !largeFile,
        indentation: !largeFile,
      },
      hover: { enabled: largeFile ? "off" : "on", delay: 300 },
      lineHeight: 22,
      lineNumbersMinChars: 4,
      links: !largeFile,
      minimap: { enabled: !largeFile, maxColumn: 80, scale: 1 },
      occurrencesHighlight: largeFile ? "off" : "singleFile",
      padding: { top: 14, bottom: 14 },
      quickSuggestions: largeFile
        ? false
        : { comments: false, other: true, strings: false },
      readOnly,
      renderValidationDecorations: largeFile ? "off" : "editable",
      scrollBeyondLastLine: false,
      selectionHighlight: !largeFile,
      semanticHighlighting: { enabled: !largeFile },
      smoothScrolling: !largeFile,
      stickyScroll: { enabled: !largeFile },
      suggest: { showWords: !largeFile },
      tabSize: 2,
      unicodeHighlight: {
        ambiguousCharacters: !largeFile,
        invisibleCharacters: !largeFile,
      },
      wordBasedSuggestions: largeFile ? "off" : "matchingDocuments",
      wordWrap:
        modelLanguage === "markdown" || modelLanguage === "plaintext"
          ? "on"
          : "off",
    }),
    [ariaLabel, largeFile, modelLanguage, readOnly],
  );

  return (
    <Editor
      value={value}
      language={modelLanguage}
      theme="preset-studio-light"
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      options={options}
      loading={<EditorLoading label="正在加载 Monaco 编辑器" />}
      height="100%"
      keepCurrentModel={false}
      wrapperProps={{
        "data-testid": "monaco-editor",
        "data-word-wrap":
          modelLanguage === "markdown" || modelLanguage === "plaintext"
            ? "on"
            : "off",
        "data-large-file": largeFile ? "true" : "false",
      }}
    />
  );
}
