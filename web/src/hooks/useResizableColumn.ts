import { useCallback, useEffect, useRef, useState } from "react";
import {
  readPanelSizePreference,
  writePanelSizePreference,
  type PanelSizePreferenceKey,
} from "@/lib/panelSizePreferences";

/** Resize a left column relative to its container, optionally remembering the user's choice. */
export function useResizableColumn(
  defaultWidth = 176,
  minWidth = 100,
  maxWidth = 480,
  options: { preferenceKey?: PanelSizePreferenceKey; label?: string; enabled?: boolean } = {},
) {
  const { preferenceKey, label = "Resize terminal list", enabled = true } = options;
  const [preferredWidth, setPreferredWidth] = useState(() =>
    preferenceKey ? readPanelSizePreference(preferenceKey) : null,
  );
  const width = Math.max(minWidth, Math.min(maxWidth, preferredWidth ?? defaultWidth));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ overlay: HTMLDivElement; cursor: string; userSelect: string } | null>(null);
  const current = useRef({ minWidth, maxWidth, width, preferenceKey });
  current.current = { minWidth, maxWidth, width, preferenceKey };

  const finish = useCallback(() => {
    if (!drag.current) return;
    const { overlay, cursor, userSelect } = drag.current;
    overlay.remove();
    document.body.style.cursor = cursor;
    document.body.style.userSelect = userSelect;
    drag.current = null;
    const latest = current.current;
    if (latest.preferenceKey) writePanelSizePreference(latest.preferenceKey, latest.width);
  }, []);

  const resize = useCallback((candidate: number) => {
    const bounds = current.current;
    const next = Math.max(bounds.minWidth, Math.min(bounds.maxWidth, candidate));
    current.current.width = next;
    setPreferredWidth(next);
    return next;
  }, []);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    // Keep iframe previews from consuming the pointer stream during a drag.
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:col-resize;background:transparent;";
    document.body.appendChild(overlay);
    drag.current = {
      overlay,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const latest = current.current;
      const candidates: Record<string, number> = {
        ArrowLeft: latest.width - 20,
        ArrowRight: latest.width + 20,
        Home: latest.minWidth,
        End: latest.maxWidth,
      };
      const candidate = candidates[event.key];
      if (candidate === undefined) return;
      event.preventDefault();
      const next = resize(candidate);
      if (latest.preferenceKey) writePanelSizePreference(latest.preferenceKey, next);
    },
    [resize],
  );

  useEffect(() => {
    if (!enabled) return;
    function onMouseMove(event: MouseEvent) {
      if (!drag.current || !containerRef.current) return;
      resize(event.clientX - containerRef.current.getBoundingClientRect().left);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      finish();
    };
  }, [enabled, finish, resize]);

  return {
    width,
    /** Attach to the row containing the resizable left column. */
    containerRef,
    handleProps: {
      onMouseDown,
      onKeyDown,
      role: "separator" as const,
      "aria-orientation": "vertical" as const,
      "aria-label": label,
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth,
      "aria-valuenow": width,
      tabIndex: 0,
    },
  };
}
