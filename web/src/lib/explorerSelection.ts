import { panelFolderKey, useResourceViewId } from "./panelFolder";
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
import type { ExplorerEntry } from "./explorerOperations";

interface Selection {
  entries: Map<string, ExplorerEntry>;
  anchor: { current: string | null };
}
const selections = new Map<string, Selection>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Reset retained selections between isolated component tests. */
export function resetExplorerSelectionsForTesting() {
  selections.clear();
}

/** Scope selection to a resource folder, retaining the anchor when its preview opens. */
export function useExplorerSelection(owner: string | undefined, folder: string) {
  const viewId = useResourceViewId();
  const key = JSON.stringify([panelFolderKey(owner, viewId) ?? null, folder]);
  let selection = selections.get(key);
  if (!selection) {
    selection = { entries: new Map(), anchor: { current: null } };
    selections.set(key, selection);
    if (selections.size > 100) selections.delete(selections.keys().next().value!);
  }
  const current = selection;
  const selected = useSyncExternalStore(
    subscribe,
    () => current.entries,
    () => current.entries,
  );
  const setSelected = useCallback(
    (next: SetStateAction<Map<string, ExplorerEntry>>) => {
      current.entries = typeof next === "function" ? next(current.entries) : next;
      if (current.entries.size === 0) current.anchor.current = null;
      for (const listener of listeners) listener();
    },
    [current],
  );
  return { selected, setSelected, anchor: current.anchor };
}
