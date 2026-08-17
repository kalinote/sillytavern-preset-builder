import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "../../lib/utils";

const PANEL_WIDTHS_KEY = "preset-studio:panel-widths:v1";
const KEYBOARD_STEP = 16;
const LARGE_KEYBOARD_STEP = 48;

type SidebarSide = "left" | "right";

interface ResizableSidebarProps {
  side: SidebarSide;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  label: string;
  children: ReactNode;
  className?: string;
  id?: string;
  "data-testid"?: string;
}

export function ResizableSidebar({
  side,
  defaultWidth,
  minWidth,
  maxWidth,
  label,
  children,
  className,
  id,
  "data-testid": dataTestId,
}: ResizableSidebarProps) {
  const [width, setWidth] = useState(() =>
    clamp(readStoredWidth(side) ?? defaultWidth, minWidth, maxWidth),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(width);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const applyWidth = useCallback(
    (nextWidth: number, commit: boolean) => {
      const clampedWidth = clamp(Math.round(nextWidth), minWidth, maxWidth);
      widthRef.current = clampedWidth;
      panelRef.current?.style.setProperty("width", `${clampedWidth}px`);
      separatorRef.current?.setAttribute("aria-valuenow", String(clampedWidth));
      if (commit) {
        setWidth(clampedWidth);
        writeStoredWidth(side, clampedWidth);
      }
    },
    [maxWidth, minWidth, side],
  );

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const direction = side === "left" ? 1 : -1;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      applyWidth(startWidth + (moveEvent.clientX - startX) * direction, false);
    };
    const finishDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      dragCleanupRef.current = null;
      applyWidth(widthRef.current, true);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishDrag, { once: true });
    window.addEventListener("pointercancel", finishDrag, { once: true });
    dragCleanupRef.current = finishDrag;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? LARGE_KEYBOARD_STEP : KEYBOARD_STEP;
    const direction = side === "left" ? 1 : -1;
    let nextWidth: number | undefined;

    if (event.key === "ArrowLeft") nextWidth = widthRef.current - step * direction;
    if (event.key === "ArrowRight") nextWidth = widthRef.current + step * direction;
    if (event.key === "Home") nextWidth = minWidth;
    if (event.key === "End") nextWidth = maxWidth;
    if (nextWidth === undefined) return;

    event.preventDefault();
    applyWidth(nextWidth, true);
  };

  return (
    <div
      ref={panelRef}
      id={id}
      data-testid={dataTestId}
      className={cn("relative flex min-h-0 shrink-0", className)}
      style={{ width }}
    >
      {children}
      <div
        ref={separatorRef}
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        title={`${label}；方向键微调，Shift+方向键大幅调整，双击恢复默认`}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => applyWidth(defaultWidth, true)}
        className={cn(
          "group absolute inset-y-0 z-30 w-2 touch-none cursor-col-resize outline-none",
          side === "left" ? "-right-1" : "-left-1",
        )}
      >
        <span
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/70 group-focus-visible:w-0.5 group-focus-visible:bg-primary group-active:w-0.5 group-active:bg-primary"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function readStoredWidth(side: SidebarSide): number | undefined {
  try {
    const raw = localStorage.getItem(PANEL_WIDTHS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = (parsed as Record<string, unknown>)[side];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredWidth(side: SidebarSide, width: number) {
  try {
    const raw = localStorage.getItem(PANEL_WIDTHS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : undefined;
    const widths = parsed && typeof parsed === "object"
      ? { ...(parsed as Record<string, unknown>) }
      : {};
    widths[side] = width;
    localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    // Storage restrictions must not prevent resizing the live workspace.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
