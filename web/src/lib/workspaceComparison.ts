import { useCallback, useSyncExternalStore } from "react";

export interface WorkspaceComparison {
  source: "git" | "since" | "range" | "commit" | "agent" | "last-turn";
  base: string;
  target: string;
  /** A captured turn id, or current; omitted selects the latest completed turn. */
  turnId?: string;
}

export interface ComparisonTurn {
  id: string;
  label: string;
  finished: boolean;
}

export const DEFAULT_WORKSPACE_COMPARISON: WorkspaceComparison = Object.freeze({
  source: "git",
  base: "HEAD",
  target: "WORKTREE",
});
const selections = new Map<string, WorkspaceComparison>();
const listeners = new Set<() => void>();

export function getWorkspaceComparison(sessionId?: string): WorkspaceComparison {
  return (sessionId && selections.get(sessionId)) || DEFAULT_WORKSPACE_COMPARISON;
}

export function setWorkspaceComparison(sessionId: string | undefined, value: WorkspaceComparison) {
  if (!sessionId) return;
  const previous = getWorkspaceComparison(sessionId);
  if (
    previous.source === value.source &&
    previous.base === value.base &&
    previous.target === value.target &&
    previous.turnId === value.turnId
  )
    return;
  selections.delete(sessionId);
  selections.set(sessionId, Object.freeze({ ...value }));
  if (selections.size > 100) selections.delete(selections.keys().next().value!);
  for (const listener of listeners) listener();
}

export function subscribeWorkspaceComparisons(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkspaceComparison(sessionId?: string) {
  const comparison = useSyncExternalStore(
    subscribeWorkspaceComparisons,
    () => getWorkspaceComparison(sessionId),
    () => DEFAULT_WORKSPACE_COMPARISON,
  );
  const setComparison = useCallback(
    (value: WorkspaceComparison) => setWorkspaceComparison(sessionId, value),
    [sessionId],
  );
  return { comparison, setComparison };
}

export function isAgentComparison(value: WorkspaceComparison) {
  return value.source === "agent" || value.source === "last-turn";
}

export function isRevisionComparison(value: WorkspaceComparison) {
  return value.source === "since" || value.source === "range" || value.source === "commit";
}
