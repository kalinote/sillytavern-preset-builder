interface EditorLoadingProps {
  label?: string;
}

export function EditorLoading({ label = "正在加载编辑器" }: EditorLoadingProps) {
  return (
    <div className="adaptive-code-editor__loading" role="status">
      <span className="adaptive-code-editor__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
