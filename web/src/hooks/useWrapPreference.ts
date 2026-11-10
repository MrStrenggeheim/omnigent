import { useCallback, useSyncExternalStore } from "react";
import { toast } from "@/lib/notifications";

export type WrapScope = "chat" | "tool-input" | "tool-output";
const EVENT = "omnigent:wrap-preference";
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
/** Independent remembered defaults for prose/code, command input and command output. */
export function useWrapPreference(scope: WrapScope) {
  const key = `omnigent:wrap:${scope}`;
  const read = useCallback(() => {
    try {
      return localStorage.getItem(key) !== "false";
    } catch {
      return true;
    }
  }, [key]);
  const wrap = useSyncExternalStore(subscribe, read, () => true);
  const setWrap = useCallback(
    (next: boolean | ((value: boolean) => boolean)) => {
      try {
        localStorage.setItem(key, String(typeof next === "function" ? next(read()) : next));
        window.dispatchEvent(new Event(EVENT));
      } catch {
        toast.error("Could not remember word wrap. Browser storage is unavailable.");
      }
    },
    [key, read],
  );
  return [wrap, setWrap] as const;
}
