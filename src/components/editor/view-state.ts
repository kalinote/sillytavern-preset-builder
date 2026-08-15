export interface EditorViewSnapshot {
  anchor: number;
  head: number;
  scrollLeft: number;
  scrollTop: number;
}

const MAX_SAVED_VIEW_STATES = 64;
const savedViewStates = new Map<string, EditorViewSnapshot>();

export function readEditorViewState(
  key: string | undefined,
): EditorViewSnapshot | undefined {
  if (!key) return undefined;
  const snapshot = savedViewStates.get(key);
  if (!snapshot) return undefined;

  // Refresh insertion order so frequently visited files stay in the small LRU.
  savedViewStates.delete(key);
  savedViewStates.set(key, snapshot);
  return snapshot;
}

export function writeEditorViewState(
  key: string | undefined,
  snapshot: EditorViewSnapshot,
) {
  if (!key) return;
  savedViewStates.delete(key);
  savedViewStates.set(key, snapshot);

  while (savedViewStates.size > MAX_SAVED_VIEW_STATES) {
    const oldestKey = savedViewStates.keys().next().value;
    if (oldestKey === undefined) return;
    savedViewStates.delete(oldestKey);
  }
}

export function clampEditorOffset(offset: number, documentLength: number) {
  return Math.max(0, Math.min(offset, documentLength));
}
