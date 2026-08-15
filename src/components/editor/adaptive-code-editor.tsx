import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type CSSProperties,
} from "react";

import "./adaptive-code-editor.css";
import { EditorLoading } from "./editor-loading";
import type { AdaptiveCodeEditorProps } from "./types";

const MonacoCodeEditor = lazy(async () => {
  const module = await import("./monaco-code-editor");
  return { default: module.MonacoCodeEditor };
});

const CodeMirrorCodeEditor = lazy(async () => {
  const module = await import("./codemirror-code-editor");
  return { default: module.CodeMirrorCodeEditor };
});

/**
 * Shared by the application shell and the editor implementation switch.
 *
 * The height guard keeps wide landscape phones on the touch-oriented editor,
 * while regular landscape tablets (for example 1024 × 600) still use Monaco.
 */
export const DESKTOP_EDITOR_QUERY =
  "(min-width: 768px) and (min-height: 500px)";

function getDesktopEditorPreference() {
  return typeof window === "undefined"
    ? true
    : window.matchMedia(DESKTOP_EDITOR_QUERY).matches;
}

function joinClassNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

/**
 * A responsive, controlled source editor.
 *
 * Monaco is loaded on desktop and landscape-tablet breakpoints. CodeMirror 6
 * is loaded below 768 px so the mobile bundle and touch interaction stay light.
 */
export function AdaptiveCodeEditor({
  value,
  onChange,
  language = "plaintext",
  readOnly = false,
  largeFile = false,
  viewStateKey,
  ariaLabel = "源码编辑器",
  className,
  height = "100%",
  placeholder = "开始输入内容…",
}: AdaptiveCodeEditorProps) {
  const [usesMonaco, setUsesMonaco] = useState(getDesktopEditorPreference);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_EDITOR_QUERY);
    const updateEditor = (event: MediaQueryListEvent) => {
      setUsesMonaco(event.matches);
    };

    setUsesMonaco(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateEditor);
      return () => mediaQuery.removeEventListener("change", updateEditor);
    }

    // Older iOS WebViews expose the legacy listener API only.
    mediaQuery.addListener(updateEditor);
    return () => mediaQuery.removeListener(updateEditor);
  }, []);

  const style: CSSProperties = {
    height: typeof height === "number" ? `${height}px` : height,
  };

  const implementationProps = {
    value,
    onChange,
    language,
    readOnly,
    largeFile,
    viewStateKey,
    ariaLabel,
  };

  return (
    <section
      className={joinClassNames("adaptive-code-editor", className)}
      style={style}
      data-editor={usesMonaco ? "monaco" : "codemirror"}
      data-read-only={readOnly ? "true" : "false"}
      aria-label={`${ariaLabel}容器`}
    >
      <Suspense fallback={<EditorLoading />}>
        {usesMonaco ? (
          <MonacoCodeEditor {...implementationProps} />
        ) : (
          <CodeMirrorCodeEditor {...implementationProps} />
        )}
      </Suspense>

      {value.length === 0 && (
        <div className="adaptive-code-editor__empty" aria-hidden="true">
          {placeholder}
        </div>
      )}

      <span className="adaptive-code-editor__implementation" aria-live="polite">
        {usesMonaco ? "桌面编辑器已就绪" : "移动编辑器已就绪"}
      </span>
    </section>
  );
}

export default AdaptiveCodeEditor;
