import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useIsMobileViewport } from "./useIsMobileViewport";

/** Temporarily reveal the shell's existing navigation while visiting Settings. */
export function useSettingsNavigationVisibility({
  inSettings,
  sidebarOpen,
  setSidebarOpen,
  enabled = true,
}: {
  inSettings: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  enabled?: boolean;
}): void {
  const isMobile = useIsMobileViewport();
  const previous = useRef<{ sidebarOpen: boolean; isMobile: boolean } | null>(null);

  useEffect(() => {
    if (enabled && inSettings) {
      const entering = previous.current === null;
      const enteringDesktop = previous.current?.isMobile === true && !isMobile;
      if (previous.current === null) previous.current = { sidebarOpen, isMobile };
      else previous.current.isMobile = isMobile;
      if (!isMobile && (entering || enteringDesktop)) setSidebarOpen(true);
    } else if (previous.current !== null) {
      const restore = previous.current.sidebarOpen;
      previous.current = null;
      setSidebarOpen(restore);
    }
  }, [enabled, inSettings, isMobile, sidebarOpen, setSidebarOpen]);
}
