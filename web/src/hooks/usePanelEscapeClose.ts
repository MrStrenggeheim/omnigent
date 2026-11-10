import { useEffect, type RefObject } from "react";

/** Let an inner menu or dialog consume Escape before dismissing its panel. */
export function usePanelEscapeClose(
  open: boolean,
  onClose: (() => void) | undefined,
  { scope, capture = false }: { scope?: RefObject<HTMLElement | null>; capture?: boolean } = {},
) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing) return;
      if (scope && (!scope.current || !event.composedPath().includes(scope.current))) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[role="menu"], [role="dialog"], [role="listbox"]')
      )
        return;
      if (
        document.querySelector(
          '[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="listbox"][data-state="open"]',
        )
      )
        return;
      if (capture) {
        event.preventDefault();
        event.stopPropagation();
      }
      onClose?.();
    };
    window.addEventListener("keydown", onKey, capture);
    return () => window.removeEventListener("keydown", onKey, capture);
  }, [open, onClose, scope, capture]);
}
