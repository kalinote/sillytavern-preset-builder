import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

import type {
  CodeEditorLanguage,
  EditorImplementationProps,
} from "./types";
import {
  clampEditorOffset,
  readEditorViewState,
  writeEditorViewState,
} from "./view-state";

interface RegexStreamState {
  inCharacterClass: boolean;
}

const regexLanguage = StreamLanguage.define<RegexStreamState>({
  startState: () => ({ inCharacterClass: false }),
  token(stream, state) {
    const character = stream.next();
    if (character === null) return null;

    if (character === "\\") {
      stream.next();
      return "escape";
    }

    if (state.inCharacterClass) {
      if (character === "]") state.inCharacterClass = false;
      return character === "]" ? "bracket" : "string";
    }

    if (character === "[") {
      state.inCharacterClass = true;
      return "bracket";
    }

    if (character === "(" || character === ")") return "bracket";
    if (character === "|") return "operator";
    if (character === "^" || character === "$") return "keyword";
    if (character === ".") return "regexp";
    if (character === "?" || character === "*" || character === "+") {
      stream.eat("?");
      return "operator";
    }
    if (character === "{") {
      stream.eatWhile(/[\d,]/);
      stream.eat("}");
      stream.eat("?");
      return "operator";
    }

    stream.eatWhile(/[^\\\[\](){}?*+|.^$]/);
    return null;
  },
});

function codeMirrorLanguage(language: CodeEditorLanguage | undefined): Extension {
  switch (language?.toLowerCase()) {
    case "prompt":
    case "markdown":
    case "md":
      return markdown();
    case "json":
    case "jsonc":
      return json();
    case "javascript":
    case "js":
      return javascript();
    case "typescript":
    case "ts":
      return javascript({ typescript: true });
    case "html":
      return html();
    case "css":
      return css();
    case "regex":
      return regexLanguage;
    default:
      return [];
  }
}

function shouldWrapLines(
  language: CodeEditorLanguage | undefined,
  largeFile: boolean,
) {
  if (largeFile) return false;
  const normalizedLanguage = language?.toLowerCase();
  return (
    normalizedLanguage === "prompt" ||
    normalizedLanguage === "markdown" ||
    normalizedLanguage === "md"
  );
}

function lineWrappingExtension(
  language: CodeEditorLanguage | undefined,
  largeFile: boolean,
): Extension {
  return shouldWrapLines(language, largeFile) ? EditorView.lineWrapping : [];
}

function editableExtension(readOnly: boolean): Extension {
  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
}

function contentAttributes(ariaLabel: string, readOnly: boolean): Extension {
  return EditorView.contentAttributes.of({
    "aria-label": ariaLabel,
    "aria-readonly": String(readOnly),
    autocapitalize: "off",
    autocomplete: "off",
    autocorrect: "off",
    spellcheck: "false",
  });
}

const mobileTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#fbfcfe",
      color: "#2a3548",
      fontSize: "13px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily:
        '"SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas, monospace',
      lineHeight: "22px",
    },
    ".cm-content": {
      minWidth: "0",
      padding: "14px 0 28px",
      caretColor: "#2563eb",
    },
    ".cm-line": { padding: "0 14px 0 8px" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#2563eb" },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "#bed5ff !important",
    },
    ".cm-activeLine": { backgroundColor: "#eff5ff" },
    ".cm-gutters": {
      backgroundColor: "#f3f6fa",
      borderRight: "1px solid #e7ecf3",
      color: "#9ca8ba",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#eaf2ff",
      color: "#2563eb",
    },
    ".cm-foldGutter": { width: "12px" },
    ".cm-panels": { backgroundColor: "#f8faff", color: "#2a3548" },
    ".cm-panel.cm-search": {
      borderBottom: "1px solid #dfe6ef",
      padding: "8px",
    },
    ".cm-panel.cm-search input": {
      border: "1px solid #d5deea",
      borderRadius: "6px",
      backgroundColor: "#ffffff",
      padding: "5px 8px",
      outline: "none",
    },
    ".cm-panel.cm-search input:focus": {
      borderColor: "#7aa2f7",
      boxShadow: "0 0 0 2px rgb(37 99 235 / 14%)",
    },
    ".cm-panel.cm-search button": {
      border: "1px solid #d5deea",
      borderRadius: "6px",
      backgroundColor: "#ffffff",
      padding: "4px 8px",
    },
    ".cm-tooltip": {
      border: "1px solid #dfe6ef",
      borderRadius: "8px",
      backgroundColor: "#ffffff",
      boxShadow: "0 8px 24px rgb(15 23 42 / 10%)",
      overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "#eaf2ff",
      color: "#172033",
    },
    ".cm-matchingBracket": {
      backgroundColor: "#eaf2ff",
      outline: "1px solid #7aa2f7",
    },
  },
  { dark: false },
);

const mobileBaseSetup: Extension = [
  lineNumbers(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  keymap.of([
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    indentWithTab,
  ]),
];

/** Features which are useful for normal files but costly on multi-MB input. */
const mobileEnhancedSetup: Extension = [
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  foldGutter(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of(foldKeymap),
];

export function CodeMirrorCodeEditor({
  value,
  onChange,
  language,
  readOnly = false,
  largeFile = false,
  viewStateKey,
  ariaLabel = "源码编辑器",
}: EditorImplementationProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const applyingControlledValue = useRef(false);
  const compartmentsRef = useRef({
    language: new Compartment(),
    editable: new Compartment(),
    attributes: new Compartment(),
    wrapping: new Compartment(),
    enhancedFeatures: new Compartment(),
  });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const compartments = compartmentsRef.current;
    const savedViewState = readEditorViewState(viewStateKey);
    const documentLength = value.length;
    const state = EditorState.create({
      doc: value,
      selection: savedViewState
        ? {
            anchor: clampEditorOffset(
              savedViewState.anchor,
              documentLength,
            ),
            head: clampEditorOffset(savedViewState.head, documentLength),
          }
        : undefined,
      extensions: [
        mobileBaseSetup,
        mobileTheme,
        compartments.language.of(
          largeFile ? [] : codeMirrorLanguage(language),
        ),
        compartments.editable.of(editableExtension(readOnly)),
        compartments.attributes.of(contentAttributes(ariaLabel, readOnly)),
        compartments.wrapping.of(lineWrappingExtension(language, largeFile)),
        compartments.enhancedFeatures.of(
          largeFile ? [] : mobileEnhancedSetup,
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingControlledValue.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    if (savedViewState) {
      view.scrollDOM.scrollLeft = savedViewState.scrollLeft;
      view.scrollDOM.scrollTop = savedViewState.scrollTop;
    }

    return () => {
      const selection = view.state.selection.main;
      writeEditorViewState(viewStateKey, {
        anchor: selection.anchor,
        head: selection.head,
        scrollLeft: view.scrollDOM.scrollLeft,
        scrollTop: view.scrollDOM.scrollTop,
      });
      view.destroy();
      viewRef.current = null;
    };
    // The compartments update configuration without recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue === value) return;

    applyingControlledValue.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
    applyingControlledValue.current = false;
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const compartments = compartmentsRef.current;
    view.dispatch({
      effects: [
        compartments.language.reconfigure(
          largeFile ? [] : codeMirrorLanguage(language),
        ),
        compartments.wrapping.reconfigure(
          lineWrappingExtension(language, largeFile),
        ),
        compartments.enhancedFeatures.reconfigure(
          largeFile ? [] : mobileEnhancedSetup,
        ),
      ],
    });
  }, [language, largeFile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const compartments = compartmentsRef.current;
    view.dispatch({
      effects: [
        compartments.editable.reconfigure(editableExtension(readOnly)),
        compartments.attributes.reconfigure(
          contentAttributes(ariaLabel, readOnly),
        ),
      ],
    });
  }, [ariaLabel, readOnly]);

  return (
    <div
      ref={hostRef}
      className="adaptive-code-editor__codemirror"
      data-testid="codemirror-editor"
      data-word-wrap={shouldWrapLines(language, largeFile) ? "on" : "off"}
      data-large-file={largeFile ? "true" : "false"}
    />
  );
}
