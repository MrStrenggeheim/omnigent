import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { ActionCommand } from "@/shell/contextSearch/actions";

const ViewCommandContext = createContext<string | null>(null);
const commands = new Map<string, readonly ActionCommand[]>();
const listeners = new Set<() => void>();
const empty: readonly ActionCommand[] = [];
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ViewCommandScope({ viewId, children }: { viewId: string; children: ReactNode }) {
  return <ViewCommandContext.Provider value={viewId}>{children}</ViewCommandContext.Provider>;
}

/** Commands retain the resource and owning workflow of the view that registered them. */
export function useViewCommands(actions: readonly ActionCommand[]) {
  const viewId = useContext(ViewCommandContext);
  useEffect(() => {
    if (!viewId) return;
    commands.set(viewId, actions);
    notify();
    return () => {
      if (commands.get(viewId) === actions) {
        commands.delete(viewId);
        notify();
      }
    };
  }, [viewId, actions]);
}

export function useFocusedViewCommands(viewId: string | undefined) {
  return useSyncExternalStore(
    subscribe,
    () => (viewId ? (commands.get(viewId) ?? empty) : empty),
    () => empty,
  );
}
