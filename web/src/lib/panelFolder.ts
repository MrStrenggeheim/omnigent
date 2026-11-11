import {
  readResourceViewState,
  writeResourceViewState,
  resourceViewStorageScope,
} from "./resourceViewStorage";
import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { relativizeToWorkspace } from "@/lib/workspacePaths";

/** Presentation identity only; never use as a resource API or query identity. */
export const ResourceViewIdContext = createContext<string | undefined>(undefined);
export function useResourceViewId(viewId?: string) {
  const inherited = useContext(ResourceViewIdContext);
  return viewId ?? inherited;
}
export function panelFolderKey(owner: string | undefined, viewId?: string) {
  return owner && viewId
    ? JSON.stringify(["view", resourceViewStorageScope(), viewId, owner])
    : owner;
}
const stateListeners = new Set<() => void>();
function subscribeViewState(listener: () => void) {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}
/** Retain presentation state across pane moves/remounts, partitioned by resource. */
export function useResourceViewState<T>(
  owner: string | undefined,
  viewId: string | undefined,
  field: string,
  initial: T | (() => T),
) {
  const [local, setLocal] = useState(initial);
  const fallback = useRef(local);
  const key = viewId
    ? JSON.stringify([resourceViewStorageScope(), viewId, owner, field])
    : undefined;
  const value = useSyncExternalStore(
    subscribeViewState,
    () => (key ? (readResourceViewState<T>(`state:${key}`) ?? fallback.current) : fallback.current),
    () => fallback.current,
  );
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      if (!key) {
        setLocal(next);
        return;
      }
      const previous = readResourceViewState<T>(`state:${key}`) ?? fallback.current;
      writeResourceViewState(
        `state:${key}`,
        typeof next === "function" ? (next as (value: T) => T)(previous) : next,
      );
      for (const listener of stateListeners) listener();
    },
    [key],
  );
  return [key ? value : local, setValue] as const;
}

const locations = new Map<string, string>();
const listeners = new Set<() => void>();
export function subscribePanelFolder(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function readPanelFolder(owner: string | undefined): string | null {
  if (owner?.startsWith('["view",')) {
    const path = readResourceViewState<unknown>(`folder:${owner}`);
    return typeof path === "string" ? path : null;
  }
  return owner ? (locations.get(owner) ?? null) : null;
}
export function setPanelFolder(owner: string, path: string | null) {
  if (owner.startsWith('["view",')) writeResourceViewState(`folder:${owner}`, path ?? undefined);
  else if (path === null) locations.delete(owner);
  else locations.set(owner, path);
  for (const listener of listeners) listener();
}
export function usePanelFolder(
  owner: string | undefined,
  root: string | null = null,
  explicitViewId?: string,
) {
  const viewId = useResourceViewId(explicitViewId);
  const key = panelFolderKey(owner, viewId);
  const folder = useSyncExternalStore(
    subscribePanelFolder,
    () => readPanelFolder(key),
    () => null,
  );
  return relativizeToWorkspace(folder, root);
}
export function readBrowseLocation(
  conversationId: string,
  root: string | null = null,
  workspaceId?: string,
  viewId?: string,
) {
  return relativizeToWorkspace(
    readPanelFolder(panelFolderKey(workspaceId ?? conversationId, viewId)),
    root,
  );
}
