export type CodeEditorLanguage =
  | "prompt"
  | "plaintext"
  | "text"
  | "markdown"
  | "md"
  | "json"
  | "jsonc"
  | "javascript"
  | "js"
  | "typescript"
  | "ts"
  | "regex"
  | "html"
  | "css"
  | (string & {});

export interface AdaptiveCodeEditorProps {
  /** The editor is controlled; this value is kept when the responsive editor changes. */
  value: string;
  onChange: (value: string) => void;
  language?: CodeEditorLanguage;
  readOnly?: boolean;
  /** Enables conservative editor options for multi-megabyte script files. */
  largeFile?: boolean;
  /** Stable project/file identity used to restore selection and scroll in memory. */
  viewStateKey?: string;
  ariaLabel?: string;
  className?: string;
  height?: number | string;
  placeholder?: string;
}

export type EditorImplementationProps = Pick<
  AdaptiveCodeEditorProps,
  | "value"
  | "onChange"
  | "language"
  | "readOnly"
  | "largeFile"
  | "viewStateKey"
  | "ariaLabel"
>;
