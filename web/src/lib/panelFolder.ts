import { useSyncExternalStore } from "react";
import { relativizeToWorkspace } from "@/lib/workspacePaths";

const locations = new Map<string, string>();
const listeners = new Set<() => void>();
export function subscribePanelFolder(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function readPanelFolder(owner: string | undefined): string | null {
  return owner ? (locations.get(owner) ?? null) : null;
}
export function setPanelFolder(owner: string, path: string | null) {
  if (path === null) locations.delete(owner);
  else locations.set(owner, path);
  for (const listener of listeners) listener();
}
export function usePanelFolder(owner: string | undefined, root: string | null = null) {
  const folder = useSyncExternalStore(
    subscribePanelFolder,
    () => readPanelFolder(owner),
    () => null,
  );
  return relativizeToWorkspace(folder, root);
}
export function readBrowseLocation(
  conversationId: string,
  root: string | null = null,
  workspaceId?: string,
) {
  return relativizeToWorkspace(readPanelFolder(workspaceId ?? conversationId), root);
}
